import { prisma } from "./db";
import { CreditTransactionType } from "@prisma/client";
import { getCreditCost } from "./config";

/**
 * Atomic credit operations.
 * Uses database transactions to prevent negative balances and race conditions.
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
 */
export async function deductCredits(
  userId: string,
  amount: number,
  description: string,
  referenceId?: string
): Promise<{ success: boolean; balanceAfter: number; transactionId?: string }> {
  if (amount <= 0) {
    return { success: false, balanceAfter: await getBalance(userId) };
  }

  return prisma.$transaction(async (tx) => {
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
    };
  });
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
