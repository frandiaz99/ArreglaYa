import { z } from "zod";
import { askStructured, type ImageInput } from "./claude.js";
import type { Diagnosis } from "./diagnose.js";

export const GuideSchema = z.object({
  safe_to_diy: z
    .boolean()
    .describe("Revisión final: false si, pensándolo mejor, no es seguro para alguien sin experiencia"),
  not_safe_reason: z.string().nullable(),
  title: z.string(),
  difficulty: z.enum(["muy fácil", "fácil", "intermedio"]),
  estimated_minutes: z.number().describe("Tiempo aproximado para alguien sin experiencia"),
  safety_first: z.array(z.string()).describe("Qué hacer ANTES de empezar (cortar agua/luz, guantes, etc.)"),
  tools: z.array(z.string()).describe("Herramientas comunes de una casa"),
  materials: z.array(
    z.object({
      name: z.string().describe("Nombre genérico, como se busca en una ferretería argentina"),
      spec: z.string().describe("Medida, tipo o compatibilidad (ej.: 1/2 pulgada, para inodoro de mochila)"),
      quantity: z.string(),
      search_query: z.string().describe("Búsqueda corta para encontrarlo online, sin marcas"),
    }),
  ),
  steps: z.array(
    z.object({
      instruction: z.string(),
      tip: z.string().nullable(),
    }),
  ),
  how_to_check: z.string().describe("Cómo verificar que quedó bien"),
  call_a_pro_if: z.array(z.string()).describe("Señales de que hay que dejarlo y llamar a un profesional"),
});
export type Guide = z.infer<typeof GuideSchema>;

export type GuideWithLinks = Omit<Guide, "materials"> & {
  materials: (Guide["materials"][number] & { buy_url: string })[];
};

const SYSTEM_PROMPT = `Sos el asistente de ArreglaYa (Argentina). El usuario ya recibió un diagnóstico y quiere arreglarlo él mismo. Escribí una guía de reparación paso a paso para alguien SIN experiencia.

Reglas:
- Primero, revisá si realmente es seguro. Si implica gas, tableros eléctricos, trabajo en altura, estructuras, o riesgo de inundación/incendio si sale mal, marcá safe_to_diy=false, explicá por qué en not_safe_reason y dejá el resto mínimo.
- Pasos concretos y cortos, en orden, uno por acción. Español rioplatense, sin tecnicismos o explicándolos.
- Materiales con los nombres que se usan en ferreterías argentinas (ej.: "cinta de teflón", "flexible para canilla", "cuerito", "sopapa"). Sin marcas.
- Solo herramientas que hay en una casa común o que se consiguen fácil.
- Sé honesto en call_a_pro_if: es mejor que el usuario llame a alguien a que empeore el problema.
- No incluyas precios.`;

/** Gas y emergencias nunca van por "hacelo vos", diga lo que diga el modelo. */
export function canOfferGuide(d: Diagnosis): boolean {
  return d.is_home_repair && d.diy_possible && d.trade !== "gasista" && d.urgency !== "emergencia";
}

export function mercadoLibreUrl(query: string): string {
  const slug = query
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://listado.mercadolibre.com.ar/${slug}`;
}

export async function buildGuide(diagnosis: Diagnosis, image: ImageInput | null): Promise<GuideWithLinks> {
  const guide = await askStructured({
    schema: GuideSchema,
    system: SYSTEM_PROMPT,
    image,
    text:
      `Diagnóstico previo:\n${JSON.stringify(
        {
          problema: diagnosis.problem_summary,
          causas_probables: diagnosis.likely_causes,
          oficio: diagnosis.trade,
          complejidad: diagnosis.complexity,
          advertencia: diagnosis.safety_warning,
        },
        null,
        2,
      )}\n\nArmame la guía para arreglarlo yo.`,
    // La guía no es tiempo real y un error cuesta caro: más esfuerzo que el diagnóstico
    effort: "medium",
  });
  return {
    ...guide,
    materials: guide.materials.map((m) => ({ ...m, buy_url: mercadoLibreUrl(m.search_query) })),
  };
}

/** Formato de texto plano, para WhatsApp. */
export function formatGuideAsText(g: GuideWithLinks): string {
  if (!g.safe_to_diy) {
    return `Pensándolo mejor, esto conviene que lo haga un profesional: ${g.not_safe_reason ?? ""}\n\nMandame tu ubicación 📍 y te recomiendo a alguien cerca.`;
  }
  const parts = [
    `🔧 *${g.title}*\nDificultad: ${g.difficulty} · ~${g.estimated_minutes} min`,
    "⚠️ *Antes de empezar:*\n" + g.safety_first.map((s) => `• ${s}`).join("\n"),
  ];
  if (g.tools.length) parts.push("🧰 *Herramientas:* " + g.tools.join(", "));
  if (g.materials.length) {
    parts.push(
      "🛒 *Materiales:*\n" +
        g.materials.map((m) => `• ${m.name} (${m.spec}) x${m.quantity}\n  ${m.buy_url}`).join("\n"),
    );
  }
  parts.push(
    "📋 *Pasos:*\n" +
      g.steps.map((s, i) => `${i + 1}. ${s.instruction}${s.tip ? `\n   💡 ${s.tip}` : ""}`).join("\n"),
  );
  parts.push(`✅ *Para comprobar:* ${g.how_to_check}`);
  parts.push(
    "🛑 *Dejalo y llamá a un profesional si:*\n" +
      g.call_a_pro_if.map((s) => `• ${s}`).join("\n") +
      "\n\nSi preferís que venga alguien, mandame tu ubicación 📍",
  );
  return parts.join("\n\n");
}
