import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

export type ImageInput = {
  data: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
};

export class ModelRefusedError extends Error {}

/** Una llamada a Claude con salida JSON validada contra un schema de Zod. */
export async function askStructured<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  image: ImageInput | null;
  text: string;
  effort: "low" | "medium" | "high";
}): Promise<z.infer<T>> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (opts.image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: opts.image.mediaType, data: opts.image.data.toString("base64") },
    });
  }
  content.push({ type: "text", text: opts.text });

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: opts.effort, format: zodOutputFormat(opts.schema) },
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new ModelRefusedError(response.stop_details?.explanation ?? "El modelo rechazó la solicitud");
  }
  if (!response.parsed_output) {
    throw new Error(`Respuesta del modelo inválida (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}
