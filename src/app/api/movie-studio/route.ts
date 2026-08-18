import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAiGateway } from "@/lib/ai/gateway";
import { AiProviderError } from "@/lib/ai/types";
import { calculateCost, deductCredits, getBalance } from "@/lib/credits";
import { prisma } from "@/lib/db";
import { generateRequestId } from "@/lib/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_FILM_KEYS = [
  "title",
  "logline",
  "characters",
  "scenes",
  "imagePrompts",
  "videoPrompts",
  "soundDesign",
  "editingPlan",
  "productionChecklist",
] as const;

function extractErrorInfo(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const e = error as AiProviderError;
    return {
      code: String(e.code || "UNKNOWN"),
      message: String(e.message || "AI request failed"),
      retryable: Boolean(e.retryable),
    };
  }
  if (error instanceof Error) {
    return { code: "UNKNOWN", message: error.message, retryable: false };
  }
  return { code: "UNKNOWN", message: String(error), retryable: false };
}

function publicAiError(error: unknown): {
  code: string;
  message: string;
  status: number;
} {
  const info = extractErrorInfo(error);
  const lower = `${info.code} ${info.message}`.toLowerCase();

  if (
    info.code === "AUTH_ERROR" ||
    lower.includes("api key") ||
    lower.includes("not configured") ||
    lower.includes("unauthorized") ||
    lower.includes("authentication")
  ) {
    return {
      code: "AI_NOT_CONFIGURED",
      message:
        "Movie Studio AI is not configured on the server. Set AI_API_KEY (or OPENAI_API_KEY) and AI_PROVIDER in Production environment variables.",
      status: 503,
    };
  }
  if (info.code === "RATE_LIMITED" || lower.includes("rate limit") || lower.includes("429")) {
    return {
      code: "AI_RATE_LIMITED",
      message: "The AI provider is temporarily rate-limited. Please try again in a moment.",
      status: 429,
    };
  }
  if (info.code === "TIMEOUT" || lower.includes("timeout") || lower.includes("timed out")) {
    return {
      code: "AI_TIMEOUT",
      message: "Movie Studio AI timed out. Please try again with a shorter screenplay.",
      status: 504,
    };
  }
  if (info.code === "INVALID_REQUEST" || lower.includes("invalid")) {
    return {
      code: "AI_INVALID_REQUEST",
      message: "The AI provider rejected the request. Try a shorter screenplay or different style.",
      status: 400,
    };
  }
  return {
    code: "AI_GENERATION_FAILED",
    message:
      "Movie Studio could not generate this production package. No credits were charged. Please try again.",
    status: 502,
  };
}

function isAiConfigured(): { ok: boolean; missing: string[] } {
  const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
  const missing: string[] = [];
  if (provider === "mock") {
    if (process.env.NODE_ENV === "production") {
      missing.push("AI_PROVIDER (must not be mock in production)");
    }
    return { ok: process.env.NODE_ENV !== "production", missing };
  }
  const key = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) {
    missing.push("AI_API_KEY (or OPENAI_API_KEY)");
  }
  return { ok: missing.length === 0, missing };
}

/** Strip markdown code fences and parse JSON from model output. */
function parseFilmPackage(raw: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== "string") return null;
  let text = raw.trim();

  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

function normalizeFilm(parsed: Record<string, unknown>): Record<string, unknown> {
  const film: Record<string, unknown> = { ...parsed };
  for (const key of REQUIRED_FILM_KEYS) {
    if (!(key in film)) {
      if (
        key === "characters" ||
        key === "scenes" ||
        key === "imagePrompts" ||
        key === "videoPrompts" ||
        key === "productionChecklist" ||
        key === "soundDesign" ||
        key === "editingPlan"
      ) {
        film[key] = [];
      } else {
        film[key] = key === "title" ? "Untitled Film" : "";
      }
    }
  }
  return film;
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  const start = Date.now();

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED", requestId },
      { status: 401 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  });
  if (!user) {
    return NextResponse.json(
      { error: "User not found", code: "UNAUTHORIZED", requestId },
      { status: 401 }
    );
  }

  const config = isAiConfigured();
  if (!config.ok) {
    console.error("Movie Studio AI_NOT_CONFIGURED", {
      requestId,
      missing: config.missing,
      provider: process.env.AI_PROVIDER || "openai",
      hasAiApiKey: Boolean(process.env.AI_API_KEY),
      hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
      hasModel: Boolean(process.env.AI_MODEL),
    });
    return NextResponse.json(
      {
        error:
          "Movie Studio AI is not configured on the server. Missing: " +
          config.missing.join(", ") +
          ". No credits were charged.",
        code: "AI_NOT_CONFIGURED",
        requestId,
        creditsCharged: 0,
        diagnostic: {
          requestId,
          stage: "config_check",
          providerConfigured: false,
          modelConfigured: Boolean(process.env.AI_MODEL),
          missing: config.missing,
        },
      },
      { status: 503 }
    );
  }

  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request", code: "INVALID_JSON", requestId, creditsCharged: 0 },
      { status: 400 }
    );
  }

  const body =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const script = typeof body.script === "string" ? body.script.trim() : "";
  const format =
    typeof body.format === "string" && body.format.trim()
      ? body.format.trim()
      : "Short Film";
  const style =
    typeof body.style === "string" && body.style.trim()
      ? body.style.trim()
      : "Cinematic";

  if (script.length < 20) {
    return NextResponse.json(
      {
        error: "Please enter at least 20 characters of screenplay text.",
        code: "INVALID_SCREENPLAY",
        requestId,
        creditsCharged: 0,
      },
      { status: 400 }
    );
  }
  if (script.length > 100_000) {
    return NextResponse.json(
      {
        error: "Screenplay is too long. Maximum is 100,000 characters.",
        code: "SCREENPLAY_TOO_LONG",
        requestId,
        creditsCharged: 0,
      },
      { status: 400 }
    );
  }

  const cost = calculateCost("generate", "advanced");
  const balance = await getBalance(user.id);
  if (balance < cost) {
    return NextResponse.json(
      {
        error: `This film transformation costs ${cost} credits. You have ${balance}.`,
        code: "INSUFFICIENT_CREDITS",
        requestId,
        creditsCharged: 0,
      },
      { status: 402 }
    );
  }

  const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
  const model = process.env.AI_MODEL || "gpt-4o-mini";

  const prompt = `You are ForgeAI Movie Studio: an expert screenwriter, director, cinematographer, storyboard artist, sound designer and AI-video prompt engineer. Transform the supplied screenplay into a coherent film production package. Preserve the source story, characters, chronology and dialogue intent. Never invent important facts that contradict the source.

Respond with ONLY a single JSON object (no markdown fences, no commentary) with these keys exactly:
title, logline, characters, scenes, imagePrompts, videoPrompts, soundDesign, editingPlan, productionChecklist.

- characters: array of { name, description, appearance }
- scenes: array of { sceneNumber, slugline, durationSeconds, action, dialogue, emotion, visualContinuity, shots }
- shots: array of { shotType, framing, cameraMovement, lens, lighting, prompt }
- imagePrompts: string array, one detailed image prompt per scene
- videoPrompts: string array, one motion/camera prompt per scene
- soundDesign: array of strings
- editingPlan: array of strings
- productionChecklist: array of strings

Keep character appearance descriptions consistent across every scene. Video prompts should describe motion, camera movement and environment. Do not claim to have rendered a video.

FORMAT: ${format}
VISUAL STYLE: ${style}

SCREENPLAY:
${script}`;

  await prisma.aiRequest.create({
    data: {
      userId: user.id,
      requestId,
      provider,
      model,
      status: "PENDING",
      creditsCharged: 0,
      metadata: {
        feature: "movie-studio",
        format,
        style,
        scriptLength: script.length,
      },
    },
  });

  console.info("Movie Studio generation start", {
    requestId,
    userId: user.id,
    provider,
    model,
    balance,
    cost,
    scriptLength: script.length,
    format,
    style,
    hasAiApiKey: Boolean(process.env.AI_API_KEY),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
  });

  try {
    const result = await getAiGateway().generate({
      prompt,
      model,
      maxTokens: 8000,
      temperature: 0.7,
      operation: "generate",
      complexity: "advanced",
    });

    const parsed = parseFilmPackage(result.content);
    if (!parsed) {
      await prisma.aiRequest.update({
        where: { requestId },
        data: {
          status: "FAILED",
          errorMessage: "Model returned non-JSON film package",
          completedAt: new Date(),
          latencyMs: Date.now() - start,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          metadata: {
            feature: "movie-studio",
            stage: "json_parse",
            provider: result.provider,
            finishReason: result.finishReason,
            contentPreview: result.content.slice(0, 200),
          },
        },
      });
      console.error("Movie Studio invalid JSON response", {
        requestId,
        provider: result.provider,
        finishReason: result.finishReason,
        contentPreview: result.content.slice(0, 200),
      });
      return NextResponse.json(
        {
          error:
            "The AI returned an invalid film package (not valid JSON). No credits were charged. Please try again.",
          code: "INVALID_AI_RESPONSE",
          requestId,
          creditsCharged: 0,
        },
        { status: 502 }
      );
    }

    const film = normalizeFilm(parsed);

    const charge = await deductCredits(user.id, cost, "AI Movie Studio", requestId);

    await prisma.aiRequest.update({
      where: { requestId },
      data: {
        status: "SUCCESS",
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        creditsCharged: charge.success ? cost : 0,
        completedAt: new Date(),
        latencyMs: Date.now() - start,
        metadata: {
          feature: "movie-studio",
          provider: result.provider,
          finishReason: result.finishReason,
          format,
          style,
        },
      },
    });

    console.info("Movie Studio generation success", {
      requestId,
      provider: result.provider,
      model: result.model,
      creditsCharged: charge.success ? cost : 0,
      latencyMs: Date.now() - start,
    });

    return NextResponse.json({
      requestId,
      film,
      usage: {
        credits: charge.success ? cost : 0,
        remaining: charge.balanceAfter,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    const safe = publicAiError(error);
    const info = extractErrorInfo(error);

    await prisma.aiRequest.update({
      where: { requestId },
      data: {
        status: info.code === "TIMEOUT" ? "TIMEOUT" : "FAILED",
        errorMessage: info.message.slice(0, 500),
        completedAt: new Date(),
        latencyMs: Date.now() - start,
        metadata: {
          feature: "movie-studio",
          stage: "generation",
          errorCode: info.code,
          provider,
          model,
        },
      },
    });

    console.error("Movie Studio generation failed", {
      requestId,
      code: safe.code,
      providerErrorCode: info.code,
      provider,
      model,
      hasAiApiKey: Boolean(process.env.AI_API_KEY),
      hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
      messagePreview: info.message.slice(0, 200),
    });

    return NextResponse.json(
      {
        error: safe.message,
        code: safe.code,
        requestId,
        creditsCharged: 0,
      },
      { status: safe.status }
    );
  }
}
