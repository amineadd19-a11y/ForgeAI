import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PLANS, type PlanTier } from "@/lib/config";
import { PlaygroundClient } from "./playground-client";

/**
 * Server component: resolve the authenticated user's plan from the existing
 * subscription table, then pass planTier to the client so the model selector
 * only lists allowed models. Server-side isModelAllowed remains authoritative.
 */
export default async function PlaygroundPage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  let planTier: PlanTier = "FREE";
  let planName = PLANS.FREE.name;

  if (userId) {
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
      include: { plan: true },
    });
    const tier = subscription?.plan?.tier as PlanTier | undefined;
    if (tier && PLANS[tier]) {
      planTier = tier;
      planName = PLANS[tier].name;
    }
  }

  return <PlaygroundClient planTier={planTier} planName={planName} />;
}
