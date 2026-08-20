import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
  AiStreamEvent,
} from "../types";

const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash-lite";

type GeminiContent = { role: "user" | "model"; parts: { text: string }[] };

export class GoogleProvider implements AiProvider {
  name = "google";
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey?: string, defaultModel = DEFAULT_MODEL) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || "";
    this.defaultModel = process.env.GEMINI_MODEL || defaultModel;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async listModels(): Promise<string[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch(`${GOOGLE_BASE}/models?key=${encodeURIComponent(this.apiKey)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || [])
        .map((m: { name?: string; supportedGenerationMethods?: string[] }) => ({
          name: m.name?.replace(/^models\//, ""),
          methods: m.supportedGenerationMethods || [],
        }))
        .filter((m: { name?: string; methods: string[] }) => m.name && m.methods.includes("generateContent"))
        .map((m: { name?: string }) => m.name!)
        .filter((name: string) => name.startsWith("gemini-"));
    } catch {
      return [];
    }
  }

  private buildBody(req: AiGenerateRequest) {
    const model = req.model?.startsWith("gemini-") ? req.model : this.defaultModel;
    const rawMessages = req.messages || (req.prompt ? [{ role: "user" as const, content: req.prompt }] : []);
    if (rawMessages.length === 0) {
      throw {
        code: "INVALID_REQUEST",
        message: "No messages or prompt provided",
        provider: this.name,
        retryable: false,
      } satisfies AiProviderError;
    }

    const systemMessages = rawMessages.filter((m) => m.role === "system").map((m) => m.content);
    const contents: GeminiContent[] = rawMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    if (contents.length === 0) contents.push({ role: "user", parts: [{ text: systemMessages.join("\n\n") }] });

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.7,
        ...(req.topP === undefined ? {} : { topP: req.topP }),
        ...(req.stop?.length ? { stopSequences: req.stop } : {}),
      },
    };
    if (systemMessages.length) body.systemInstruction = { parts: [{ text: systemMessages.join("\n\n") }] };
    return { model, body };
  }

  async generate(req: AiGenerateRequest): Promise<AiGenerateResponse> {
    if (!this.apiKey) {
      throw {
        code: "AUTH_ERROR",
        message: "Gemini API key not configured",
        provider: this.name,
        retryable: false,
      } satisfies AiProviderError;
    }

    const { model, body } = this.buildBody(req);
    const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 60000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
      const res = await fetch(
        `${GOOGLE_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const responseBody = await res.text();
        let code: AiProviderError["code"] = "UNKNOWN";
        if (res.status === 429) code = "RATE_LIMITED";
        else if (res.status === 401 || res.status === 403) code = "AUTH_ERROR";
        else if (res.status >= 500) code = "PROVIDER_UNAVAILABLE";
        else if (res.status === 400) code = "INVALID_REQUEST";
        throw {
          code,
          message: `Google Gemini error ${res.status}: ${responseBody.slice(0, 240)}`,
          provider: this.name,
          retryable: res.status === 429 || res.status >= 500,
          statusCode: res.status,
        } satisfies AiProviderError;
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      const content = (candidate?.content?.parts || []).map((part: { text?: string }) => part.text || "").join("");
      const usage = data.usageMetadata || {};

      return {
        id: data.responseId || `google_${Date.now()}`,
        content,
        model,
        provider: this.name,
        usage: {
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: usage.candidatesTokenCount ?? 0,
          totalTokens: usage.totalTokenCount ?? 0,
        },
        finishReason: candidate?.finishReason ?? null,
        latencyMs,
      };
    } catch (e: unknown) {
      clearTimeout(timeout);
      if ((e as AiProviderError).code) throw e;
      if ((e as Error).name === "AbortError")
        throw {
          code: "TIMEOUT",
          message: "Google Gemini request timed out",
          provider: this.name,
          retryable: true,
        } satisfies AiProviderError;
      throw {
        code: "PROVIDER_UNAVAILABLE",
        message: (e as Error).message || "Unknown Google Gemini error",
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
        message: "Gemini API key not configured",
        retryable: false,
      };
      return;
    }

    let model: string;
    let body: Record<string, unknown>;
    try {
      const built = this.buildBody(req);
      model = built.model;
      body = built.body;
    } catch (e) {
      const err = e as AiProviderError;
      yield {
        type: "error",
        code: err.code || "INVALID_REQUEST",
        message: err.message || "Invalid request",
        retryable: false,
      };
      return;
    }

    const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 60000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
      const res = await fetch(
        `${GOOGLE_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );

      if (!res.ok) {
        clearTimeout(timeout);
        const responseBody = await res.text();
        let code: AiProviderError["code"] = "UNKNOWN";
        if (res.status === 429) code = "RATE_LIMITED";
        else if (res.status === 401 || res.status === 403) code = "AUTH_ERROR";
        else if (res.status >= 500) code = "PROVIDER_UNAVAILABLE";
        yield {
          type: "error",
          code,
          message: `Google Gemini error ${res.status}: ${responseBody.slice(0, 200)}`,
          retryable: res.status === 429 || res.status >= 500,
        };
        return;
      }

      if (!res.body) {
        clearTimeout(timeout);
        yield {
          type: "error",
          code: "PROVIDER_UNAVAILABLE",
          message: "Google Gemini returned empty stream body",
          retryable: true,
        };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let finishReason: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let responseId = `google_${Date.now()}`;

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
            if (!payload || payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload) as {
                responseId?: string;
                candidates?: Array<{
                  content?: { parts?: Array<{ text?: string }> };
                  finishReason?: string;
                }>;
                usageMetadata?: {
                  promptTokenCount?: number;
                  candidatesTokenCount?: number;
                  totalTokenCount?: number;
                };
              };
              if (json.responseId) responseId = json.responseId;
              const text = (json.candidates?.[0]?.content?.parts || [])
                .map((p) => p.text || "")
                .join("");
              if (text) {
                fullContent += text;
                yield { type: "delta", content: text };
              }
              if (json.candidates?.[0]?.finishReason) {
                finishReason = json.candidates[0].finishReason;
              }
              if (json.usageMetadata) {
                inputTokens = json.usageMetadata.promptTokenCount ?? inputTokens;
                outputTokens = json.usageMetadata.candidatesTokenCount ?? outputTokens;
              }
            } catch {
              // skip
            }
          }
        }

        if (!outputTokens) outputTokens = Math.ceil(fullContent.length / 4);
        yield {
          type: "done",
          id: responseId,
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
      if ((e as Error).name === "AbortError") {
        yield {
          type: "error",
          code: "TIMEOUT",
          message: "Google Gemini request timed out",
          retryable: true,
        };
        return;
      }
      yield {
        type: "error",
        code: "PROVIDER_UNAVAILABLE",
        message: (e as Error).message || "Unknown Google Gemini stream error",
        retryable: true,
      };
    }
  }
}
