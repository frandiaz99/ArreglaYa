import express from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { handleRequest } from "./assistant.js";
import { ModelRefusedError, type ImageInput } from "./claude.js";
import { DiagnosisSchema } from "./diagnose.js";
import { buildGuide, canOfferGuide } from "./guide.js";
import { seedDemoProviders } from "./db.js";
import { whatsappRouter } from "./whatsapp.js";

seedDemoProviders();

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_PROFILE) {
  console.warn("⚠️  Falta ANTHROPIC_API_KEY: copiá .env.example a .env y completala. Sin eso no hay diagnóstico.");
}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Guardamos el body crudo para validar la firma de WhatsApp
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.static("public"));
app.use("/webhooks/whatsapp", whatsappRouter());

class BadRequest extends Error {}

function imageFrom(file: Express.Multer.File | undefined): ImageInput | null {
  if (!file) return null;
  if (!IMAGE_TYPES.has(file.mimetype)) throw new BadRequest("Formato de imagen no soportado (usá JPG, PNG, WEBP o GIF)");
  return { data: file.buffer, mediaType: file.mimetype as ImageInput["mediaType"] };
}

function sendError(res: express.Response, err: unknown): void {
  if (err instanceof BadRequest) {
    res.status(400).json({ error: err.message });
  } else if (err instanceof ModelRefusedError) {
    res.status(422).json({ error: "No pude analizar esa imagen. Probá con otra foto." });
  } else if (err instanceof Anthropic.RateLimitError) {
    res.status(503).json({ error: "Hay mucha demanda, probá en unos segundos." });
  } else if (err instanceof Anthropic.AuthenticationError) {
    console.error("Credenciales de Claude inválidas");
    res.status(500).json({ error: "El servicio de IA no está configurado." });
  } else {
    console.error(err);
    res.status(500).json({ error: "Error inesperado" });
  }
}

app.post("/api/chat", upload.single("photo"), async (req, res) => {
  try {
    const image = imageFrom(req.file);
    const text = typeof req.body.text === "string" ? req.body.text : undefined;
    if (!image && !text?.trim()) throw new BadRequest("Mandá una foto o describí el problema");
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    const location = req.body.lat && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    res.json(await handleRequest(image, text, location));
  } catch (err) {
    sendError(res, err);
  }
});

// Guía "Hacelo vos": recibe el diagnóstico previo (y la foto otra vez, para que la guía sea precisa)
app.post("/api/guide", upload.single("photo"), async (req, res) => {
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(String(req.body.diagnosis));
    } catch {
      throw new BadRequest("Diagnóstico inválido");
    }
    const parsed = DiagnosisSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequest("Diagnóstico inválido");
    if (!canOfferGuide(parsed.data)) throw new BadRequest("Este arreglo conviene hacerlo con un profesional");
    res.json(await buildGuide(parsed.data, imageFrom(req.file)));
  } catch (err) {
    sendError(res, err);
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`ArreglaYa escuchando en http://localhost:${port}`));
