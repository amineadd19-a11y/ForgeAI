import { describe, it, expect } from "vitest";
import { MockProvider } from "../src/lib/ai/providers/mock";

describe("MockProvider", () => {
  it("is available and returns structured response", async () => {
    const p = new MockProvider();
    expect(await p.isAvailable()).toBe(true);
    const res = await p.generate({ prompt: "Hello test" });
    expect(res.provider).toBe("mock");
    expect(res.content).toContain("Hello test");
    expect(res.usage.inputTokens).toBeGreaterThan(0);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
