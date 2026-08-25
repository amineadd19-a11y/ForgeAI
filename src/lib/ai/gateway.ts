import { AI_DEFAULTS } from "../config";
import { OpenAIProvider } from "./providers/openai";
import { AnthropicProvider } from "./providers/anthropic";
import { GoogleProvider } from "./providers/google";
import { XaiProvider } from "./providers/xai";
import { OpenRouterProvider } from "./providers/openrouter";
import { MockProvider } from "./providers/mock";
import { getConfiguredProviders, getPrimaryProviderName, isProviderConfigured, type ProviderId } from "./provider-env";
import { AiGenerateRequest, AiGenerateResponse, AiProvider, AiProviderError, AiStreamEvent } from "./types";

export type GatewayHealth = {
  primary: string;
  /** True when a real (non-mock) provider is usable, or mock in non-production. */
  available: boolean;
  /** True when primary has credentials AND isAvailable() succeeded (production). */
  productionReady: boolean;
  providers: Record<string, boolean>;
  /** Key presence only — not live API reachability. */
  configured: Record<string, boolean>;
};

export class AiGateway {
  private providers: Map<string, AiProvider> = new Map();
  private primary: string;
  private fallback: string | null;

  constructor() {
    this.primary = getPrimaryProviderName();
    this.fallback = (process.env.AI_FALLBACK_PROVIDER || "xai").toLowerCase();
    this.providers.set("openai", new OpenAIProvider());
    this.providers.set("anthropic", new AnthropicProvider());
    this.providers.set("google", new GoogleProvider());
    this.providers.set("xai", new XaiProvider());
    this.providers.set("openrouter", new OpenRouterProvider());
    this.providers.set("mock", new MockProvider());
  }

  getPrimaryProvider(): AiProvider {
    const p = this.providers.get(this.primary);
    if (p) return p;
    if (process.env.NODE_ENV !== "production") return this.providers.get("mock")!;
    throw new Error(`AI provider "${this.primary}" not configured`);
  }

  async health(): Promise<GatewayHealth> {
    const status: Record<string, boolean> = {};
    for (const [name, provider] of this.providers) {
      try { status[name] = await provider.isAvailable(); } catch { status[name] = false; }
    }
    const configured = getConfiguredProviders();
    const isProd = process.env.NODE_ENV === "production";
    const realAvailable = (Object.entries(status) as [string, boolean][]).some(([name, ok]) => ok && name !== "mock");
    const mockOk = Boolean(status.mock);
    const primaryAvailable = status[this.primary] ?? false;
    const fallbackAvailable = this.fallback ? status[this.fallback] ?? false : false;
    const available = isProd ? realAvailable || (this.primary !== "mock" && (primaryAvailable || fallbackAvailable)) : primaryAvailable || fallbackAvailable || realAvailable || mockOk;
    const primaryConfigured = this.primary === "mock" ? !isProd : isProviderConfigured(this.primary as ProviderId);
    const productionReady = isProd && primaryConfigured && primaryAvailable && this.primary !== "mock";
    return { primary: this.primary, available: Boolean(available), productionReady: Boolean(productionReady), providers: status, configured: { openai: configured.openai, anthropic: configured.anthropic, google: configured.google, xai: configured.xai, openrouter: configured.openrouter, mock: configured.mock } };
  }

  private async runWithRetry(provider: AiProvider, req: AiGenerateRequest, retries: number): Promise<AiGenerateResponse> {
    let lastError: AiProviderError | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try { return await provider.generate(req); } catch (e) {
        lastError = e as AiProviderError;
        if (!lastError.retryable || attempt === retries) break;
        const delay = Math.min(1500 * Math.pow(2, attempt), 8000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError || { code: "UNKNOWN", message: "AI request failed", retryable: false };
  }

  private fallbackRequest(providerName: string, req: AiGenerateRequest): AiGenerateRequest {
    if (providerName === "google") return { ...req, model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite" };
    if (providerName === "anthropic") return { ...req, model: process.env.AI_FALLBACK_MODEL || "claude-3-5-haiku-latest" };
    if (providerName === "xai") return { ...req, model: process.env.XAI_MODEL || "grok-3-mini" };
    if (providerName === "openrouter") return { ...req, model: "stealth/ox-alpha" };
    return req;
  }

  private validateInput(req: AiGenerateRequest) {
    const text = req.prompt || req.messages?.map((m) => m.content).join("") || "";
    if (text.length > AI_DEFAULTS.maxInputChars) {
      throw { code: "INVALID_REQUEST", message: `Input exceeds maximum length of ${AI_DEFAULTS.maxInputChars} characters`, retryable: false } satisfies AiProviderError;
    }
  }

  async generate(req: AiGenerateRequest, options?: { retries?: number; allowFallback?: boolean }): Promise<AiGenerateResponse> {
    this.validateInput(req);
    const retries = options?.retries ?? AI_DEFAULTS.maxRetries;
    const primary = this.getPrimaryProvider();
    try { return await this.runWithRetry(primary, req, retries); }
    catch (primaryError) {
      const error = primaryError as AiProviderError;
      if (options?.allowFallback === false) throw error;
      const candidates = [this.fallback, "openrouter", "xai", "google", "anthropic", "openai"].filter((name, index, all): name is string => Boolean(name) && name !== this.primary && all.indexOf(name) === index);
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
        try { return await this.providers.get("mock")!.generate(req); } catch { /* ignore */ }
      }
      throw error;
    }
  }

  private async collectProviderStream(provider: AiProvider, request: AiGenerateRequest, signal?: AbortSignal): Promise<
    | { kind: "success"; events: AiStreamEvent[] }
    | { kind: "aborted" }
    | { kind: "failBeforeContent"; error: Extract<AiStreamEvent, { type: "error" }> }
    | { kind: "failAfterContent"; events: AiStreamEvent[]; error: Extract<AiStreamEvent, { type: "error" }> }
  > {
    if (signal?.aborted) return { kind: "aborted" };
    const events: AiStreamEvent[] = [];
    let sawDelta = false;
    const runNative = async () => {
      if (typeof provider.streamGenerate !== "function") return null;
      for await (const event of provider.streamGenerate(request, { signal })) {
        if (signal?.aborted) return { kind: "aborted" as const };
        if (event.type === "delta") { sawDelta = true; events.push(event); }
        else if (event.type === "done") { events.push(event); return { kind: "success" as const, events }; }
        else if (event.type === "error") {
          if (sawDelta) return { kind: "failAfterContent" as const, events, error: event };
          return { kind: "failBeforeContent" as const, error: event };
        }
      }
      if (signal?.aborted) return { kind: "aborted" as const };
      if (events.some((e) => e.type === "done")) return { kind: "success" as const, events };
      if (sawDelta) return { kind: "failAfterContent" as const, events, error: { type: "error" as const, code: "PROVIDER_UNAVAILABLE" as const, message: "Stream ended without completion", retryable: true } };
      return { kind: "failBeforeContent" as const, error: { type: "error" as const, code: "PROVIDER_UNAVAILABLE" as const, message: "Empty stream from provider", retryable: true } };
    };
    if (typeof provider.streamGenerate === "function") return (await runNative())!;
    try {
      const res = await provider.generate(request);
      if (signal?.aborted) return { kind: "aborted" };
      const synthetic: AiStreamEvent[] = [];
      if (res.content) synthetic.push({ type: "delta", content: res.content });
      synthetic.push({ type: "done", id: res.id, model: res.model, provider: res.provider, content: res.content, usage: res.usage, finishReason: res.finishReason, latencyMs: res.latencyMs });
      return { kind: "success", events: synthetic };
    } catch (e) {
      if (signal?.aborted) return { kind: "aborted" };
      const err = e as AiProviderError;
      return { kind: "failBeforeContent", error: { type: "error", code: err.code || "UNKNOWN", message: err.message || "Provider error", retryable: err.retryable ?? false } };
    }
  }

  async *streamGenerate(req: AiGenerateRequest, options?: { allowFallback?: boolean; signal?: AbortSignal }): AsyncGenerator<AiStreamEvent, void, unknown> {
    this.validateInput(req);
    const signal = options?.signal;
    if (signal?.aborted) return;
    const ordered: AiProvider[] = [];
    ordered.push(this.getPrimaryProvider());
    if (options?.allowFallback !== false) {
      const candidates = [this.fallback, "openrouter", "xai", "google", "anthropic", "openai", "mock"].filter((name, index, all): name is string => Boolean(name) && name !== this.primary && all.indexOf(name) === index);
      for (const name of candidates) {
        if (name === "mock" && process.env.NODE_ENV === "production") continue;
        const provider = this.providers.get(name);
        if (!provider) continue;
        try { if (!(await provider.isAvailable())) continue; } catch { continue; }
        ordered.push(provider);
      }
    }
    let lastError: Extract<AiStreamEvent, { type: "error" }> | null = null;
    for (const provider of ordered) {
      if (signal?.aborted) return;
      const request = provider.name === this.primary ? req : this.fallbackRequest(provider.name, req);
      const result = await this.collectProviderStream(provider, request, signal);
      if (result.kind === "aborted") return;
      if (result.kind === "success") { for (const event of result.events) { if (signal?.aborted) return; yield event; } return; }
      if (result.kind === "failAfterContent") { for (const event of result.events) { if (signal?.aborted) return; yield event; } if (!signal?.aborted) yield result.error; return; }
      lastError = result.error;
    }
    if (signal?.aborted) return;
    yield lastError || { type: "error", code: "PROVIDER_UNAVAILABLE", message: "All AI providers failed", retryable: true };
  }
}

let gateway: AiGateway | null = null;
export function getAiGateway(): AiGateway {
  if (!gateway) gateway = new AiGateway();
  return gateway;
}
