import { prisma } from "./db";
import { CreditTransactionType, Prisma } from "@prisma/client";
import { getCreditCost } from "./config";

/**
 * Atomic credit operations.
 * Uses database transactions to prevent negative balances and race conditions.
 * USAGE rows with the same referenceId are unique at the DB level (@@unique([type, referenceId])).
 */

export async function getBalance(userId: string): Promise<number> {
  const balance = await prisma.creditBalance.findUnique({
    where: { userId },
  });
  return balance?.balance ?? 0;
}

export async function ensureBalanceRecord(userId: string): Promise<void> {
  await prisma.creditBalance.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
  });
}

/**
 * Deduct credits atomically. Returns false if insufficient balance.
 * Never allows negative balance.
 * When `referenceId` is provided, a prior USAGE transaction with the same
 * referenceId is treated as already charged (idempotent — no double deduction).
 * Concurrent duplicate inserts are rejected by @@unique([type, referenceId]).
 */
export async function deductCredits(
  userId: string,
  amount: number,
  description: string,
  referenceId?: string
): Promise<{ success: boolean; balanceAfter: number; transactionId?: string; duplicate?: boolean }> {
  if (amount <= 0) {
    return { success: false, balanceAfter: await getBalance(userId) };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (referenceId) {
        const existing = await tx.creditTransaction.findFirst({
          where: {
            userId,
            referenceId,
            type: CreditTransactionType.USAGE,
          },
          orderBy: { createdAt: "desc" },
        });
        if (existing) {
          return {
            success: true,
            balanceAfter: existing.balanceAfter,
            transactionId: existing.id,
            duplicate: true,
          };
        }
      }

      const current = await tx.creditBalance.findUnique({
        where: { userId },
      });

      const balance = current?.balance ?? 0;
      if (balance < amount) {
        return { success: false, balanceAfter: balance };
      }

      const newBalance = balance - amount;

      await tx.creditBalance.upsert({
        where: { userId },
        create: { userId, balance: newBalance },
        update: { balance: newBalance },
      });

      const txRecord = await tx.creditTransaction.create({
        data: {
          userId,
          type: CreditTransactionType.USAGE,
          amount: -amount,
          balanceAfter: newBalance,
          description,
          referenceId,
        },
      });

      return {
        success: true,
        balanceAfter: newBalance,
        transactionId: txRecord.id,
        duplicate: false,
      };
    });
  } catch (e) {
    // Concurrent insert with same (type, referenceId) — treat as already charged
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      referenceId
    ) {
      const existing = await prisma.creditTransaction.findFirst({
        where: {
          userId,
          referenceId,
          type: CreditTransactionType.USAGE,
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        return {
          success: true,
          balanceAfter: existing.balanceAfter,
          transactionId: existing.id,
          duplicate: true,
        };
      }
      return { success: true, balanceAfter: await getBalance(userId), duplicate: true };
    }
    throw e;
  }
}

/**
 * Grant credits (purchase, subscription, refund, adjustment).
 */
export async function grantCredits(
  userId: string,
  amount: number,
  type: CreditTransactionType,
  description: string,
  referenceId?: string
): Promise<{ balanceAfter: number; transactionId: string }> {
  if (amount <= 0) throw new Error("Grant amount must be positive");

  return prisma.$transaction(async (tx) => {
    const current = await tx.creditBalance.findUnique({ where: { userId } });
    const balance = current?.balance ?? 0;
    const newBalance = balance + amount;

    await tx.creditBalance.upsert({
      where: { userId },
      create: { userId, balance: newBalance },
      update: { balance: newBalance },
    });

    const txRecord = await tx.creditTransaction.create({
      data: {
        userId,
        type,
        amount,
        balanceAfter: newBalance,
        description,
        referenceId,
      },
    });

    return { balanceAfter: newBalance, transactionId: txRecord.id };
  });
}

/**
 * Calculate cost for an operation. Central place — do not hard-code elsewhere.
 */
export function calculateCost(
  operation: "generate" | "analyze",
  complexity: "basic" | "standard" | "advanced" = "standard"
): number {
  return getCreditCost(operation, complexity);
}
