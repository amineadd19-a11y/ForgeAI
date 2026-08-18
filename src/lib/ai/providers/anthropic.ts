import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
} from "../types";

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";

export class AnthropicProvider implements AiProvider {
  name = "anthropic";
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey?: string, defaultModel = "claude-3-5-haiku-latest") {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.defaultModel = process.env.AI_FALLBACK_MODEL || defaultModel;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async listModels(): Promise<string[]> {
    return this.apiKey ? [this.defaultModel] : [];
  }

  async generate(req: AiGenerateRequest): Promise<AiGenerateResponse> {
    if (!this.apiKey) {
      const err: AiProviderError = {
        code: "AUTH_ERROR",
        message: "Anthropic API key not configured",
        provider: this.name,
        retryable: false,
      };
      throw err;
    }

    const messages = req.messages || (req.prompt ? [{ role: "user" as const, content: req.prompt }] : []);
    if (!messages.length) {
      throw {
        code: "INVALID_REQUEST",
        message: "No messages or prompt provided",
        provider: this.name,
        retryable: false,
      } satisfies AiProviderError;
    }

    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const conversation = messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));
    const model = req.model && req.model.startsWith("claude-") ? req.model : this.defaultModel;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS) || 60000);
    const start = Date.now();

    try {
      const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? 2048,
          temperature: req.temperature ?? 0.7,
          ...(system ? { system } : {}),
          messages: conversation,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const body = await res.text();
        const code: AiProviderError["code"] =
          res.status === 429 ? "RATE_LIMITED" :
          res.status === 401 || res.status === 403 ? "AUTH_ERROR" :
          res.status >= 500 ? "PROVIDER_UNAVAILABLE" :
          res.status === 400 ? "INVALID_REQUEST" : "UNKNOWN";
        throw {
          code,
          message: `Anthropic error ${res.status}: ${body.slice(0, 200)}`,
          provider: this.name,
          retryable: res.status === 429 || res.status >= 500,
          statusCode: res.status,
        } satisfies AiProviderError;
      }

      const data = await res.json();
      const content = Array.isArray(data.content)
        ? data.content.filter((b: { type?: string }) => b.type === "text").map((b: { text?: string }) => b.text || "").join("")
        : "";
      const usage = data.usage || {};
      return {
        id: data.id || `anthropic_${Date.now()}`,
        content,
        model: data.model || model,
        provider: this.name,
        usage: {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        },
        finishReason: data.stop_reason ?? null,
        latencyMs: Date.now() - start,
      };
    } catch (e: unknown) {
      clearTimeout(timeout);
      if (e && typeof e === "object" && "code" in e) throw e;
      if (e instanceof Error && e.name === "AbortError") {
        throw { code: "TIMEOUT", message: "Request timed out", provider: this.name, retryable: true } satisfies AiProviderError;
      }
      throw {
        code: "PROVIDER_UNAVAILABLE",
        message: e instanceof Error ? e.message : "Unknown Anthropic error",
        provider: this.name,
        retryable: true,
      } satisfies AiProviderError;
    }
  }
}
