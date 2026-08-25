/** Approximate provider cost estimates for observability, not billing truth. */
export type TokenUsage = { inputTokens: number; outputTokens: number };
const MODEL_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 }, "gpt-4o": { input: 2.5, output: 10 },
  "claude-3-haiku": { input: 0.25, output: 1.25 }, "claude-3-5-sonnet": { input: 3, output: 15 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4 }, "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 }, "gemini-2.5-pro": { input: 1.25, output: 10 },
  "grok-3-mini": { input: 0.3, output: 0.5 }, "grok-3": { input: 3, output: 15 }, "grok-2": { input: 2, output: 10 },
  "stealth/ox-alpha": { input: 0, output: 0 },
};
const DEFAULT_RATE = { input: 1, output: 3 };
export function estimateProviderCostUsd(model: string, usage: TokenUsage): { estimatedUsd: number; model: string; rates: { inputPerMTok: number; outputPerMTok: number } } {
  const rates = MODEL_USD_PER_MTOK[model] || DEFAULT_RATE;
  const estimatedUsd = (usage.inputTokens / 1_000_000) * rates.input + (usage.outputTokens / 1_000_000) * rates.output;
  return { estimatedUsd: Math.round(estimatedUsd * 1e6) / 1e6, model, rates: { inputPerMTok: rates.input, outputPerMTok: rates.output } };
}
