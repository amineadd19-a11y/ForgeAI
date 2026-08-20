import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
  AiStreamEvent,
} from "../types";
import { mapHttpErrorToProviderError, parseOpenAiCompatibleSse } from "../stream-utils";

/**
 * xAI (Grok) provider — OpenAI-compatible Chat Completions API.
 * Docs: https://docs.x.ai/docs/api-reference
 */
const XAI_BASE = "https://api.x.ai/v1";

export class XaiProvider implements AiProvider {
  name = "xai";
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey?: string, defaultModel = "grok-3-mini") {
    this.apiKey =
      apiKey ||
      process.env.XAI_API_KEY ||
      process.env.GROK_API_KEY ||
      "";
    this.defaultModel =
      process.env.XAI_MODEL ||
      process.env.AI_MODEL ||
      defaultModel;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${XAI_BASE}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return Boolean(this.apiKey);
    }
  }

  async listModels(): Promise<string[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch(`${XAI_BASE}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) return [this.defaultModel];
      const data = await res.json();
      const ids = (data.data || [])
        .map((m: { id: string }) => m.id)
        .filter((id: string) => id.startsWith("grok-"));
      return ids.length ? ids : [this.defaultModel];
    } catch {
      return [this.defaultModel];
    }
  }

  private resolveModel(req: AiGenerateRequest) {
    return req.model && req.model.startsWith("grok-") ? req.model : this.defaultModel;
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
        message: "xAI API key not configured (set XAI_API_KEY)",
        provider: this.name,
        retryable: false,
      };
      throw err;
    }

    const model = this.resolveModel(req);
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
    const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 60_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${XAI_BASE}/chat/completions`, {
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
        throw mapHttpErrorToProviderError(res.status, body, this.name, "xAI");
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const content = choice?.message?.content ?? "";
      const usage = data.usage || {};

      return {
        id: data.id || `xai_${Date.now()}`,
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
        message: (e as Error).message || "Unknown xAI error",
        provider: this.name,
        retryable: true,
      };
      throw err;
    }
  }

  async *streamGenerate(req: AiGenerateRequest): AsyncGenerator<AiStreamEvent, void, unknown> {
    if (!this.apiKey) {
      yield {
        type: "error",
        code: "AUTH_ERROR",
        message: "xAI API key not configured (set XAI_API_KEY)",
        retryable: false,
      };
      return;
    }

    const model = this.resolveModel(req);
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
    const controller = new AbortController();
    const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 60_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${XAI_BASE}/chat/completions`, {
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
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        clearTimeout(timeout);
        const body = await res.text();
        const err = mapHttpErrorToProviderError(res.status, body, this.name, "xAI");
        yield { type: "error", code: err.code, message: err.message, retryable: err.retryable };
        return;
      }

      if (!res.body) {
        clearTimeout(timeout);
        yield {
          type: "error",
          code: "PROVIDER_UNAVAILABLE",
          message: "xAI returned empty stream body",
          retryable: true,
        };
        return;
      }

      yield* parseOpenAiCompatibleSse(res.body, { provider: this.name, model, start });
      clearTimeout(timeout);
    } catch (e: unknown) {
      clearTimeout(timeout);
      if ((e as Error).name === "AbortError") {
        yield { type: "error", code: "TIMEOUT", message: "Request timed out", retryable: true };
        return;
      }
      yield {
        type: "error",
        code: "PROVIDER_UNAVAILABLE",
        message: (e as Error).message || "Unknown xAI stream error",
        retryable: true,
      };
    }
  }
}
