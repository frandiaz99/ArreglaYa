import express from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { getGuide, GuideNotAvailableError, handleRequest } from "./assistant.js";
import { BudgetExceededError } from "./budget.js";
import { ModelRefusedError, type ImageInput } from "./claude.js";
import { seedDemoProviders } from "./db.js";
import { diagnosisLimiter, guideLimiter, MAX_TEXT_CHARS, RateLimitedError } from "./limits.js";
import { whatsappRouter } from "./whatsapp.js";

seedDemoProviders();

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_PROFILE) {
  console.warn("⚠️  Falta ANTHROPIC_API_KEY: copiá .env.example a .env y completala. Sin eso no hay diagnóstico.");
}

const app = express();
// Detrás de un proxy (Cloudflare, nginx, Render…) hay que indicarlo para que req.ip sea la IP real
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, fieldSize: 2000 },
});
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Guardamos el body crudo para validar la firma de WhatsApp
app.use(
  express.json({
    limit: "100kb",
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
  if (err instanceof BadRequest || err instanceof GuideNotAvailableError) {
    res.status(400).json({ error: err.message });
  } else if (err instanceof multer.MulterError) {
    res.status(400).json({ error: "La foto o el texto son demasiado grandes" });
  } else if (err instanceof RateLimitedError) {
    res.set("Retry-After", String(err.retryAfterSec));
    res.status(429).json({ error: `Llegaste al límite de consultas. Probá de nuevo en ${Math.ceil(err.retryAfterSec / 60)} min.` });
  } else if (err instanceof BudgetExceededError) {
    res.status(503).json({ error: "Estamos con mucha demanda. Probá de nuevo más tarde." });
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

// multer como middleware manual, para que sus errores pasen por sendError
const photoUpload: express.RequestHandler = (req, res, next) =>
  upload.single("photo")(req, res, (err: unknown) => (err ? sendError(res, err) : next()));

app.post("/api/chat", photoUpload, async (req, res) => {
  try {
    const image = imageFrom(req.file);
    const text = typeof req.body.text === "string" ? req.body.text : undefined;
    if (!image && !text?.trim()) throw new BadRequest("Mandá una foto o describí el problema");
    if (text && text.length > MAX_TEXT_CHARS) throw new BadRequest(`El texto puede tener hasta ${MAX_TEXT_CHARS} caracteres`);
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    const location = req.body.lat && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

    diagnosisLimiter.hit(`ip:${req.ip}`);
    res.json(await handleRequest(image, text, location));
  } catch (err) {
    sendError(res, err);
  }
});

app.post("/api/guide", async (req, res) => {
  try {
    const diagnosisId = req.body?.diagnosisId;
    if (typeof diagnosisId !== "string") throw new BadRequest("Falta el diagnóstico");
    res.json(await getGuide(diagnosisId, () => guideLimiter.hit(`ip:${req.ip}`)));
  } catch (err) {
    sendError(res, err);
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`ArreglaYa escuchando en http://localhost:${port}`));
