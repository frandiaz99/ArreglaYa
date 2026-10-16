import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import { diagnose, type Diagnosis, type ImageInput } from "./diagnose.js";
import { findProviders, formatAsText } from "./assistant.js";
import type { Location } from "./ranking.js";

const GRAPH = "https://graph.facebook.com/v21.0";
const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET } = process.env;

/** Estado mínimo por conversación. En producción: Redis o la base de datos. */
const sessions = new Map<string, { diagnosis?: Diagnosis; location?: Location }>();

async function sendText(to: string, body: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) console.error("WhatsApp send failed", res.status, await res.text());
}

async function downloadMedia(mediaId: string): Promise<ImageInput> {
  const auth = { Authorization: `Bearer ${WHATSAPP_TOKEN}` };
  const meta = (await (await fetch(`${GRAPH}/${mediaId}`, { headers: auth })).json()) as {
    url: string;
    mime_type: ImageInput["mediaType"];
  };
  const file = await fetch(meta.url, { headers: auth });
  return { data: Buffer.from(await file.arrayBuffer()), mediaType: meta.mime_type };
}

function validSignature(req: Request & { rawBody?: Buffer }): boolean {
  if (!WHATSAPP_APP_SECRET || !req.rawBody) return false;
  const header = req.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + createHmac("sha256", WHATSAPP_APP_SECRET).update(req.rawBody).digest("hex");
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

type WaMessage = {
  from: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  location?: { latitude: number; longitude: number };
};

async function handleMessage(msg: WaMessage): Promise<void> {
  const session = sessions.get(msg.from) ?? {};
  sessions.set(msg.from, session);

  if (msg.type === "location" && msg.location) {
    session.location = { lat: msg.location.latitude, lng: msg.location.longitude };
    if (!session.diagnosis) {
      await sendText(msg.from, "¡Gracias! Ahora mandame una foto de lo que hay que arreglar 📷");
      return;
    }
    const diagnosis = session.diagnosis;
    await sendText(msg.from, formatAsText({ diagnosis, ...findProviders(diagnosis, session.location) }));
    return;
  }

  let image: ImageInput | null = null;
  let text: string | undefined;
  if (msg.type === "image" && msg.image) {
    image = await downloadMedia(msg.image.id);
    text = msg.image.caption;
  } else if (msg.type === "text" && msg.text) {
    text = msg.text.body;
  } else {
    await sendText(msg.from, "Por ahora entiendo fotos, texto y ubicación. Mandame una foto del problema 📷");
    return;
  }

  const diagnosis = await diagnose(image, text);
  session.diagnosis = diagnosis;
  await sendText(msg.from, formatAsText({ diagnosis, ...findProviders(diagnosis, session.location ?? null) }));
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
      handleMessage(msg).catch(async (err) => {
        console.error("Error procesando mensaje de WhatsApp", err);
        await sendText(msg.from, "Uy, tuve un problema procesando tu mensaje. ¿Probás de nuevo?");
      });
    }
  });

  return router;
}
