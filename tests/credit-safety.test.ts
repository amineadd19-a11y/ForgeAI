import { describe, it, expect, beforeAll } from "vitest";
import { isModelAllowed, getModelsForPlan, PLANS, MODEL_CATALOG } from "../src/lib/config";
import { getCreditCost } from "../src/lib/config";

describe("plan-filtered model catalog (playground)", () => {
  it("FREE plan never includes STARTER-only models", () => {
    const free = getModelsForPlan("FREE");
    expect(free.every((m) => isModelAllowed("FREE", m.id))).toBe(true);
    expect(free.some((m) => m.id === "gpt-4o")).toBe(false);
    expect(isModelAllowed("FREE", "gpt-4o")).toBe(false);
  });

  it("STARTER and PRO see expanded catalogs", () => {
    const starter = getModelsForPlan("STARTER");
    expect(starter.some((m) => m.id === "gpt-4o")).toBe(true);
    expect(starter.some((m) => m.id === "grok-3")).toBe(true);
    expect(getModelsForPlan("PRO").length).toBe(MODEL_CATALOG.length);
    expect(getModelsForPlan("BUSINESS").length).toBe(MODEL_CATALOG.length);
  });

  it("unknown plan key is not a valid PlanTier — callers must fail safe", () => {
    // Playground server component only accepts known PLANS keys; invalid tier falls back to FREE.
    const maybe = "ENTERPRISE" as keyof typeof PLANS;
    expect(PLANS[maybe]).toBeUndefined();
  });

  it("server-side isModelAllowed remains authoritative for unauthorized models (403)", () => {
    expect(isModelAllowed("FREE", "gpt-4o")).toBe(false);
    expect(isModelAllowed("STARTER", "gpt-4o")).toBe(true);
    expect(isModelAllowed("PRO", "gpt-4o")).toBe(true);
  });

  it("does not invent a second plan system — uses PLANS + isModelAllowed", () => {
    expect(PLANS.FREE.allowedModels).toContain("gpt-4o-mini");
    expect(getModelsForPlan("FREE").map((m) => m.id)).toEqual(
      expect.arrayContaining(["gpt-4o-mini", "grok-3-mini"])
    );
  });
});

describe("credit cost is deterministic (exactly-once charge amount)", () => {
  it("basic/standard/advanced map to fixed costs", () => {
    expect(getCreditCost("generate", "basic")).toBe(1);
    expect(getCreditCost("generate", "standard")).toBe(2);
    expect(getCreditCost("generate", "advanced")).toBe(5);
  });
});

describe("stream abort semantics (gateway signal)", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "mock";
  });

  it("pre-aborted signal yields no terminal done or error", async () => {
    const { getAiGateway } = await import("../src/lib/ai/gateway");
    const ac = new AbortController();
    ac.abort();
    const events = [];
    for await (const ev of getAiGateway().streamGenerate(
      { prompt: "should not complete" },
      { signal: ac.signal }
    )) {
      events.push(ev);
    }
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("abort mid-stream yields no done (incomplete → zero charge path)", async () => {
    const { getAiGateway } = await import("../src/lib/ai/gateway");
    const ac = new AbortController();
    const events = [];
    const iter = getAiGateway().streamGenerate({ prompt: "abort me please now" }, { signal: ac.signal });
    for await (const ev of iter) {
      events.push(ev);
      if (ev.type === "delta") {
        ac.abort();
      }
    }
    expect(events.some((e) => e.type === "delta")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("successful stream still emits single done without error", async () => {
    const { getAiGateway } = await import("../src/lib/ai/gateway");
    const events = [];
    for await (const ev of getAiGateway().streamGenerate({ prompt: "ok" })) {
      events.push(ev);
    }
    const terminals = events.filter((e) => e.type === "done" || e.type === "error");
    expect(terminals).toHaveLength(1);
    expect(terminals[0].type).toBe("done");
  });
});

describe("non-streaming generate unchanged", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "mock";
  });

  it("returns provider response", async () => {
    const { getAiGateway } = await import("../src/lib/ai/gateway");
    const res = await getAiGateway().generate({ prompt: "still works" });
    expect(res.content).toContain("still works");
    expect(res.provider).toBe("mock");
  });
});
