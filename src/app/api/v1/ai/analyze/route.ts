import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiKey } from "@/lib/api-keys";
import { getAiGateway } from "@/lib/ai/gateway";
import { calculateCost, deductCredits, getBalance } from "@/lib/credits";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { generateRequestId } from "@/lib/request-id";
import { prisma } from "@/lib/db";
import { PLANS, PlanTier, isModelAllowed } from "@/lib/config";
import { AiProviderError } from "@/lib/ai/types";
import {
  buildAiRequestMetadata,
  logAiRequestTrace,
} from "@/lib/ai/request-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  prompt: z.string().min(1).max(100000).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(100000),
      })
    )
    .min(1)
    .max(50)
    .optional(),
  model: z.string().max(100).optional(),
  maxTokens: z.number().int().min(1).max(16384).optional(),
  complexity: z.enum(["basic", "standard", "advanced"]).optional().default("standard"),
});

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  const start = Date.now();

  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid or missing API key", requestId } },
      { status: 401 }
    );
  }

  const { userId, apiKeyId } = auth;
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    include: { plan: true },
  });
  const planTier: PlanTier = (subscription?.plan?.tier as PlanTier) || "FREE";
  const plan = PLANS[planTier];
  const balance = await getBalance(userId);

  const rate = await checkRateLimit({ userId, apiKeyId, planTier });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Rate limit exceeded", requestId } },
      { status: 429, headers: rateLimitHeaders(rate) }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: e instanceof z.ZodError ? e.errors : "Invalid body",
          requestId,
        },
      },
      { status: 400, headers: rateLimitHeaders(rate) }
    );
  }

  if (!body.prompt && !body.messages) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "prompt or messages required", requestId } },
      { status: 400, headers: rateLimitHeaders(rate) }
    );
  }

  const cost = calculateCost("analyze", body.complexity);
  if (balance < cost) {
    return NextResponse.json(
      {
        error: {
          code: "INSUFFICIENT_CREDITS",
          message: `Requires ${cost} credits; you have ${balance}`,
          requestId,
        },
      },
      { status: 402, headers: rateLimitHeaders(rate) }
    );
  }

  const model = body.model || process.env.AI_MODEL || "gpt-4o-mini";
  const allowed = isModelAllowed(planTier, model);
  if (!allowed) {
    return NextResponse.json(
      {
        error: {
          code: "MODEL_NOT_ALLOWED",
          message: `Model not allowed on ${plan.name}`,
          requestId,
        },
      },
      { status: 403, headers: rateLimitHeaders(rate) }
    );
  }

  await prisma.aiRequest.create({
    data: {
      userId,
      apiKeyId,
      requestId,
      provider: process.env.AI_PROVIDER || "openai",
      model,
      status: "PENDING",
      creditsCharged: 0,
    },
  });

  const gateway = getAiGateway();
  let aiResult;
  try {
    const messages =
      body.messages ||
      [
        { role: "system" as const, content: "You are an analysis assistant. Provide structured analysis." },
        { role: "user" as const, content: body.prompt || "" },
      ];
    aiResult = await gateway.generate({
      messages,
      model,
      maxTokens: Math.min(body.maxTokens ?? plan.maxOutputTokens, plan.maxOutputTokens),
      operation: "analyze",
      complexity: body.complexity,
    });
  } catch (e) {
    const err = e as AiProviderError;
    const failLatency = Date.now() - start;
    const failMeta = buildAiRequestMetadata({
      requestId,
      provider: process.env.AI_PROVIDER || "openai",
      model,
      latencyMs: failLatency,
      success: false,
      outcome: err.code === "TIMEOUT" ? "TIMEOUT" : "FAILED",
      errorCode: err.code,
      stream: false,
      endpoint: "/api/v1/ai/analyze",
      creditsCharged: 0,
    });
    await prisma.aiRequest.update({
      where: { requestId },
      data: {
        status: err.code === "TIMEOUT" ? "TIMEOUT" : "FAILED",
        errorMessage: err.message?.slice(0, 500),
        completedAt: new Date(),
        latencyMs: failLatency,
        metadata: failMeta,
      },
    });
    logAiRequestTrace(failMeta);
    return NextResponse.json(
      {
        error: {
          code: err.code || "PROVIDER_ERROR",
          message: err.message || "AI error",
          requestId,
          retryable: err.retryable ?? false,
        },
      },
      { status: 502, headers: rateLimitHeaders(rate) }
    );
  }

  const charge = await deductCredits(userId, cost, `AI analyze (${model})`, requestId);
  const latencyMs = Date.now() - start;

  await Promise.all([
    prisma.aiRequest.update({
      where: { requestId },
      data: {
        status: "SUCCESS",
        provider: aiResult.provider,
        model: aiResult.model,
        inputTokens: aiResult.usage.inputTokens,
        outputTokens: aiResult.usage.outputTokens,
        creditsCharged: charge.success ? cost : 0,
        latencyMs,
        completedAt: new Date(),
        metadata: buildAiRequestMetadata({
          requestId,
          provider: aiResult.provider,
          model: aiResult.model,
          latencyMs,
          success: true,
          outcome: "SUCCESS",
          inputTokens: aiResult.usage.inputTokens,
          outputTokens: aiResult.usage.outputTokens,
          finishReason: aiResult.finishReason,
          stream: false,
          endpoint: "/api/v1/ai/analyze",
          creditsCharged: charge.success ? cost : 0,
        }),
      },
    }),
    prisma.usageEvent.create({
      data: {
        userId,
        apiKeyId,
        endpoint: "/api/v1/ai/analyze",
        method: "POST",
        statusCode: 200,
        creditsUsed: charge.success ? cost : 0,
        inputTokens: aiResult.usage.inputTokens,
        outputTokens: aiResult.usage.outputTokens,
        latencyMs,
        requestId,
      },
    }),
  ]);

  logAiRequestTrace(
    buildAiRequestMetadata({
      requestId,
      provider: aiResult.provider,
      model: aiResult.model,
      latencyMs,
      success: true,
      outcome: "SUCCESS",
      inputTokens: aiResult.usage.inputTokens,
      outputTokens: aiResult.usage.outputTokens,
      finishReason: aiResult.finishReason,
      stream: false,
      endpoint: "/api/v1/ai/analyze",
      creditsCharged: charge.success ? cost : 0,
    })
  );

  return NextResponse.json(
    {
      id: aiResult.id,
      requestId,
      content: aiResult.content,
      model: aiResult.model,
      provider: aiResult.provider,
      usage: {
        inputTokens: aiResult.usage.inputTokens,
        outputTokens: aiResult.usage.outputTokens,
        totalTokens: aiResult.usage.totalTokens,
        credits: charge.success ? cost : 0,
      },
      latencyMs,
    },
    {
      status: 200,
      headers: {
        ...rateLimitHeaders(rate),
        "X-Request-Id": requestId,
        "X-Credits-Remaining": String(charge.balanceAfter),
      },
    }
  );
}
