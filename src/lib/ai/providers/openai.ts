import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
  AiStreamEvent,
  AiStreamOptions,
} from "../types";
import { mapHttpErrorToProviderError, parseOpenAiCompatibleSse } from "../stream-utils";

const OPENAI_BASE = "https://api.openai.com/v1";

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

export class OpenAIProvider implements AiProvider {
  name = "openai";
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey?: string, defaultModel = "gpt-4o-mini") {
    this.apiKey = apiKey || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
    this.defaultModel = process.env.AI_MODEL || defaultModel;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${OPENAI_BASE}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch(`${OPENAI_BASE}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || [])
        .map((m: { id: string }) => m.id)
        .filter((id: string) => id.startsWith("gpt-"));
    } catch {
      return [];
    }
  }

  private buildMessages(req: AiGenerateRequest) {
    return (
      req.messages ||
      (req.prompt ? [{ role: "user" as const, content: req.prompt }] : [])
    );
  }

  async generate(req: AiGenerateRequest): Promise<AiGenerateResponse> {
    if (!this.apiKey) {
      const err: AiProviderError = {
        code: "AUTH_ERROR",
        message: "OpenAI API key not configured",
        provider: this.name,
        retryable: false,
      };
      throw err;
    }

    const model = req.model || this.defaultModel;
    const messages = this.buildMessages(req);

    if (messages.length === 0) {
      const err: AiProviderError = {
        code: "INVALID_REQUEST",
        message: "No messages or prompt provided",
        provider: this.name,
        retryable: false,
      };
      throw err;
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 60000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: req.maxTokens ?? 2048,
          temperature: req.temperature ?? 0.7,
          top_p: req.topP,
          stop: req.stop,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        const body = await res.text();
        throw mapHttpErrorToProviderError(res.status, body, this.name, "OpenAI");
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const content = choice?.message?.content ?? "";
      const usage = data.usage || {};

      return {
        id: data.id || `openai_${Date.now()}`,
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
        const err: AiProviderError = {
          code: "TIMEOUT",
          message: "Request timed out",
          provider: this.name,
          retryable: true,
        };
        throw err;
      }
      const err: AiProviderError = {
        code: "PROVIDER_UNAVAILABLE",
        message: (e as Error).message || "Unknown OpenAI error",
        provider: this.name,
        retryable: true,
      };
      throw err;
    }
  }

  async *streamGenerate(
    req: AiGenerateRequest,
    options?: AiStreamOptions
  ): AsyncGenerator<AiStreamEvent, void, unknown> {
    if (options?.signal?.aborted) return;

    if (!this.apiKey) {
      yield {
        type: "error",
        code: "AUTH_ERROR",
        message: "OpenAI API key not configured",
        retryable: false,
      };
      return;
    }

    const model = req.model || this.defaultModel;
    const messages = this.buildMessages(req);
    if (messages.length === 0) {
      yield {
        type: "error",
        code: "INVALID_REQUEST",
        message: "No messages or prompt provided",
        retryable: false,
      };
      return;
    }

    const start = Date.now();
    const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 60000;
    const { signal, cleanup, wasExternalAbort } = linkAbortSignals(timeoutMs, options?.signal);

    try {
      const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: req.maxTokens ?? 2048,
          temperature: req.temperature ?? 0.7,
          top_p: req.topP,
          stop: req.stop,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal,
      });

      if (wasExternalAbort()) return;

      if (!res.ok) {
        cleanup();
        const body = await res.text();
        const err = mapHttpErrorToProviderError(res.status, body, this.name, "OpenAI");
        yield { type: "error", code: err.code, message: err.message, retryable: err.retryable };
        return;
      }

      if (!res.body) {
        cleanup();
        yield {
          type: "error",
          code: "PROVIDER_UNAVAILABLE",
          message: "OpenAI returned empty stream body",
          retryable: true,
        };
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
        message: (e as Error).message || "Unknown OpenAI stream error",
        retryable: true,
      };
    }
  }
}
