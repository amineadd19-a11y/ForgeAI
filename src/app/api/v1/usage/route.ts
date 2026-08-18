import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-keys";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const apiAuth = await authenticateApiKey(req.headers.get("authorization"));
  if (apiAuth) return apiAuth.userId;
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);

  const [events, summary] = await Promise.all([
    prisma.usageEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        endpoint: true,
        method: true,
        statusCode: true,
        creditsUsed: true,
        inputTokens: true,
        outputTokens: true,
        latencyMs: true,
        requestId: true,
        errorCode: true,
        createdAt: true,
      },
    }),
    prisma.usageEvent.aggregate({
      where: {
        userId,
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      },
      _sum: { creditsUsed: true },
      _count: true,
    }),
  ]);

  return NextResponse.json({
    events,
    summary: {
      monthRequestCount: summary._count,
      monthCreditsUsed: summary._sum.creditsUsed ?? 0,
    },
  });
}
