import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildAiRequestMetadata,
  categorizeError,
  logAiRequestTrace,
  sanitizeTraceRecord,
} from "../src/lib/ai/request-trace";

describe("request-trace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("categorizes known error codes", () => {
    expect(categorizeError("TIMEOUT")).toBe("TIMEOUT");
    expect(categorizeError("AUTH_ERROR")).toBe("AUTH");
    expect(categorizeError("PROVIDER_UNAVAILABLE")).toBe("PROVIDER_UNAVAILABLE");
    expect(categorizeError(undefined)).toBe("UNKNOWN");
  });

  it("strips sensitive keys from records", () => {
    const cleaned = sanitizeTraceRecord({
      requestId: "req_1",
      apiKey: "sk-secret",
      Authorization: "Bearer x",
      nested: { password: "nope", ok: 1 },
    });
    expect(cleaned.requestId).toBe("req_1");
    expect(cleaned.apiKey).toBeUndefined();
    expect(cleaned.Authorization).toBeUndefined();
    expect((cleaned.nested as { ok: number }).ok).toBe(1);
    expect((cleaned.nested as { password?: string }).password).toBeUndefined();
  });

  it("builds success metadata with estimated cost", () => {
    const meta = buildAiRequestMetadata({
      requestId: "req_ok",
      provider: "openai",
      model: "gpt-4o-mini",
      latencyMs: 42,
      success: true,
      outcome: "SUCCESS",
      inputTokens: 1000,
      outputTokens: 500,
      stream: false,
      endpoint: "/api/v1/ai/generate",
      creditsCharged: 2,
    });
    expect(meta.success).toBe(true);
    expect(meta.requestId).toBe("req_ok");
    expect(meta.totalTokens).toBe(1500);
    expect(typeof meta.estimatedUsd).toBe("number");
    expect(meta.errorCategory).toBeNull();
    expect(JSON.stringify(meta)).not.toMatch(/sk-|password|secret/i);
  });

  it("builds failure metadata with error category", () => {
    const meta = buildAiRequestMetadata({
      requestId: "req_fail",
      provider: "openai",
      model: "gpt-4o-mini",
      latencyMs: 10,
      success: false,
      outcome: "FAILED",
      errorCode: "AUTH_ERROR",
      stream: false,
      endpoint: "/api/v1/ai/generate",
    });
    expect(meta.success).toBe(false);
    expect(meta.errorCategory).toBe("AUTH");
    expect(meta.estimatedUsd).toBeNull();
  });

  it("logs structured JSON without secrets", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logAiRequestTrace({
      requestId: "req_log",
      provider: "mock",
      api_key: "should-not-appear",
    });
    expect(spy).toHaveBeenCalled();
    const line = String(spy.mock.calls[0][0]);
    expect(line).toContain("ai_request_trace");
    expect(line).toContain("req_log");
    expect(line).not.toContain("should-not-appear");
  });
});
