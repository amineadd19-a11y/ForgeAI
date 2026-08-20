import { AiProviderError, AiStreamEvent } from "./types";

/**
 * Parse OpenAI-compatible chat.completion.chunk SSE lines into ForgeAI stream events.
 * When `meta.signal` is aborted, stops without emitting a terminal `done` event.
 */
export async function* parseOpenAiCompatibleSse(
  body: ReadableStream<Uint8Array>,
  meta: { provider: string; model: string; start: number; signal?: AbortSignal }
): AsyncGenerator<AiStreamEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let id = `${meta.provider}_${Date.now()}`;
  let model = meta.model;
  let finishReason: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  const onAbort = () => {
    try {
      void reader.cancel();
    } catch {
      /* ignore */
    }
  };
  if (meta.signal) {
    if (meta.signal.aborted) onAbort();
    else meta.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (true) {
      if (meta.signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      if (meta.signal?.aborted) return;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const raw of lines) {
        if (meta.signal?.aborted) return;
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          if (meta.signal?.aborted) return;
          yield {
            type: "done",
            id,
            model,
            provider: meta.provider,
            content: fullContent,
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            finishReason,
            latencyMs: Date.now() - meta.start,
          };
          return;
        }
        try {
          const json = JSON.parse(payload) as {
            id?: string;
            model?: string;
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          if (json.id) id = json.id;
          if (json.model) model = json.model;
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            yield { type: "delta", content: delta };
          }
          if (json.choices?.[0]?.finish_reason) {
            finishReason = json.choices[0].finish_reason;
          }
          if (json.usage) {
            inputTokens = json.usage.prompt_tokens ?? inputTokens;
            outputTokens = json.usage.completion_tokens ?? outputTokens;
          }
        } catch {
          // skip malformed chunk
        }
      }
    }

    if (meta.signal?.aborted) return;

    // Stream ended without [DONE] — still emit done if we got content
    if (fullContent.length > 0 || finishReason) {
      if (!outputTokens) outputTokens = Math.ceil(fullContent.length / 4);
      yield {
        type: "done",
        id,
        model,
        provider: meta.provider,
        content: fullContent,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        finishReason,
        latencyMs: Date.now() - meta.start,
      };
    }
  } finally {
    if (meta.signal) meta.signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

export function mapHttpErrorToProviderError(
  status: number,
  body: string,
  provider: string,
  label: string
): AiProviderError {
  let code: AiProviderError["code"] = "UNKNOWN";
  if (status === 429) code = "RATE_LIMITED";
  else if (status === 401 || status === 403) code = "AUTH_ERROR";
  else if (status >= 500) code = "PROVIDER_UNAVAILABLE";
  else if (status === 400) code = "INVALID_REQUEST";
  return {
    code,
    message: `${label} error ${status}: ${body.slice(0, 200)}`,
    provider,
    retryable: status === 429 || status >= 500,
    statusCode: status,
  };
}
