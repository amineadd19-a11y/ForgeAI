/**
 * Secure tool / MCP registry abstraction (design + types).
 *
 * This module does NOT execute tools. It defines schemas, permission
 * boundaries, budgets, and audit shapes so agents can be layered later
 * without coupling the app to a single MCP transport.
 */

export type ToolPermission =
  | "tools:read"
  | "tools:invoke"
  | "tools:admin"
  | `tools:invoke:${string}`;

export type ToolParameterSchema = {
  type: "object";
  properties: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "array" | "object";
      description?: string;
      enum?: string[];
    }
  >;
  required?: string[];
  additionalProperties: false;
};

export type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  inputSchema: ToolParameterSchema;
  requiredPermissions: ToolPermission[];
  timeoutMs: number;
  maxConcurrency: number;
  maxInvocationsPerMinute: number;
  sideEffects: "none" | "read" | "write" | "external";
  mcpServerId?: string;
  enabled: boolean;
};

export type ToolInvocationContext = {
  userId: string;
  requestId: string;
  permissions: ReadonlySet<ToolPermission>;
  budgetMs: number;
  remainingCalls: number;
};

export type ToolInvocationAudit = {
  toolId: string;
  userId: string;
  requestId: string;
  startedAt: string;
  finishedAt?: string;
  success: boolean;
  errorCategory?: string;
  durationMs?: number;
  argumentFingerprint?: string;
};

export type ToolRegistry = {
  list(): ToolDefinition[];
  get(id: string): ToolDefinition | undefined;
  register(def: ToolDefinition): void;
  authorize(
    def: ToolDefinition,
    ctx: ToolInvocationContext
  ): { ok: true } | { ok: false; reason: string };
};

export function createInMemoryToolRegistry(
  initial: ToolDefinition[] = []
): ToolRegistry {
  const map = new Map<string, ToolDefinition>();
  for (const d of initial) {
    map.set(d.id, d);
  }

  return {
    list() {
      return [...map.values()].filter((t) => t.enabled);
    },
    get(id: string) {
      return map.get(id);
    },
    register(def: ToolDefinition) {
      if (!def.id || !def.inputSchema || def.inputSchema.additionalProperties !== false) {
        throw new Error("Invalid tool definition: id and closed inputSchema required");
      }
      if (def.timeoutMs < 100 || def.timeoutMs > 120_000) {
        throw new Error("timeoutMs must be between 100 and 120000");
      }
      map.set(def.id, def);
    },
    authorize(def, ctx) {
      if (!def.enabled) return { ok: false, reason: "TOOL_DISABLED" };
      if (ctx.remainingCalls <= 0) return { ok: false, reason: "CALL_BUDGET_EXCEEDED" };
      if (ctx.budgetMs <= 0) return { ok: false, reason: "TIME_BUDGET_EXCEEDED" };
      for (const perm of def.requiredPermissions) {
        const has =
          ctx.permissions.has(perm) ||
          ctx.permissions.has("tools:admin") ||
          (perm.startsWith("tools:invoke:") && ctx.permissions.has("tools:invoke"));
        if (!has) return { ok: false, reason: "PERMISSION_DENIED" };
      }
      return { ok: true };
    },
  };
}

export type McpServerConfig = {
  id: string;
  transport: "stdio" | "sse" | "streamable-http";
  authEnvKey?: string;
  allowedToolIds?: string[];
  defaultTimeoutMs: number;
};
