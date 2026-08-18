import { describe, it, expect } from "vitest";
import {
  getCreditCost,
  isModelAllowed,
  PLANS,
  CREDIT_COSTS,
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
