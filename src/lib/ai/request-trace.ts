/**
 * Structured AI request tracing + cost metadata.
 * Never includes API keys, AUTH secrets, prompts, or raw response bodies.
 */

import { estimateProviderCostUsd } from "./cost";

export type TraceOutcome = "SUCCESS" | "FAILED" | "TIMEOUT" | "RATE_LIMITED" | "ABORTED";

export type AiRequestTrace = {
  requestId: string;
  provider: string;
  model: string;
  latencyMs: number;
  success: boolean;
  outcome: TraceOutcome;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedUsd: number | null;
  errorCategory: string | null;
  stream: boolean;
  endpoint: string;
  creditsCharged: number;
};

/** Exact / bounded names only — do not match inputTokens / outputTokens / totalTokens. */
const SENSITIVE_KEY =
  /^(secret|password|token|api[_-]?key|authorization|bearer|cookie|access[_-]?token|refresh[_-]?token)$/i;

/** Strip any accidental sensitive keys from plain objects before persistence. */
export function sanitizeTraceRecord(
  record: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === undefined) continue;
    if (typeof value === "string" && value.length > 2000) {
      out[key] = value.slice(0, 2000);
      continue;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out[key] = sanitizeTraceRecord(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Prisma-compatible JSON value (no `unknown`). */
export type TraceJson = {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | TraceJson
    | Array<string | number | boolean | null | TraceJson>;
};

export function toTraceJson(record: Record<string, unknown>): TraceJson {
  return sanitizeTraceRecord(record) as TraceJson;
}

export function categorizeError(code?: string | null): string {
  if (!code) return "UNKNOWN";
  const c = code.toUpperCase();
  if (c === "TIMEOUT") return "TIMEOUT";
  if (c === "RATE_LIMITED") return "RATE_LIMITED";
  if (c === "AUTH_ERROR" || c === "UNAUTHORIZED") return "AUTH";
  if (c === "INVALID_REQUEST" || c === "VALIDATION_ERROR") return "VALIDATION";
  if (c === "PROVIDER_UNAVAILABLE") return "PROVIDER_UNAVAILABLE";
  if (c === "CLIENT_ABORTED") return "ABORTED";
  if (c.includes("INSUFFICIENT")) return "CREDITS";
  return c;
}

export function buildAiRequestMetadata(params: {
  requestId: string;
  provider: string;
  model: string;
  latencyMs: number;
  success: boolean;
  outcome: TraceOutcome;
  inputTokens?: number | null;
  outputTokens?: number | null;
  finishReason?: string | null;
  errorCode?: string | null;
  stream?: boolean;
  endpoint: string;
  creditsCharged?: number;
  templateId?: string | null;
  extra?: Record<string, unknown>;
}): TraceJson {
  const inputTokens = params.inputTokens ?? null;
  const outputTokens = params.outputTokens ?? null;
  const totalTokens =
    inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null;

  let estimatedUsd: number | null = null;
  if (inputTokens != null && outputTokens != null) {
    estimatedUsd = estimateProviderCostUsd(params.model, {
      inputTokens,
      outputTokens,
    }).estimatedUsd;
  }

  const errorCategory = params.success
    ? null
    : categorizeError(params.errorCode);

  const trace: AiRequestTrace = {
    requestId: params.requestId,
    provider: params.provider,
    model: params.model,
    latencyMs: params.latencyMs,
    success: params.success,
    outcome: params.outcome,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedUsd,
    errorCategory,
    stream: Boolean(params.stream),
    endpoint: params.endpoint,
    creditsCharged: params.creditsCharged ?? 0,
  };

  return toTraceJson({
    ...trace,
    finishReason: params.finishReason ?? null,
    templateId: params.templateId ?? null,
    costSource: "estimate",
    ...(params.extra || {}),
  });
}

/**
 * Emit a structured log line for operators (stdout).
 * Values only — never secrets. Safe for Vercel runtime logs.
 */
export function logAiRequestTrace(trace: Record<string, unknown>): void {
  const safe = sanitizeTraceRecord(trace);
  console.info(
    JSON.stringify({
      level: "info",
      type: "ai_request_trace",
      ...safe,
    })
  );
}
