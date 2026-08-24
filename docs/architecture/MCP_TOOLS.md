# ForgeAI MCP / Tool Registry (Design)

Status: **types + in-memory registry implemented** (`src/lib/tools/registry.ts`).
**No arbitrary tool execution** until agents ship.

## Principles

1. Tools are **explicitly registered** with closed JSON schemas (`additionalProperties: false`).
2. Invocation requires **permissions** (`tools:invoke`, per-tool, or `tools:admin`).
3. Every call has **timeout**, **concurrency**, and **per-minute** limits.
4. Side-effect class is declared: `none | read | write | external`.
5. MCP servers are **adapters** that map remote tools into local `ToolDefinition`s — not a free proxy to the network.
6. Audit records store fingerprints, not secrets or full payloads.

## Lifecycle (future)

```
Register → Authorize(ctx) → Budget check → Execute (sandbox) → Audit → Return structured result|error
```

Agents may only call `registry.authorize` + a future `invoke` that enforces budgets.

## MCP mapping

| MCP concept | ForgeAI |
|-------------|---------|
| Server | `McpServerConfig` (id, transport, auth **env key name** only) |
| Tool list | Filtered by `allowedToolIds` |
| Call tool | Future invoke path with timeout + ACL |

High-risk MCP tools (shell, unrestricted FS) default **disabled**.

## Agents

Agents are **out of scope** until:

1. Request tracing is stable (done).
2. RAG gate decided.
3. Tool registry authorize path is tested (this phase).
4. Execution sandbox policy is written.
