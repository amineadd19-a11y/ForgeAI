import { describe, it, expect } from "vitest";
import {
  getCreditCost,
  isModelAllowed,
  PLANS,
  CREDIT_COSTS,
  MODEL_CATALOG,
  getModelsForPlan,
  getModelEntry,
  providerLabel,
} from "../src/lib/config";

describe("credit costs", () => {
  it("returns defined costs for generate", () => {
    expect(getCreditCost("generate", "basic")).toBe(CREDIT_COSTS.generate.basic);
    expect(getCreditCost("generate", "standard")).toBe(CREDIT_COSTS.generate.standard);
    expect(getCreditCost("generate", "advanced")).toBe(CREDIT_COSTS.generate.advanced);
  });

  it("returns defined costs for analyze", () => {
    expect(getCreditCost("analyze", "basic")).toBe(3);
    expect(getCreditCost("analyze", "standard")).toBe(5);
    expect(getCreditCost("analyze", "advanced")).toBe(10);
  });
});

describe("plans", () => {
  it("defines all four tiers", () => {
    expect(PLANS.FREE.includedCredits).toBe(100);
    expect(PLANS.STARTER.monthlyPriceCents).toBe(900);
    expect(PLANS.PRO.monthlyPriceCents).toBe(2900);
    expect(PLANS.BUSINESS.monthlyPriceCents).toBe(9900);
  });

  it("enforces model allow-lists", () => {
    expect(isModelAllowed("FREE", "gpt-4o-mini")).toBe(true);
    expect(isModelAllowed("FREE", "gpt-4o")).toBe(false);
    expect(isModelAllowed("PRO", "gpt-4o")).toBe(true);
    expect(isModelAllowed("BUSINESS", "any-model")).toBe(true);
  });
});

describe("MODEL_CATALOG", () => {
  it("includes OpenAI, Anthropic, Gemini, and Grok models", () => {
    const providers = new Set(MODEL_CATALOG.map((m) => m.provider));
    expect(providers.has("openai")).toBe(true);
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("google")).toBe(true);
    expect(providers.has("xai")).toBe(true);
  });

  it("filters models by plan for playground selector", () => {
    const free = getModelsForPlan("FREE");
    expect(free.every((m) => isModelAllowed("FREE", m.id))).toBe(true);
    expect(free.some((m) => m.id === "gpt-4o-mini")).toBe(true);
    expect(free.some((m) => m.id === "gpt-4o")).toBe(false);

    const starter = getModelsForPlan("STARTER");
    expect(starter.some((m) => m.id === "gpt-4o")).toBe(true);
    expect(starter.some((m) => m.id === "grok-3")).toBe(true);

    const pro = getModelsForPlan("PRO");
    expect(pro.length).toBe(MODEL_CATALOG.length);
  });

  it("resolves model metadata and provider labels", () => {
    const entry = getModelEntry("grok-3-mini");
    expect(entry?.provider).toBe("xai");
    expect(providerLabel("xai")).toContain("Grok");
    expect(providerLabel("openai")).toBe("OpenAI");
  });
});
