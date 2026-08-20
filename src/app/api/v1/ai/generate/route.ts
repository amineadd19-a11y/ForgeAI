import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiKey } from "@/lib/api-keys";
import { getAiGateway } from "@/lib/ai/gateway";
import { calculateCost, deductCredits, getBalance } from "@/lib/credits";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { generateRequestId } from "@/lib/request-id";
import { prisma } from "@/lib/db";
import { PLANS, PlanTier, isModelAllowed } from "@/lib/config";
import { AiProviderError, AiStreamEvent } from "@/lib/ai/types";
import { renderPromptTemplate } from "@/lib/prompts/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  prompt: z.string().min(1).max(100_000).optional(),
  templateId: z.string().max(100).optional(),
  variables: z.record(z.string().max(20_000)).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(100_000),
      })
    )
    .min(1)
    .max(50)
    .optional(),
  model: z.string().max(100).optional(),
  maxTokens: z.number().int().min(1).max(16384).optional(),
  temperature: z.number().min(0).max(2).optional(),
  complexity: z.enum(["basic", "standard", "advanced"]).optional().default("standard"),
  stream: z.boolean().optional().default(false),
});

type ParsedBody = z.infer<typeof bodySchema>;

function sseEncode(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

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
  const [user, subscription, balance] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } }),
    prisma.subscription.findUnique({ where: { userId }, include: { plan: true } }),
    getBalance(userId),
  ]);
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "User not found", requestId } },
      { status: 401 }
    );
  }

  const planTier: PlanTier = (subscription?.plan?.tier as PlanTier) || "FREE";
  const plan = PLANS[planTier];
  const rate = await checkRateLimit({
    userId,
    apiKeyId,
    planTier,
    ip: req.headers.get("x-forwarded-for") || undefined,
  });
  if (!rate.allowed) {
    await prisma.usageEvent.create({
      data: {
        userId,
        apiKeyId,
        endpoint: "/api/v1/ai/generate",
        method: "POST",
        statusCode: 429,
        creditsUsed: 0,
        requestId,
        ip: req.headers.get("x-forwarded-for") || undefined,
      },
    });
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Rate limit exceeded", requestId } },
      { status: 429, headers: rateLimitHeaders(rate) }
    );
  }

  let body: ParsedBody;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: e instanceof z.ZodError ? e.errors : "Invalid request body",
          requestId,
        },
      },
      { status: 400, headers: rateLimitHeaders(rate) }
    );
  }

  if (!body.prompt && !body.messages && !body.templateId) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Provide prompt, messages, or templateId",
          requestId,
        },
      },
      { status: 400, headers: rateLimitHeaders(rate) }
    );
  }

  let renderedTemplate = "";
  if (body.templateId) {
    try {
      renderedTemplate = renderPromptTemplate(body.templateId, body.variables || {});
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_TEMPLATE",
            message: `Unknown prompt template: ${body.templateId}`,
            requestId,
          },
        },
        { status: 400, headers: rateLimitHeaders(rate) }
      );
    }
  }

  const requestPrompt = renderedTemplate
    ? `${renderedTemplate}${body.prompt ? `\n\nAdditional user input:\n${body.prompt}` : ""}`
    : body.prompt;

  const totalInputChars =
    (requestPrompt || "").length +
    (body.messages?.reduce((sum, message) => sum + message.content.length, 0) || 0);
  if (totalInputChars > 100_000) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Combined input exceeds 100,000 characters",
          requestId,
        },
      },
      { status: 400, headers: rateLimitHeaders(rate) }
    );
  }

  const model = body.model || process.env.AI_MODEL || "gpt-4o-mini";
  if (!isModelAllowed(planTier, model)) {
    return NextResponse.json(
      {
        error: {
          code: "MODEL_NOT_ALLOWED",
          message: `Model "${model}" is not available on your ${plan.name} plan`,
          requestId,
        },
      },
      { status: 403, headers: rateLimitHeaders(rate) }
    );
  }

  const cost = calculateCost("generate", body.complexity);
  if (balance < cost) {
    return NextResponse.json(
      {
        error: {
          code: "INSUFFICIENT_CREDITS",
          message: `This request costs ${cost} credits. You have ${balance}.`,
          requestId,
        },
      },
      { status: 402, headers: rateLimitHeaders(rate) }
    );
  }

  const providerName = process.env.AI_PROVIDER || "openai";
  await prisma.aiRequest.create({
    data: {
      userId,
      apiKeyId,
      requestId,
      provider: providerName,
      model,
      status: "PENDING",
      creditsCharged: 0,
    },
  });

  const generateArgs = {
    prompt: requestPrompt,
    messages: body.messages,
    model,
    maxTokens: Math.min(body.maxTokens ?? plan.maxOutputTokens, plan.maxOutputTokens),
    temperature: body.temperature,
    operation: "generate" as const,
    complexity: body.complexity,
  };

  // ---------- Streaming path ----------
  if (body.stream) {
    const encoder = new TextEncoder();
    let clientAborted = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) => {
          if (clientAborted) return;
          try {
            controller.enqueue(encoder.encode(sseEncode(obj)));
          } catch {
            clientAborted = true;
          }
        };

        // Meta event so clients can correlate requestId immediately
        send({ type: "meta", requestId, model });

        let completed = false;
        try {
          for await (const event of getAiGateway().streamGenerate(generateArgs)) {
            if (clientAborted) break;

            if (event.type === "delta") {
              send({ type: "delta", content: event.content, requestId });
              continue;
            }

            if (event.type === "error") {
              await prisma.aiRequest.update({
                where: { requestId },
                data: {
                  status: event.code === "TIMEOUT" ? "TIMEOUT" : "FAILED",
                  errorMessage: event.message?.slice(0, 500),
                  completedAt: new Date(),
                  latencyMs: Date.now() - start,
                },
              });
              await prisma.usageEvent.create({
                data: {
                  userId,
                  apiKeyId,
                  endpoint: "/api/v1/ai/generate",
                  method: "POST",
                  statusCode: 502,
                  creditsUsed: 0,
                  requestId,
                  errorCode: event.code,
                  latencyMs: Date.now() - start,
                },
              });
              send({
                type: "error",
                code: event.code,
                message: event.message,
                retryable: event.retryable,
                requestId,
              });
              completed = true;
              break;
            }

            if (event.type === "done") {
              // Charge only after successful provider completion
              const charge = await deductCredits(
                userId,
                cost,
                `AI generate stream (${event.model})`,
                requestId
              );
              const latencyMs = Date.now() - start;
              await Promise.all([
                prisma.aiRequest.update({
                  where: { requestId },
                  data: {
                    status: "SUCCESS",
                    provider: event.provider,
                    model: event.model,
                    inputTokens: event.usage.inputTokens,
                    outputTokens: event.usage.outputTokens,
                    creditsCharged: charge.success ? cost : 0,
                    latencyMs,
                    completedAt: new Date(),
                    metadata: {
                      finishReason: event.finishReason,
                      provider: event.provider,
                      stream: true,
                      templateId: body.templateId || null,
                    },
                  },
                }),
                prisma.usageEvent.create({
                  data: {
                    userId,
                    apiKeyId,
                    endpoint: "/api/v1/ai/generate",
                    method: "POST",
                    statusCode: 200,
                    creditsUsed: charge.success ? cost : 0,
                    inputTokens: event.usage.inputTokens,
                    outputTokens: event.usage.outputTokens,
                    latencyMs,
                    requestId,
                  },
                }),
              ]);

              send({
                type: "done",
                id: event.id,
                requestId,
                model: event.model,
                provider: event.provider,
                content: event.content,
                usage: {
                  inputTokens: event.usage.inputTokens,
                  outputTokens: event.usage.outputTokens,
                  totalTokens: event.usage.totalTokens,
                  credits: charge.success ? cost : 0,
                },
                finishReason: event.finishReason,
                latencyMs,
                creditsRemaining: charge.balanceAfter,
              });
              completed = true;
              break;
            }
          }

          if (!completed && !clientAborted) {
            // Stream ended without done/error (e.g. empty stream)
            await prisma.aiRequest.update({
              where: { requestId },
              data: {
                status: "FAILED",
                errorMessage: "Empty stream from provider",
                completedAt: new Date(),
                latencyMs: Date.now() - start,
              },
            });
            await prisma.usageEvent.create({
              data: {
                userId,
                apiKeyId,
                endpoint: "/api/v1/ai/generate",
                method: "POST",
                statusCode: 502,
                creditsUsed: 0,
                requestId,
                errorCode: "PROVIDER_UNAVAILABLE",
                latencyMs: Date.now() - start,
              },
            });
            send({
              type: "error",
              code: "PROVIDER_UNAVAILABLE",
              message: "Empty stream from provider",
              retryable: true,
              requestId,
            });
          }
        } catch (e) {
          const err = e as AiProviderError;
          await prisma.aiRequest.update({
            where: { requestId },
            data: {
              status: err.code === "TIMEOUT" ? "TIMEOUT" : "FAILED",
              errorMessage: (err.message || "Stream failed").slice(0, 500),
              completedAt: new Date(),
              latencyMs: Date.now() - start,
            },
          });
          await prisma.usageEvent.create({
            data: {
              userId,
              apiKeyId,
              endpoint: "/api/v1/ai/generate",
              method: "POST",
              statusCode: 502,
              creditsUsed: 0,
              requestId,
              errorCode: err.code || "UNKNOWN",
              latencyMs: Date.now() - start,
            },
          });
          send({
            type: "error",
            code: err.code || "UNKNOWN",
            message: err.message || "Stream failed",
            retryable: err.retryable ?? false,
            requestId,
          });
        } finally {
          try {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
      cancel() {
        clientAborted = true;
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Request-Id": requestId,
        ...rateLimitHeaders(rate),
      },
    });
  }

  // ---------- Non-streaming path (unchanged contract) ----------
  let aiResult;
  try {
    aiResult = await getAiGateway().generate(generateArgs);
  } catch (e) {
    const err = e as AiProviderError;
    await prisma.aiRequest.update({
      where: { requestId },
      data: {
        status: err.code === "TIMEOUT" ? "TIMEOUT" : "FAILED",
        errorMessage: err.message?.slice(0, 500),
        completedAt: new Date(),
        latencyMs: Date.now() - start,
      },
    });
    await prisma.usageEvent.create({
      data: {
        userId,
        apiKeyId,
        endpoint: "/api/v1/ai/generate",
        method: "POST",
        statusCode: 502,
        creditsUsed: 0,
        requestId,
        errorCode: err.code,
        latencyMs: Date.now() - start,
      },
    });
    return NextResponse.json(
      {
        error: {
          code: err.code || "PROVIDER_ERROR",
          message: err.message || "AI provider error",
          requestId,
          retryable: err.retryable ?? false,
        },
      },
      {
        status: err.code === "RATE_LIMITED" ? 429 : 502,
        headers: rateLimitHeaders(rate),
      }
    );
  }

  const charge = await deductCredits(userId, cost, `AI generate (${model})`, requestId);
  const latencyMs = Date.now() - start;
  await Promise.all([
    prisma.aiRequest.update({
      where: { requestId },
      data: {
        status: "SUCCESS",
        inputTokens: aiResult.usage.inputTokens,
        outputTokens: aiResult.usage.outputTokens,
        creditsCharged: charge.success ? cost : 0,
        latencyMs,
        completedAt: new Date(),
        metadata: {
          finishReason: aiResult.finishReason,
          provider: aiResult.provider,
          templateId: body.templateId || null,
        },
      },
    }),
    prisma.usageEvent.create({
      data: {
        userId,
        apiKeyId,
        endpoint: "/api/v1/ai/generate",
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
      finishReason: aiResult.finishReason,
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
