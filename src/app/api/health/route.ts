import { NextResponse } from "next/server";
import { getAiGateway } from "@/lib/ai/gateway";
import { prisma } from "@/lib/db";
import { checkDatabaseForAuth } from "@/lib/db-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      productionReady: false,
      providers: {},
      configured: {},
    };
  }

  const authSecretConfigured = Boolean(
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim()
  );
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL?.trim());

  const healthy = dbOk && authDb.ok && authSecretConfigured;

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
          productionReady: aiHealth.productionReady,
          providers: aiHealth.providers,
          configured: aiHealth.configured,
        },
      },
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
