import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAiGateway } from "@/lib/ai/gateway";
import { prisma } from "@/lib/db";
import { getBalance } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only Movie Studio diagnostics.
 * Returns only boolean / safe metadata — never secrets.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  });
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  let databaseReachable = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseReachable = true;
  } catch {
    databaseReachable = false;
  }

  let creditsSystemReachable = false;
  try {
    await getBalance(user.id);
    creditsSystemReachable = true;
  } catch {
    creditsSystemReachable = false;
  }

  const providerName = (process.env.AI_PROVIDER || "openai").toLowerCase();
  const hasKey = Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
  const modelConfigured = Boolean(process.env.AI_MODEL);
  const mediaProviderConfigured = Boolean(process.env.FAL_KEY);

  let providerAvailable = false;
  try {
    const health = await getAiGateway().health();
    providerAvailable = health.available;
  } catch {
    providerAvailable = false;
  }

  const providerConfigured =
    providerName === "mock"
      ? process.env.NODE_ENV !== "production"
      : hasKey && providerName.length > 0;

  return NextResponse.json({
    feature: "movie-studio",
    timestamp: new Date().toISOString(),
    provider: {
      name: providerName,
      configured: providerConfigured,
      available: providerAvailable,
      modelConfigured,
      model: process.env.AI_MODEL || "gpt-4o-mini",
    },
    media: {
      configured: mediaProviderConfigured,
    },
    database: { reachable: databaseReachable },
    credits: { reachable: creditsSystemReachable },
    env: {
      AI_PROVIDER_set: Boolean(process.env.AI_PROVIDER),
      AI_MODEL_set: Boolean(process.env.AI_MODEL),
      AI_API_KEY_set: Boolean(process.env.AI_API_KEY),
      OPENAI_API_KEY_set: Boolean(process.env.OPENAI_API_KEY),
      FAL_KEY_set: Boolean(process.env.FAL_KEY),
      DATABASE_URL_set: Boolean(process.env.DATABASE_URL),
    },
  });
}
