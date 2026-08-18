import { prisma } from "./db";
import { PLANS, PlanTier, RATE_LIMITS } from "./config";

/**
 * Simple database-backed rate limiter.
 * Production systems may prefer Redis; this is correct and race-safe enough
 * for moderate scale and works without extra infrastructure.
 */

export async function checkRateLimit(params: {
  userId: string;
  apiKeyId?: string;
  planTier: PlanTier;
  ip?: string;
}): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
}> {
  const plan = PLANS[params.planTier] || PLANS.FREE;
  const limit = plan.maxRequestsPerMinute;
  const windowMs = 60_000;
  const now = new Date();
  const windowKey = `user:${params.userId}:minute`;
  const expiresAt = new Date(now.getTime() + windowMs);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.rateLimitBucket.findUnique({
      where: { key_window: { key: windowKey, window: "minute" } },
    });

    if (existing && existing.expiresAt > now) {
      if (existing.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: existing.expiresAt,
          limit,
        };
      }
      const updated = await tx.rateLimitBucket.update({
        where: { id: existing.id },
        data: { count: { increment: 1 } },
      });
      return {
        allowed: true,
        remaining: Math.max(0, limit - updated.count),
        resetAt: existing.expiresAt,
        limit,
      };
    }

    await tx.rateLimitBucket.upsert({
      where: { key_window: { key: windowKey, window: "minute" } },
      create: {
        key: windowKey,
        window: "minute",
        count: 1,
        expiresAt,
      },
      update: {
        count: 1,
        expiresAt,
      },
    });

    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: expiresAt,
      limit,
    };
  });

  return result;
}

export function rateLimitHeaders(info: {
  remaining: number;
  resetAt: Date;
  limit: number;
}): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(info.limit),
    "X-RateLimit-Remaining": String(info.remaining),
    "X-RateLimit-Reset": String(Math.floor(info.resetAt.getTime() / 1000)),
  };
}
