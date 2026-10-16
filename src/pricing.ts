/** US$ por millón de tokens (API de Anthropic). Revisar si cambian los precios. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};
/** Si el modelo no está en la tabla, contamos como el más caro para no subestimar. */
const FALLBACK_PRICE = { input: 10, output: 50 };

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model] ?? FALLBACK_PRICE;
  const input =
    u.input_tokens * p.input +
    (u.cache_creation_input_tokens ?? 0) * p.input * 1.25 +
    (u.cache_read_input_tokens ?? 0) * p.input * 0.1;
  return (input + u.output_tokens * p.output) / 1_000_000;
}
