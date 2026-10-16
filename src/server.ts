import express from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { handleRequest } from "./assistant.js";
import { DiagnosisRefusedError, type ImageInput } from "./diagnose.js";
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

app.post("/api/chat", upload.single("photo"), async (req, res) => {
  let image: ImageInput | null = null;
  if (req.file) {
    if (!IMAGE_TYPES.has(req.file.mimetype)) {
      res.status(400).json({ error: "Formato de imagen no soportado (usá JPG, PNG, WEBP o GIF)" });
      return;
    }
    image = { data: req.file.buffer, mediaType: req.file.mimetype as ImageInput["mediaType"] };
  }
  const text = typeof req.body.text === "string" ? req.body.text : undefined;
  if (!image && !text?.trim()) {
    res.status(400).json({ error: "Mandá una foto o describí el problema" });
    return;
  }
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  const location = Number.isFinite(lat) && Number.isFinite(lng) && req.body.lat !== "" ? { lat, lng } : null;

  try {
    res.json(await handleRequest(image, text, location));
  } catch (err) {
    if (err instanceof DiagnosisRefusedError) {
      res.status(422).json({ error: "No pude analizar esa imagen. Probá con otra foto." });
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(503).json({ error: "Hay mucha demanda, probá en unos segundos." });
    } else if (err instanceof Anthropic.AuthenticationError) {
      console.error("Credenciales de Claude inválidas o ausentes");
      res.status(500).json({ error: "El servicio de IA no está configurado." });
    } else {
      console.error(err);
      res.status(500).json({ error: "Error inesperado" });
    }
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`ArreglaYa escuchando en http://localhost:${port}`));
