/**
 * Helpers to attach cost + trace metadata to AiRequest rows.
 * Keeps route handlers thin; never accepts secrets.
 */

import { prisma } from "@/lib/db";
import {
  buildAiRequestMetadata,
  logAiRequestTrace,
  type TraceOutcome,
} from "./request-trace";

export async function persistSuccessTrace(params: {
  requestId: string;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  finishReason?: string | null;
  stream: boolean;
  endpoint: string;
  creditsCharged: number;
  templateId?: string | null;
}): Promise<void> {
  const metadata = buildAiRequestMetadata({
    requestId: params.requestId,
    provider: params.provider,
    model: params.model,
    latencyMs: params.latencyMs,
    success: true,
    outcome: "SUCCESS",
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    finishReason: params.finishReason,
    stream: params.stream,
    endpoint: params.endpoint,
    creditsCharged: params.creditsCharged,
    templateId: params.templateId,
  });
  await prisma.aiRequest.update({
    where: { requestId: params.requestId },
    data: { metadata },
  });
  logAiRequestTrace(metadata);
}

export async function persistFailureTrace(params: {
  requestId: string;
  provider: string;
  model: string;
  latencyMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  stream: boolean;
  endpoint: string;
  templateId?: string | null;
  outcome?: TraceOutcome;
}): Promise<void> {
  const outcome: TraceOutcome =
    params.outcome ||
    (params.errorCode === "TIMEOUT" ? "TIMEOUT" : "FAILED");
  const metadata = buildAiRequestMetadata({
    requestId: params.requestId,
    provider: params.provider,
    model: params.model,
    latencyMs: params.latencyMs,
    success: false,
    outcome,
    errorCode: params.errorCode,
    stream: params.stream,
    endpoint: params.endpoint,
    creditsCharged: 0,
    templateId: params.templateId,
  });
  await prisma.aiRequest.update({
    where: { requestId: params.requestId },
    data: {
      status: outcome === "TIMEOUT" ? "TIMEOUT" : "FAILED",
      errorMessage: params.errorMessage?.slice(0, 500),
      completedAt: new Date(),
      latencyMs: params.latencyMs,
      metadata,
    },
  });
  logAiRequestTrace(metadata);
}
