import { describe, it, expect } from "vitest";
import { getCreditCost, PLANS, CREDIT_PACKS } from "../src/lib/config";

describe("pricing safety", () => {
  it("never returns zero or negative cost for known operations", () => {
    for (const op of ["generate", "analyze"] as const) {
      for (const c of ["basic", "standard", "advanced"] as const) {
        expect(getCreditCost(op, c)).toBeGreaterThan(0);
      }
    }
  });

  it("analyze costs more than generate at same complexity", () => {
    expect(getCreditCost("analyze", "standard")).toBeGreaterThan(
      getCreditCost("generate", "standard")
    );
  });

  it("plan prices are non-negative and ordered", () => {
    expect(PLANS.FREE.monthlyPriceCents).toBe(0);
    expect(PLANS.STARTER.monthlyPriceCents).toBeLessThan(PLANS.PRO.monthlyPriceCents);
    expect(PLANS.PRO.monthlyPriceCents).toBeLessThan(PLANS.BUSINESS.monthlyPriceCents);
  });

  it("credit packs have positive credits and prices", () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.credits).toBeGreaterThan(0);
      expect(pack.priceCents).toBeGreaterThan(0);
    }
  });
});
