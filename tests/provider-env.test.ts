import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  envPresence,
  hasNonEmptyEnv,
  isProviderConfigured,
  getConfiguredProviders,
} from "../src/lib/ai/provider-env";
import { estimateProviderCostUsd } from "../src/lib/ai/cost";

describe("provider-env", () => {
  const keys = [
    "AI_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_GEMINI_API_KEY",
    "XAI_API_KEY",
    "GROK_API_KEY",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("reports missing env", () => {
    expect(envPresence("OPENAI_API_KEY")).toEqual({
      exists: false,
      trimmedLength: 0,
    });
    expect(hasNonEmptyEnv("OPENAI_API_KEY")).toBe(false);
  });

  it("treats whitespace-only as empty", () => {
    process.env.OPENAI_API_KEY = "   ";
    expect(envPresence("OPENAI_API_KEY").trimmedLength).toBe(0);
    expect(isProviderConfigured("openai")).toBe(false);
  });

  it("detects OpenAI via AI_API_KEY or OPENAI_API_KEY", () => {
    process.env.AI_API_KEY = "sk-test";
    expect(isProviderConfigured("openai")).toBe(true);
    delete process.env.AI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-other";
    expect(isProviderConfigured("openai")).toBe(true);
  });

  it("maps configured providers without leaking values", () => {
    process.env.XAI_API_KEY = "xai-test-key";
    const cfg = getConfiguredProviders();
    expect(cfg.xai).toBe(true);
    expect(cfg.openai).toBe(false);
    expect(JSON.stringify(cfg)).not.toContain("xai-test");
  });
});

describe("cost estimates", () => {
  it("estimates gpt-4o-mini cost", () => {
    const est = estimateProviderCostUsd("gpt-4o-mini", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(est.estimatedUsd).toBeCloseTo(0.75, 5);
  });

  it("uses default rates for unknown models", () => {
    const est = estimateProviderCostUsd("unknown-model", {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(est.estimatedUsd).toBe(1);
  });
});
