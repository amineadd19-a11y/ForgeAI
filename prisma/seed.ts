import { PrismaClient, PlanTier } from "@prisma/client";
import { PLANS } from "../src/lib/config";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding plans...");

  for (const [tier, plan] of Object.entries(PLANS)) {
    await prisma.plan.upsert({
      where: { tier: tier as PlanTier },
      create: {
        tier: tier as PlanTier,
        name: plan.name,
        description: plan.description,
        monthlyPriceCents: plan.monthlyPriceCents,
        yearlyPriceCents: plan.yearlyPriceCents ?? null,
        includedCredits: plan.includedCredits,
        maxRequestsPerMinute: plan.maxRequestsPerMinute,
        maxRequestsPerDay: plan.maxRequestsPerDay,
        maxInputTokens: plan.maxInputTokens,
        maxOutputTokens: plan.maxOutputTokens,
        allowedModels: [...plan.allowedModels],
        features: plan.features,
        isActive: true,
      },
      update: {
        name: plan.name,
        description: plan.description,
        monthlyPriceCents: plan.monthlyPriceCents,
        yearlyPriceCents: plan.yearlyPriceCents ?? null,
        includedCredits: plan.includedCredits,
        maxRequestsPerMinute: plan.maxRequestsPerMinute,
        maxRequestsPerDay: plan.maxRequestsPerDay,
        maxInputTokens: plan.maxInputTokens,
        maxOutputTokens: plan.maxOutputTokens,
        allowedModels: [...plan.allowedModels],
        features: plan.features,
        isActive: true,
      },
    });
    console.log(`  ✓ ${plan.name}`);
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
