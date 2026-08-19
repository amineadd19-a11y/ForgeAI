import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
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
        .map((m: { name?: string; supportedGenerationMethods?: string[] }) => ({ name: m.name?.replace(/^models\//, ""), methods: m.supportedGenerationMethods || [] }))
        .filter((m: { name?: string; methods: string[] }) => m.name && m.methods.includes("generateContent"))
        .map((m: { name?: string }) => m.name!)
        .filter((name: string) => name.startsWith("gemini-"));
    } catch {
      return [];
    }
  }

  async generate(req: AiGenerateRequest): Promise<AiGenerateResponse> {
    if (!this.apiKey) {
      throw { code: "AUTH_ERROR", message: "Gemini API key not configured", provider: this.name, retryable: false } satisfies AiProviderError;
    }

    const model = req.model?.startsWith("gemini-") ? req.model : this.defaultModel;
    const rawMessages = req.messages || (req.prompt ? [{ role: "user" as const, content: req.prompt }] : []);
    if (rawMessages.length === 0) {
      throw { code: "INVALID_REQUEST", message: "No messages or prompt provided", provider: this.name, retryable: false } satisfies AiProviderError;
    }

    const systemMessages = rawMessages.filter((m) => m.role === "system").map((m) => m.content);
    const contents: GeminiContent[] = rawMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    if (contents.length === 0) contents.push({ role: "user", parts: [{ text: systemMessages.join("\n\n") }] });

    const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 60000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
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

      const res = await fetch(`${GOOGLE_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const responseBody = await res.text();
        let code: AiProviderError["code"] = "UNKNOWN";
        if (res.status === 429) code = "RATE_LIMITED";
        else if (res.status === 401 || res.status === 403) code = "AUTH_ERROR";
        else if (res.status >= 500) code = "PROVIDER_UNAVAILABLE";
        else if (res.status === 400) code = "INVALID_REQUEST";
        throw { code, message: `Google Gemini error ${res.status}: ${responseBody.slice(0, 240)}`, provider: this.name, retryable: res.status === 429 || res.status >= 500, statusCode: res.status } satisfies AiProviderError;
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
        usage: { inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0, totalTokens: usage.totalTokenCount ?? 0 },
        finishReason: candidate?.finishReason ?? null,
        latencyMs,
      };
    } catch (e: unknown) {
      clearTimeout(timeout);
      if ((e as AiProviderError).code) throw e;
      if ((e as Error).name === "AbortError") throw { code: "TIMEOUT", message: "Google Gemini request timed out", provider: this.name, retryable: true } satisfies AiProviderError;
      throw { code: "PROVIDER_UNAVAILABLE", message: (e as Error).message || "Unknown Google Gemini error", provider: this.name, retryable: true } satisfies AiProviderError;
    }
  }
}
