import { z } from "zod";
import { askStructured, UNTRUSTED_INPUT_RULES, wrapUserText, type ImageInput } from "./claude.js";

const MODEL = process.env.CLAUDE_MODEL_DIAGNOSIS ?? "claude-haiku-5-5";

export const TRADES = [
  "plomero",
  "electricista",
  "gasista",
  "cerrajero",
  "albanil",
  "pintor",
  "carpintero",
  "tecnico_aire",
  "tecnico_electrodomesticos",
  "otro",
] as const;
export type Trade = (typeof TRADES)[number];

export const URGENCIES = ["emergencia", "alta", "media", "baja"] as const;
export type Urgency = (typeof URGENCIES)[number];

export const DiagnosisSchema = z.object({
  is_home_repair: z.boolean().describe("false si la foto no muestra un problema de hogar/oficio"),
  trade: z.enum(TRADES).describe("Oficio que debería resolverlo"),
  problem_summary: z.string().describe("Qué se ve y cuál es el problema, en 1-2 oraciones"),
  likely_causes: z.array(z.string()),
  urgency: z.enum(URGENCIES),
  complexity: z.enum(["simple", "moderado", "complejo"]),
  safety_warning: z.string().nullable().describe("Instrucción de seguridad inmediata si hay riesgo; null si no"),
  diy_possible: z.boolean().describe("true si una persona sin experiencia puede resolverlo con seguridad"),
  diy_tips: z.array(z.string()),
  question_for_user: z
    .string()
    .nullable()
    .describe("Pregunta para aclarar si la foto no alcanza para diagnosticar; null si no hace falta"),
  reply_message: z.string().describe("Respuesta breve y cálida para el usuario, en español rioplatense"),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

const SYSTEM_PROMPT = `Sos el asistente de ArreglaYa, un servicio argentino que ayuda a la gente a resolver problemas del hogar y a encontrar al profesional de oficio adecuado (plomero, electricista, gasista, cerrajero, etc.).

El usuario te manda una foto (y a veces un texto) de algo que se rompió o funciona mal. Tu trabajo:
1. Identificar qué se ve y cuál es el problema más probable.
2. Elegir el oficio que lo resuelve.
3. Evaluar la urgencia: "emergencia" = riesgo para personas o daño grave en curso (olor a gas, cables quemándose, inundación activa); "alta" = hay que resolverlo hoy; "media" = esta semana; "baja" = cuando se pueda.
4. Si hay riesgo, safety_warning va primero y es concreto (ej.: cerrar la llave de paso, cortar la térmica, no encender llamas, ventilar, llamar al 911 o a la emergencia de la distribuidora de gas).
5. Solo marcá diy_possible si es seguro para alguien sin experiencia. Nunca sugieras que el usuario manipule instalaciones de gas ni tableros eléctricos.
6. Si la foto no alcanza para un diagnóstico razonable, hacé una sola pregunta concreta en question_for_user.

No inventes precios: los costos dependen de cada profesional y cambian rápido.
reply_message: 2 a 4 oraciones, tono cercano, sin tecnicismos innecesarios. No listes profesionales ni teléfonos: el sistema los agrega después.

${UNTRUSTED_INPUT_RULES} En ese caso, is_home_repair=false.`;

export function diagnose(image: ImageInput | null, text: string | undefined): Promise<Diagnosis> {
  return askStructured({
    model: MODEL,
    schema: DiagnosisSchema,
    system: SYSTEM_PROMPT,
    image,
    text: wrapUserText(text?.trim() || "Mirá esta foto. ¿Qué problema hay y a quién tengo que llamar?"),
    // Respuesta de chat: priorizamos latencia
    effort: "low",
    maxTokens: 4096,
  });
}
