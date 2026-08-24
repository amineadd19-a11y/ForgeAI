import { NextResponse } from "next/server";
import { getAiGateway } from "@/lib/ai/gateway";
import { prisma } from "@/lib/db";
import { checkDatabaseForAuth } from "@/lib/db-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TEMP diagnostic only — never includes secret/key values. Remove after investigation. */
function envPresenceMeta(key: string): {
  exists: boolean;
  length: number;
  trimmedLength: number;
} {
  const present = Object.prototype.hasOwnProperty.call(process.env, key);
  if (!present) {
    return { exists: false, length: 0, trimmedLength: 0 };
  }
  const value = process.env[key];
  if (value === undefined) {
    return { exists: false, length: 0, trimmedLength: 0 };
  }
  return {
    exists: true,
    length: value.length,
    trimmedLength: value.trim().length,
  };
}

export async function GET() {
  const start = Date.now();
  let dbOk = false;
  let dbLatency = 0;

  try {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatency = Date.now() - t0;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const authDb = await checkDatabaseForAuth();

  let aiHealth: Awaited<ReturnType<ReturnType<typeof getAiGateway>["health"]>>;
  try {
    aiHealth = await getAiGateway().health();
  } catch {
    aiHealth = {
      primary: process.env.AI_PROVIDER || "unknown",
      available: false,
      providers: {},
    };
  }

  const authSecretConfigured = Boolean(
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim()
  );
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL?.trim());

  const healthy = dbOk && authDb.ok && authSecretConfigured;

  // TEMP: metadata-only AI env diagnostic (no key values, no console.log of env)
  const openaiKey =
    process.env.AI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
  const _tempAiEnvDiag = {
    runtime: "nodejs" as const,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    AI_PROVIDER: (process.env.AI_PROVIDER || "").trim() || null,
    AI_MODEL: (process.env.AI_MODEL || "").trim() || null,
    AI_FALLBACK_PROVIDER: (process.env.AI_FALLBACK_PROVIDER || "").trim() || null,
    AI_API_KEY: envPresenceMeta("AI_API_KEY"),
    OPENAI_API_KEY: envPresenceMeta("OPENAI_API_KEY"),
    XAI_API_KEY: envPresenceMeta("XAI_API_KEY"),
    ANTHROPIC_API_KEY: envPresenceMeta("ANTHROPIC_API_KEY"),
    GEMINI_API_KEY: envPresenceMeta("GEMINI_API_KEY"),
    // Effective key OpenAIProvider uses (AI_API_KEY || OPENAI_API_KEY) — length only
    effectiveOpenAiKey: {
      trimmedLength: openaiKey.length,
      source:
        process.env.AI_API_KEY?.trim()
          ? "AI_API_KEY"
          : process.env.OPENAI_API_KEY?.trim()
            ? "OPENAI_API_KEY"
            : null,
    },
  };

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      version: process.env.npm_package_version || "1.0.0",
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
      checks: {
        database: {
          ok: dbOk,
          latencyMs: dbLatency,
          urlConfigured: databaseUrlConfigured,
          authSchemaReady: authDb.ok,
          ...(authDb.ok
            ? {}
            : {
                authSchemaStage: authDb.stage,
                authSchemaCode: authDb.code,
                prismaCode: authDb.prismaCode ?? null,
              }),
        },
        auth: {
          secretConfigured: authSecretConfigured,
        },
        ai: {
          primary: aiHealth.primary,
          available: aiHealth.available,
          providers: aiHealth.providers,
        },
      },
      // TEMP — remove after AI provider investigation
      _tempAiEnvDiag,
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
