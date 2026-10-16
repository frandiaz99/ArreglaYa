import type { ImageInput } from "./claude.js";
import { diagnose, type Diagnosis } from "./diagnose.js";
import { canOfferGuide } from "./guide.js";
import { providersByTrade } from "./db.js";
import { rankProviders, type Location, type RankedProvider } from "./ranking.js";

export type AssistantResult = {
  diagnosis: Diagnosis;
  providers: RankedProvider[];
  needsLocation: boolean;
  guideAvailable: boolean;
};

const TRADE_LABEL: Record<string, string> = {
  plomero: "plomero",
  electricista: "electricista matriculado",
  gasista: "gasista matriculado",
  cerrajero: "cerrajero",
  albanil: "albañil",
  pintor: "pintor",
  carpintero: "carpintero",
  tecnico_aire: "técnico de aire acondicionado",
  tecnico_electrodomesticos: "técnico de electrodomésticos",
  otro: "profesional",
};

export async function handleRequest(
  image: ImageInput | null,
  text: string | undefined,
  location: Location | null,
): Promise<AssistantResult> {
  const diagnosis = await diagnose(image, text);
  return buildResult(diagnosis, location);
}

export function buildResult(diagnosis: Diagnosis, location: Location | null): AssistantResult {
  return { diagnosis, ...findProviders(diagnosis, location), guideAvailable: canOfferGuide(diagnosis) };
}

function findProviders(diagnosis: Diagnosis, location: Location | null) {
  const searchable = diagnosis.is_home_repair && diagnosis.trade !== "otro" && !diagnosis.question_for_user;
  if (!searchable) return { providers: [], needsLocation: false };
  if (!location) return { providers: [], needsLocation: true };
  return {
    providers: rankProviders(providersByTrade(diagnosis.trade), diagnosis.trade, diagnosis.urgency, location),
    needsLocation: false,
  };
}

/** Formato de texto plano, para WhatsApp. */
export function formatAsText({ diagnosis, providers, needsLocation, guideAvailable }: AssistantResult): string {
  const parts: string[] = [];
  if (diagnosis.safety_warning) parts.push(`⚠️ *${diagnosis.safety_warning}*`);
  parts.push(diagnosis.reply_message);
  if (diagnosis.question_for_user) parts.push(diagnosis.question_for_user);
  if (guideAvailable) {
    parts.push("🔧 Esto lo podés arreglar vos. Respondé *GUIA* y te paso los pasos y los materiales.");
  }
  if (needsLocation) {
    const prefix = guideAvailable ? "Si preferís que venga alguien" : `Para recomendarte un ${TRADE_LABEL[diagnosis.trade]} cerca`;
    parts.push(`${prefix}, mandame tu ubicación 📍`);
  } else if (providers.length) {
    parts.push(
      `Te recomiendo estos ${TRADE_LABEL[diagnosis.trade]}s:\n\n` +
        providers
          .map((r, i) => `${i + 1}. *${r.provider.name}*\n${r.reasons.join(" · ")}\n📞 ${r.provider.phone}`)
          .join("\n\n"),
    );
  } else if (diagnosis.is_home_repair && !diagnosis.question_for_user && diagnosis.trade !== "otro") {
    parts.push("Todavía no tenemos profesionales de ese rubro en tu zona. 😕");
  }
  return parts.join("\n\n");
}
