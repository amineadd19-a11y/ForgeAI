import { describe, it, expect, beforeAll } from "vitest";
import { MockProvider } from "../src/lib/ai/providers/mock";

describe("MockProvider streaming", () => {
  it("yields delta chunks then done", async () => {
    const p = new MockProvider();
    const events = [];
    for await (const ev of p.streamGenerate({ prompt: "stream hello" })) {
      events.push(ev);
    }
    expect(events.length).toBeGreaterThan(1);
    const deltas = events.filter((e) => e.type === "delta");
    const done = events.find((e) => e.type === "done");
    expect(deltas.length).toBeGreaterThan(0);
    expect(done).toBeTruthy();
    if (done && done.type === "done") {
      expect(done.content).toContain("stream hello");
      expect(done.provider).toBe("mock");
      expect(done.usage.totalTokens).toBeGreaterThan(0);
    }
    const reconstructed = deltas.map((d) => (d.type === "delta" ? d.content : "")).join("");
    if (done && done.type === "done") {
      expect(reconstructed).toBe(done.content);
    }
  });
});

describe("AI Gateway streamGenerate", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "mock";
  });

  it("streams via mock provider", async () => {
    const { getAiGateway } = await import("../src/lib/ai/gateway");
    const gateway = getAiGateway();
    const events = [];
    for await (const ev of gateway.streamGenerate({ prompt: "gateway stream" })) {
      events.push(ev);
    }
    const done = events.find((e) => e.type === "done");
    const errors = events.filter((e) => e.type === "error");
    expect(done).toBeTruthy();
    expect(errors.length).toBe(0);
    if (done && done.type === "done") {
      expect(done.content).toContain("gateway stream");
      expect(done.provider).toBe("mock");
    }
  });

  it("rejects oversized input on stream path", async () => {
    const { getAiGateway } = await import("../src/lib/ai/gateway");
    const gateway = getAiGateway();
    const big = "x".repeat(100_001);
    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of gateway.streamGenerate({ prompt: big })) {
        /* drain */
      }
    }).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("successful stream never emits error events", async () => {
    const { getAiGateway } = await import("../src/lib/ai/gateway");
    const events = [];
    for await (const ev of getAiGateway().streamGenerate({ prompt: "clean stream" })) {
      events.push(ev);
    }
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});

describe("Non-streaming generate still works", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "mock";
  });

  it("returns full response", async () => {
    const { getAiGateway } = await import("../src/lib/ai/gateway");
    const res = await getAiGateway().generate({ prompt: "non-stream" });
    expect(res.content).toContain("non-stream");
    expect(res.provider).toBe("mock");
  });
});
