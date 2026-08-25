import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
  AiStreamEvent,
  AiStreamOptions,
} from "../types";
import { mapHttpErrorToProviderError, parseOpenAiCompatibleSse } from "../stream-utils";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OX_ALPHA_MODEL = "stealth/ox-alpha";

function linkAbortSignals(timeoutMs: number, external?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
  wasExternalAbort: () => boolean;
} {
  const controller = new AbortController();
  let externalAborted = false;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternal = () => {
    externalAborted = true;
    controller.abort();
  };
  if (external) {
    if (external.aborted) onExternal();
    else external.addEventListener("abort", onExternal, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      if (external) external.removeEventListener("abort", onExternal);
    },
    wasExternalAbort: () => externalAborted || Boolean(external?.aborted),
  };
}

export class OpenRouterProvider implements AiProvider {
  name = "openrouter";
  private apiKey: string;
  private defaultModel = OX_ALPHA_MODEL;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || "";
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      ...(process.env.NEXT_PUBLIC_APP_URL
        ? { "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL }
        : {}),
      "X-Title": "ForgeAI",
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${OPENROUTER_BASE}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) return false;
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      return Boolean(data.data?.some((m) => m.id === OX_ALPHA_MODEL));
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return this.apiKey ? [OX_ALPHA_MODEL] : [];
  }

  private buildMessages(req: AiGenerateRequest) {
    return (
      req.messages ||
      (req.prompt ? [{ role: "user" as const, content: req.prompt }] : [])
    );
  }

  private requestBody(req: AiGenerateRequest, stream = false) {
    const model = req.model || this.defaultModel;
    return {
      model,
      messages: this.buildMessages(req),
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      top_p: req.topP,
      stop: req.stop,
      reasoning: {
        effort: process.env.OX_ALPHA_REASONING_EFFORT || "high",
      },
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    };
  }

  async generate(req: AiGenerateRequest): Promise<AiGenerateResponse> {
    if (!this.apiKey) {
      throw {
        code: "AUTH_ERROR",
        message: "OpenRouter API key not configured",
        provider: this.name,
        retryable: false,
      } satisfies AiProviderError;
    }

    const messages = this.buildMessages(req);
    if (messages.length === 0) {
      throw {
        code: "INVALID_REQUEST",
        message: "No messages or prompt provided",
        provider: this.name,
        retryable: false,
      } satisfies AiProviderError;
    }

    const model = req.model || this.defaultModel;
    if (model !== OX_ALPHA_MODEL) {
      throw {
        code: "INVALID_REQUEST",
        message: `OpenRouter provider currently supports ${OX_ALPHA_MODEL} only`,
        provider: this.name,
        retryable: false,
      } satisfies AiProviderError;
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(process.env.AI_TIMEOUT_MS) || 60000
    );

    try {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(this.requestBody(req)),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const body = await res.text();
        throw mapHttpErrorToProviderError(res.status, body, this.name, "OpenRouter");
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const content = choice?.message?.content ?? "";
      const usage = data.usage || {};

      return {
        id: data.id || `openrouter_${Date.now()}`,
        content,
        model: data.model || model,
        provider: this.name,
        usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
          totalTokens: usage.total_tokens ?? 0,
        },
        finishReason: choice?.finish_reason ?? null,
        latencyMs,
      };
    } catch (e: unknown) {
      clearTimeout(timeout);
      if ((e as AiProviderError).code) throw e;
      if ((e as Error).name === "AbortError") {
        throw {
          code: "TIMEOUT",
          message: "OpenRouter request timed out",
          provider: this.name,
          retryable: true,
        } satisfies AiProviderError;
      }
      throw {
        code: "PROVIDER_UNAVAILABLE",
        message: (e as Error).message || "Unknown OpenRouter error",
        provider: this.name,
        retryable: true,
      } satisfies AiProviderError;
    }
  }

  async *streamGenerate(
    req: AiGenerateRequest,
    options?: AiStreamOptions
  ): AsyncGenerator<AiStreamEvent, void, unknown> {
    if (options?.signal?.aborted) return;
    if (!this.apiKey) {
      yield { type: "error", code: "AUTH_ERROR", message: "OpenRouter API key not configured", retryable: false };
      return;
    }

    const messages = this.buildMessages(req);
    if (messages.length === 0) {
      yield { type: "error", code: "INVALID_REQUEST", message: "No messages or prompt provided", retryable: false };
      return;
    }

    const model = req.model || this.defaultModel;
    if (model !== OX_ALPHA_MODEL) {
      yield {
        type: "error",
        code: "INVALID_REQUEST",
        message: `OpenRouter provider currently supports ${OX_ALPHA_MODEL} only`,
        retryable: false,
      };
      return;
    }

    const start = Date.now();
    const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 60000;
    const { signal, cleanup, wasExternalAbort } = linkAbortSignals(timeoutMs, options?.signal);

    try {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(this.requestBody(req, true)),
        signal,
      });
      if (wasExternalAbort()) return;

      if (!res.ok) {
        cleanup();
        const body = await res.text();
        const err = mapHttpErrorToProviderError(res.status, body, this.name, "OpenRouter");
        yield { type: "error", code: err.code, message: err.message, retryable: err.retryable };
        return;
      }
      if (!res.body) {
        cleanup();
        yield { type: "error", code: "PROVIDER_UNAVAILABLE", message: "OpenRouter returned empty stream body", retryable: true };
        return;
      }

      yield* parseOpenAiCompatibleSse(res.body, {
        provider: this.name,
        model,
        start,
        signal: options?.signal,
      });
      cleanup();
    } catch (e: unknown) {
      cleanup();
      if (wasExternalAbort() || options?.signal?.aborted) return;
      if ((e as Error).name === "AbortError") {
        yield { type: "error", code: "TIMEOUT", message: "Request timed out", retryable: true };
        return;
      }
      yield {
        type: "error",
        code: "PROVIDER_UNAVAILABLE",
        message: (e as Error).message || "Unknown OpenRouter stream error",
        retryable: true,
      };
    }
  }
}
