import { NextResponse } from "next/server";
import { getAiGateway } from "@/lib/ai/gateway";
import { prisma } from "@/lib/db";
import { checkDatabaseForAuth } from "@/lib/db-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TEMP diagnostic only — never includes secret values. Remove after investigation. */
function envPresenceMeta(key: string): {
  exists: boolean;
  length: number;
  trimmedLength: number;
} {
  // Read once; never assign the value to any object that is returned or logged.
  const present = Object.prototype.hasOwnProperty.call(process.env, key);
  if (!present) {
    return { exists: false, length: 0, trimmedLength: 0 };
  }
  const value = process.env[key];
  if (value === undefined) {
    return { exists: false, length: 0, trimmedLength: 0 };
  }
  // lengths only — value is not returned, logged, or stringified elsewhere
  const length = value.length;
  const trimmedLength = value.trim().length;
  return { exists: true, length, trimmedLength };
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

  // TEMP: metadata-only diagnostic (no secret values, no console.log of env)
  const runtimeDiag = {
    runtime: "nodejs" as const,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelTargetEnv: process.env.VERCEL_TARGET_ENV ?? null,
    AUTH_SECRET: envPresenceMeta("AUTH_SECRET"),
    NEXTAUTH_SECRET: envPresenceMeta("NEXTAUTH_SECRET"),
    DATABASE_URL: envPresenceMeta("DATABASE_URL"),
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
      // TEMP — remove after runtime investigation
      _tempRuntimeEnvDiag: runtimeDiag,
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
