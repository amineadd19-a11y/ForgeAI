import { AI_DEFAULTS } from "../config";
import { OpenAIProvider } from "./providers/openai";
import { MockProvider } from "./providers/mock";
import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
} from "./types";

/**
 * AI Gateway — provider-agnostic entry point.
 * Selects provider based on AI_PROVIDER env, supports fallback, retries,
 * timeouts, and structured errors. Never exposes provider keys.
 */
export class AiGateway {
  private providers: Map<string, AiProvider> = new Map();
  private primary: string;

  constructor() {
    const providerName = (process.env.AI_PROVIDER || "openai").toLowerCase();
    this.primary = providerName;

    this.providers.set("openai", new OpenAIProvider());
    this.providers.set("mock", new MockProvider());
  }

  getPrimaryProvider(): AiProvider {
    const p = this.providers.get(this.primary);
    if (p) return p;
    if (process.env.NODE_ENV !== "production") {
      return this.providers.get("mock")!;
    }
    throw new Error(`AI provider "${this.primary}" not configured`);
  }

  async health(): Promise<{
    primary: string;
    available: boolean;
    providers: Record<string, boolean>;
  }> {
    const status: Record<string, boolean> = {};
    for (const [name, provider] of this.providers) {
      try {
        status[name] = await provider.isAvailable();
      } catch {
        status[name] = false;
      }
    }
    const primaryAvailable = status[this.primary] ?? false;
    return {
      primary: this.primary,
      available: primaryAvailable || (process.env.NODE_ENV !== "production" && status["mock"]),
      providers: status,
    };
  }

  async generate(
    req: AiGenerateRequest,
    options?: { retries?: number; allowFallback?: boolean }
  ): Promise<AiGenerateResponse> {
    const text =
      req.prompt ||
      req.messages?.map((m) => m.content).join("") ||
      "";
    if (text.length > AI_DEFAULTS.maxInputChars) {
      const err: AiProviderError = {
        code: "INVALID_REQUEST",
        message: `Input exceeds maximum length of ${AI_DEFAULTS.maxInputChars} characters`,
        retryable: false,
      };
      throw err;
    }

    const retries = options?.retries ?? AI_DEFAULTS.maxRetries;
    let lastError: AiProviderError | null = null;
    const provider = this.getPrimaryProvider();

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await provider.generate(req);
      } catch (e) {
        lastError = e as AiProviderError;
        if (!lastError.retryable || attempt === retries) break;
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
      }
    }

    if (
      options?.allowFallback !== false &&
      process.env.NODE_ENV !== "production" &&
      this.primary !== "mock"
    ) {
      try {
        const mock = this.providers.get("mock");
        if (mock) return await mock.generate(req);
      } catch {
        // ignore
      }
    }

    throw lastError || {
      code: "UNKNOWN",
      message: "AI request failed",
      retryable: false,
    };
  }
}

let gateway: AiGateway | null = null;

export function getAiGateway(): AiGateway {
  if (!gateway) gateway = new AiGateway();
  return gateway;
}
