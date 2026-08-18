import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-keys";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getBalance } from "@/lib/credits";
import { prisma } from "@/lib/db";
import { PLANS, PlanTier } from "@/lib/config";

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

  const [user, subscription, balance, keyCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
    prisma.subscription.findUnique({
      where: { userId },
      include: { plan: true },
    }),
    getBalance(userId),
    prisma.apiKey.count({ where: { userId, isActive: true } }),
  ]);

  if (!user) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "User not found" } },
      { status: 404 }
    );
  }

  const tier = (subscription?.plan?.tier as PlanTier) || "FREE";
  const planConfig = PLANS[tier];

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    },
    plan: {
      tier,
      name: planConfig.name,
      status: subscription?.status ?? "ACTIVE",
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    },
    credits: { balance },
    apiKeys: { active: keyCount },
    limits: {
      maxRequestsPerMinute: planConfig.maxRequestsPerMinute,
      maxRequestsPerDay: planConfig.maxRequestsPerDay,
      maxInputTokens: planConfig.maxInputTokens,
      maxOutputTokens: planConfig.maxOutputTokens,
    },
  });
}
