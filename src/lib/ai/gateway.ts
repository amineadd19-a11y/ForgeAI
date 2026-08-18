import { AI_DEFAULTS } from "../config";
import { OpenAIProvider } from "./providers/openai";
import { AnthropicProvider } from "./providers/anthropic";
import { MockProvider } from "./providers/mock";
import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
} from "./types";

export class AiGateway {
  private providers: Map<string, AiProvider> = new Map();
  private primary: string;
  private fallback: string | null;

  constructor() {
    const providerName = (process.env.AI_PROVIDER || "openai").toLowerCase();
    this.primary = providerName;
    this.fallback = (process.env.AI_FALLBACK_PROVIDER || "anthropic").toLowerCase();

    this.providers.set("openai", new OpenAIProvider());
    this.providers.set("anthropic", new AnthropicProvider());
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
      try { status[name] = await provider.isAvailable(); } catch { status[name] = false; }
    }
    const primaryAvailable = status[this.primary] ?? false;
    return {
      primary: this.primary,
      available: primaryAvailable || (this.fallback ? status[this.fallback] ?? false : false) || (process.env.NODE_ENV !== "production" && status.mock),
      providers: status,
    };
  }

  private async runWithRetry(provider: AiProvider, req: AiGenerateRequest, retries: number): Promise<AiGenerateResponse> {
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

  async generate(req: AiGenerateRequest, options?: { retries?: number; allowFallback?: boolean }): Promise<AiGenerateResponse> {
    const text = req.prompt || req.messages?.map((m) => m.content).join("") || "";
    if (text.length > AI_DEFAULTS.maxInputChars) {
      throw { code: "INVALID_REQUEST", message: `Input exceeds maximum length of ${AI_DEFAULTS.maxInputChars} characters`, retryable: false } satisfies AiProviderError;
    }

    const retries = options?.retries ?? AI_DEFAULTS.maxRetries;
    const primary = this.getPrimaryProvider();
    try {
      return await this.runWithRetry(primary, req, retries);
    } catch (primaryError) {
      const error = primaryError as AiProviderError;
      const fallbackName = options?.allowFallback === false ? null : this.fallback;
      const fallback = fallbackName ? this.providers.get(fallbackName) : undefined;

      if (fallback && fallbackName !== this.primary && await fallback.isAvailable()) {
        try {
          const fallbackReq = fallbackName === "anthropic" && !req.model?.startsWith("claude-")
            ? { ...req, model: process.env.AI_FALLBACK_MODEL || "claude-3-5-haiku-latest" }
            : req;
          return await this.runWithRetry(fallback, fallbackReq, 1);
        } catch {
          // Preserve the primary error for callers and billing/observability.
        }
      }

      if (process.env.NODE_ENV !== "production" && this.primary !== "mock") {
        try {
          return await this.providers.get("mock")!.generate(req);
        } catch { /* ignore */ }
      }
      throw error;
    }
  }
}

let gateway: AiGateway | null = null;
export function getAiGateway(): AiGateway {
  if (!gateway) gateway = new AiGateway();
  return gateway;
}
