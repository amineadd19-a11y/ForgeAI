import { describe, it, expect } from "vitest";
import {
  createInMemoryToolRegistry,
  type ToolDefinition,
  type ToolInvocationContext,
} from "../src/lib/tools/registry";

const sampleTool: ToolDefinition = {
  id: "demo.echo",
  name: "Echo",
  description: "Echo input for tests",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to echo" },
    },
    required: ["text"],
    additionalProperties: false,
  },
  requiredPermissions: ["tools:invoke:demo.echo"],
  timeoutMs: 5_000,
  maxConcurrency: 2,
  maxInvocationsPerMinute: 30,
  sideEffects: "none",
  enabled: true,
};

function ctx(
  perms: Array<"tools:read" | "tools:invoke" | "tools:admin" | `tools:invoke:${string}`>,
  remainingCalls = 5,
  budgetMs = 10_000
): ToolInvocationContext {
  return {
    userId: "user_1",
    requestId: "req_1",
    permissions: new Set(perms),
    budgetMs,
    remainingCalls,
  };
}

describe("tool registry", () => {
  it("registers and lists enabled tools", () => {
    const reg = createInMemoryToolRegistry([sampleTool]);
    expect(reg.list()).toHaveLength(1);
    expect(reg.get("demo.echo")?.name).toBe("Echo");
  });

  it("rejects open input schemas", () => {
    const reg = createInMemoryToolRegistry();
    expect(() =>
      reg.register({
        ...sampleTool,
        id: "bad",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: true as unknown as false,
        },
      })
    ).toThrow(/closed inputSchema|Invalid tool/);
  });

  it("authorizes with per-tool permission", () => {
    const reg = createInMemoryToolRegistry([sampleTool]);
    const ok = reg.authorize(sampleTool, ctx(["tools:invoke:demo.echo"]));
    expect(ok.ok).toBe(true);
  });

  it("denies without permission", () => {
    const reg = createInMemoryToolRegistry([sampleTool]);
    const denied = reg.authorize(sampleTool, ctx(["tools:read"]));
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("PERMISSION_DENIED");
  });

  it("denies when call budget exhausted", () => {
    const reg = createInMemoryToolRegistry([sampleTool]);
    const denied = reg.authorize(
      sampleTool,
      ctx(["tools:invoke:demo.echo"], 0)
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("CALL_BUDGET_EXCEEDED");
  });

  it("allows tools:admin", () => {
    const reg = createInMemoryToolRegistry([sampleTool]);
    const ok = reg.authorize(sampleTool, ctx(["tools:admin"]));
    expect(ok.ok).toBe(true);
  });
});
