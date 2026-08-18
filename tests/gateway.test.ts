import { describe, it, expect, beforeAll } from "vitest";

describe("AI Gateway", () => {
  beforeAll(() => {
    process.env.AI_PROVIDER = "mock";
    process.env.NODE_ENV = "test";
  });

  it("generates via mock", async () => {
    const { getAiGateway } = await import("../src/lib/ai/gateway");
    const gateway = getAiGateway();
    const res = await gateway.generate({ prompt: "gateway test" });
    expect(res.content).toBeTruthy();
    expect(res.provider).toBe("mock");
  });

  it("rejects oversized input without calling provider charge path", async () => {
    const { getAiGateway } = await import("../src/lib/ai/gateway");
    const gateway = getAiGateway();
    const big = "x".repeat(100_001);
    await expect(gateway.generate({ prompt: big })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });
});
