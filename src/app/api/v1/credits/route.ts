import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-keys";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getBalance } from "@/lib/credits";
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

  const [balance, recent] = await Promise.all([
    getBalance(userId),
    prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        description: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    balance,
    transactions: recent,
  });
}
