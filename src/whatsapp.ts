import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import type { ImageInput } from "./claude.js";
import { BudgetExceededError } from "./budget.js";
import { buildResult, formatAsText, getDiagnosis, getGuide, GuideNotAvailableError, handleRequest } from "./assistant.js";
import { formatGuideAsText } from "./guide.js";
import { diagnosisLimiter, guideLimiter, MAX_TEXT_CHARS, RateLimitedError, TtlCache } from "./limits.js";
import type { Location } from "./ranking.js";

const GRAPH = "https://graph.facebook.com/v21.0";
const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET } = process.env;
const DAY = 24 * 60 * 60 * 1000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Estado mínimo por conversación; vence a las 24 h sin mensajes. En producción: Redis o la base de datos. */
const sessions = new TtlCache<string, { diagnosisId?: string; location?: Location }>(DAY, 10_000);
/** Meta reintenta webhooks: sin esto, un reintento se procesaría (y cobraría) dos veces. */
const seenMessageIds = new TtlCache<string, true>(DAY, 50_000);

const GUIDE_KEYWORD = /^\s*gu[ií]a\s*$/i;

async function sendText(to: string, body: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) console.error("WhatsApp send failed", res.status, await res.text());
}

class UnsupportedImageError extends Error {}

async function downloadMedia(mediaId: string): Promise<ImageInput> {
  const auth = { Authorization: `Bearer ${WHATSAPP_TOKEN}` };
  const meta = (await (await fetch(`${GRAPH}/${mediaId}`, { headers: auth })).json()) as {
    url: string;
    mime_type: string;
    file_size: number;
  };
  if (!IMAGE_TYPES.has(meta.mime_type) || meta.file_size > MAX_IMAGE_BYTES) throw new UnsupportedImageError();
  const file = await fetch(meta.url, { headers: auth });
  return { data: Buffer.from(await file.arrayBuffer()), mediaType: meta.mime_type as ImageInput["mediaType"] };
}

function validSignature(req: Request & { rawBody?: Buffer }): boolean {
  if (!WHATSAPP_APP_SECRET || !req.rawBody) return false;
  const header = req.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + createHmac("sha256", WHATSAPP_APP_SECRET).update(req.rawBody).digest("hex");
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

type WaMessage = {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  location?: { latitude: number; longitude: number };
};

async function handleMessage(msg: WaMessage): Promise<void> {
  const session = sessions.get(msg.from) ?? {};
  sessions.set(msg.from, session); // renueva el vencimiento
  const diagnosis = session.diagnosisId ? getDiagnosis(session.diagnosisId) : undefined;

  if (msg.type === "location" && msg.location) {
    session.location = { lat: msg.location.latitude, lng: msg.location.longitude };
    if (!session.diagnosisId || !diagnosis) {
      await sendText(msg.from, "¡Gracias! Ahora mandame una foto de lo que hay que arreglar 📷");
      return;
    }
    await sendText(msg.from, formatAsText(buildResult(session.diagnosisId, diagnosis, session.location)));
    return;
  }

  if (msg.type === "text" && msg.text && GUIDE_KEYWORD.test(msg.text.body)) {
    if (!session.diagnosisId) {
      await sendText(msg.from, "Primero mandame una foto de lo que querés arreglar 📷");
      return;
    }
    const guide = await getGuide(session.diagnosisId, () => {
      guideLimiter.hit(`wa:${msg.from}`);
      void sendText(msg.from, "Dale, te armo la guía… 🔧");
    });
    await sendText(msg.from, formatGuideAsText(guide));
    return;
  }

  let image: ImageInput | null = null;
  let text: string | undefined;
  if (msg.type === "image" && msg.image) {
    diagnosisLimiter.hit(`wa:${msg.from}`); // antes de descargar la foto
    image = await downloadMedia(msg.image.id);
    text = msg.image.caption;
  } else if (msg.type === "text" && msg.text) {
    diagnosisLimiter.hit(`wa:${msg.from}`);
    text = msg.text.body;
  } else {
    await sendText(msg.from, "Por ahora entiendo fotos, texto y ubicación. Mandame una foto del problema 📷");
    return;
  }

  const result = await handleRequest(image, text?.slice(0, MAX_TEXT_CHARS), session.location ?? null);
  session.diagnosisId = result.diagnosisId;
  await sendText(msg.from, formatAsText(result));
}

/** Traduce errores a un mensaje para el usuario; null = no responder nada. */
function errorReply(err: unknown): string | null {
  if (err instanceof RateLimitedError) {
    // Avisamos una sola vez por ventana: responder a cada mensaje de spam también cuesta
    return err.firstRejection
      ? `Llegaste al límite de consultas por ahora. Probá de nuevo en ${Math.ceil(err.retryAfterSec / 60)} minutos.`
      : null;
  }
  if (err instanceof BudgetExceededError) return "Estamos con mucha demanda. Probá de nuevo más tarde 🙏";
  if (err instanceof GuideNotAvailableError) return err.message;
  if (err instanceof UnsupportedImageError) return "No pude abrir esa imagen. Mandala como foto (JPG o PNG, hasta 5 MB).";
  console.error("Error procesando mensaje de WhatsApp", err);
  return "Uy, tuve un problema procesando tu mensaje. ¿Probás de nuevo?";
}

export function whatsappRouter(): Router {
  const router = express.Router();

  // Verificación del webhook (Meta la llama al configurarlo)
  router.get("/", (req: Request, res: Response) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === WHATSAPP_VERIFY_TOKEN) {
      res.send(req.query["hub.challenge"]);
    } else {
      res.sendStatus(403);
    }
  });

  router.post("/", (req: Request, res: Response) => {
    if (!validSignature(req)) {
      res.sendStatus(401);
      return;
    }
    // Responder rápido: Meta reintenta si tardamos
    res.sendStatus(200);
    const messages: WaMessage[] = req.body?.entry?.[0]?.changes?.[0]?.value?.messages ?? [];
    for (const msg of messages) {
      if (seenMessageIds.get(msg.id)) continue;
      seenMessageIds.set(msg.id, true);
      handleMessage(msg).catch(async (err) => {
        const reply = errorReply(err);
        if (reply) await sendText(msg.from, reply);
      });
    }
  });

  return router;
}
