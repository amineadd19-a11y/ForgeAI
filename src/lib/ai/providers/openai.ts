import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
} from "../types";

const OPENAI_BASE = "https://api.openai.com/v1";

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
    const messages =
      req.messages ||
      (req.prompt
        ? [{ role: "user" as const, content: req.prompt }]
        : []);

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
        let code: AiProviderError["code"] = "UNKNOWN";
        if (res.status === 429) code = "RATE_LIMITED";
        else if (res.status === 401 || res.status === 403) code = "AUTH_ERROR";
        else if (res.status >= 500) code = "PROVIDER_UNAVAILABLE";
        else if (res.status === 400) code = "INVALID_REQUEST";

        const err: AiProviderError = {
          code,
          message: `OpenAI error ${res.status}: ${body.slice(0, 200)}`,
          provider: this.name,
          retryable: res.status === 429 || res.status >= 500,
          statusCode: res.status,
        };
        throw err;
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
}
