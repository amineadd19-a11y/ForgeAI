import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
  AiStreamEvent,
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

  private prepare(req: AiGenerateRequest) {
    const messages = req.messages || (req.prompt ? [{ role: "user" as const, content: req.prompt }] : []);
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const conversation = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));
    const model = req.model && req.model.startsWith("claude-") ? req.model : this.defaultModel;
    return { messages, system, conversation, model };
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

    const { messages, system, conversation, model } = this.prepare(req);
    if (!messages.length) {
      throw {
        code: "INVALID_REQUEST",
        message: "No messages or prompt provided",
        provider: this.name,
        retryable: false,
      } satisfies AiProviderError;
    }

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
          res.status === 429
            ? "RATE_LIMITED"
            : res.status === 401 || res.status === 403
              ? "AUTH_ERROR"
              : res.status >= 500
                ? "PROVIDER_UNAVAILABLE"
                : res.status === 400
                  ? "INVALID_REQUEST"
                  : "UNKNOWN";
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
        ? data.content
            .filter((b: { type?: string }) => b.type === "text")
            .map((b: { text?: string }) => b.text || "")
            .join("")
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
        throw {
          code: "TIMEOUT",
          message: "Request timed out",
          provider: this.name,
          retryable: true,
        } satisfies AiProviderError;
      }
      throw {
        code: "PROVIDER_UNAVAILABLE",
        message: e instanceof Error ? e.message : "Unknown Anthropic error",
        provider: this.name,
        retryable: true,
      } satisfies AiProviderError;
    }
  }

  async *streamGenerate(req: AiGenerateRequest): AsyncGenerator<AiStreamEvent, void, unknown> {
    if (!this.apiKey) {
      yield {
        type: "error",
        code: "AUTH_ERROR",
        message: "Anthropic API key not configured",
        retryable: false,
      };
      return;
    }

    const { messages, system, conversation, model } = this.prepare(req);
    if (!messages.length) {
      yield {
        type: "error",
        code: "INVALID_REQUEST",
        message: "No messages or prompt provided",
        retryable: false,
      };
      return;
    }

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
          stream: true,
          ...(system ? { system } : {}),
          messages: conversation,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        clearTimeout(timeout);
        const body = await res.text();
        const code: AiProviderError["code"] =
          res.status === 429
            ? "RATE_LIMITED"
            : res.status === 401 || res.status === 403
              ? "AUTH_ERROR"
              : res.status >= 500
                ? "PROVIDER_UNAVAILABLE"
                : "UNKNOWN";
        yield {
          type: "error",
          code,
          message: `Anthropic error ${res.status}: ${body.slice(0, 200)}`,
          retryable: res.status === 429 || res.status >= 500,
        };
        return;
      }

      if (!res.body) {
        clearTimeout(timeout);
        yield {
          type: "error",
          code: "PROVIDER_UNAVAILABLE",
          message: "Anthropic returned empty stream body",
          retryable: true,
        };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let id = `anthropic_${Date.now()}`;
      let finishReason: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              const json = JSON.parse(payload) as {
                type?: string;
                message?: { id?: string; usage?: { input_tokens?: number } };
                delta?: { type?: string; text?: string; stop_reason?: string };
                usage?: { output_tokens?: number; input_tokens?: number };
              };
              if (json.type === "message_start" && json.message?.id) {
                id = json.message.id;
                inputTokens = json.message.usage?.input_tokens ?? inputTokens;
              }
              if (json.type === "content_block_delta" && json.delta?.text) {
                fullContent += json.delta.text;
                yield { type: "delta", content: json.delta.text };
              }
              if (json.type === "message_delta") {
                if (json.delta?.stop_reason) finishReason = json.delta.stop_reason;
                if (json.usage?.output_tokens != null) outputTokens = json.usage.output_tokens;
                if (json.usage?.input_tokens != null) inputTokens = json.usage.input_tokens;
              }
              if (json.type === "message_stop") {
                if (!outputTokens) outputTokens = Math.ceil(fullContent.length / 4);
                yield {
                  type: "done",
                  id,
                  model,
                  provider: this.name,
                  content: fullContent,
                  usage: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                  },
                  finishReason,
                  latencyMs: Date.now() - start,
                };
                clearTimeout(timeout);
                return;
              }
            } catch {
              // skip malformed
            }
          }
        }

        if (fullContent) {
          if (!outputTokens) outputTokens = Math.ceil(fullContent.length / 4);
          yield {
            type: "done",
            id,
            model,
            provider: this.name,
            content: fullContent,
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            finishReason,
            latencyMs: Date.now() - start,
          };
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
      clearTimeout(timeout);
    } catch (e: unknown) {
      clearTimeout(timeout);
      if (e instanceof Error && e.name === "AbortError") {
        yield { type: "error", code: "TIMEOUT", message: "Request timed out", retryable: true };
        return;
      }
      yield {
        type: "error",
        code: "PROVIDER_UNAVAILABLE",
        message: e instanceof Error ? e.message : "Unknown Anthropic stream error",
        retryable: true,
      };
    }
  }
}
