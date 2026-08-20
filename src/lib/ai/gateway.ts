import { AI_DEFAULTS } from "../config";
import { OpenAIProvider } from "./providers/openai";
import { AnthropicProvider } from "./providers/anthropic";
import { GoogleProvider } from "./providers/google";
import { XaiProvider } from "./providers/xai";
import { MockProvider } from "./providers/mock";
import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
  AiStreamEvent,
} from "./types";

export class AiGateway {
  private providers: Map<string, AiProvider> = new Map();
  private primary: string;
  private fallback: string | null;

  constructor() {
    const providerName = (process.env.AI_PROVIDER || "openai").toLowerCase();
    this.primary = providerName;
    this.fallback = (process.env.AI_FALLBACK_PROVIDER || "xai").toLowerCase();

    this.providers.set("openai", new OpenAIProvider());
    this.providers.set("anthropic", new AnthropicProvider());
    this.providers.set("google", new GoogleProvider());
    this.providers.set("xai", new XaiProvider());
    this.providers.set("mock", new MockProvider());
  }

  getPrimaryProvider(): AiProvider {
    const p = this.providers.get(this.primary);
    if (p) return p;
    if (process.env.NODE_ENV !== "production") return this.providers.get("mock")!;
    throw new Error(`AI provider "${this.primary}" not configured`);
  }

  async health(): Promise<{ primary: string; available: boolean; providers: Record<string, boolean> }> {
    const status: Record<string, boolean> = {};
    for (const [name, provider] of this.providers) {
      try {
        status[name] = await provider.isAvailable();
      } catch {
        status[name] = false;
      }
    }
    const primaryAvailable = status[this.primary] ?? false;
    const fallbackAvailable = this.fallback ? status[this.fallback] ?? false : false;
    const anyAvailable = Object.values(status).some(Boolean);
    const localMockAvailable = process.env.NODE_ENV !== "production" && status.mock;
    return {
      primary: this.primary,
      available: primaryAvailable || fallbackAvailable || anyAvailable || Boolean(localMockAvailable),
      providers: status,
    };
  }

  private async runWithRetry(
    provider: AiProvider,
    req: AiGenerateRequest,
    retries: number
  ): Promise<AiGenerateResponse> {
    let lastError: AiProviderError | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await provider.generate(req);
      } catch (e) {
        lastError = e as AiProviderError;
        if (!lastError.retryable || attempt === retries) break;
        const delay = Math.min(1500 * Math.pow(2, attempt), 8000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError || { code: "UNKNOWN", message: "AI request failed", retryable: false };
  }

  private fallbackRequest(providerName: string, req: AiGenerateRequest): AiGenerateRequest {
    if (providerName === "google") {
      return { ...req, model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite" };
    }
    if (providerName === "anthropic") {
      return { ...req, model: process.env.AI_FALLBACK_MODEL || "claude-3-5-haiku-latest" };
    }
    if (providerName === "xai") {
      return { ...req, model: process.env.XAI_MODEL || "grok-3-mini" };
    }
    return req;
  }

  private validateInput(req: AiGenerateRequest) {
    const text = req.prompt || req.messages?.map((m) => m.content).join("") || "";
    if (text.length > AI_DEFAULTS.maxInputChars) {
      throw {
        code: "INVALID_REQUEST",
        message: `Input exceeds maximum length of ${AI_DEFAULTS.maxInputChars} characters`,
        retryable: false,
      } satisfies AiProviderError;
    }
  }

  async generate(
    req: AiGenerateRequest,
    options?: { retries?: number; allowFallback?: boolean }
  ): Promise<AiGenerateResponse> {
    this.validateInput(req);

    const retries = options?.retries ?? AI_DEFAULTS.maxRetries;
    const primary = this.getPrimaryProvider();
    try {
      return await this.runWithRetry(primary, req, retries);
    } catch (primaryError) {
      const error = primaryError as AiProviderError;
      if (options?.allowFallback === false) throw error;

      const candidates = [this.fallback, "xai", "google", "anthropic", "openai"].filter(
        (name, index, all): name is string =>
          Boolean(name) && name !== this.primary && all.indexOf(name) === index
      );

      for (const fallbackName of candidates) {
        const fallback = this.providers.get(fallbackName);
        if (!fallback) continue;
        try {
          if (!(await fallback.isAvailable())) continue;
          return await this.runWithRetry(fallback, this.fallbackRequest(fallbackName, req), 1);
        } catch {
          // Try the next configured provider without masking the original error.
        }
      }

      if (process.env.NODE_ENV !== "production" && this.primary !== "mock") {
        try {
          return await this.providers.get("mock")!.generate(req);
        } catch {
          /* ignore */
        }
      }
      throw error;
    }
  }

  /**
   * Stream tokens from the primary provider (or fallback chain).
   * If a provider lacks streamGenerate, falls back to non-streaming generate
   * and emits a single delta + done (compatible API, no partial tokens).
   */
  async *streamGenerate(
    req: AiGenerateRequest,
    options?: { allowFallback?: boolean }
  ): AsyncGenerator<AiStreamEvent, void, unknown> {
    this.validateInput(req);

    const tryProvider = async function* (
      this: AiGateway,
      provider: AiProvider,
      request: AiGenerateRequest
    ): AsyncGenerator<AiStreamEvent, boolean, unknown> {
      if (typeof provider.streamGenerate === "function") {
        let sawDone = false;
        let sawError = false;
        for await (const event of provider.streamGenerate(request)) {
          yield event;
          if (event.type === "done") sawDone = true;
          if (event.type === "error") sawError = true;
        }
        return sawDone && !sawError;
      }

      // Synthetic stream from non-streaming generate
      try {
        const res = await provider.generate(request);
        if (res.content) yield { type: "delta", content: res.content };
        yield {
          type: "done",
          id: res.id,
          model: res.model,
          provider: res.provider,
          content: res.content,
          usage: res.usage,
          finishReason: res.finishReason,
          latencyMs: res.latencyMs,
        };
        return true;
      } catch (e) {
        const err = e as AiProviderError;
        yield {
          type: "error",
          code: err.code || "UNKNOWN",
          message: err.message || "Provider error",
          retryable: err.retryable ?? false,
        };
        return false;
      }
    }.bind(this);

    const primary = this.getPrimaryProvider();
    const ok = yield* tryProvider(primary, req);
    if (ok) return;
    if (options?.allowFallback === false) return;

    const candidates = [this.fallback, "xai", "google", "anthropic", "openai", "mock"].filter(
      (name, index, all): name is string =>
        Boolean(name) && name !== this.primary && all.indexOf(name) === index
    );

    for (const name of candidates) {
      if (name === "mock" && process.env.NODE_ENV === "production") continue;
      const provider = this.providers.get(name);
      if (!provider) continue;
      try {
        if (!(await provider.isAvailable())) continue;
      } catch {
        continue;
      }
      const success = yield* tryProvider(provider, this.fallbackRequest(name, req));
      if (success) return;
    }
  }
}

let gateway: AiGateway | null = null;
export function getAiGateway(): AiGateway {
  if (!gateway) gateway = new AiGateway();
  return gateway;
}
