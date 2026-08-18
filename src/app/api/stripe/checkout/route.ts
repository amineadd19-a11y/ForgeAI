import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createCheckoutSession } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { PLANS, PlanTier } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const email = session?.user?.email;

  if (!userId || !email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { plan?: string };
    const planTier = String(body.plan || "").toUpperCase() as PlanTier;

    if (!planTier || !PLANS[planTier] || planTier === "FREE") {
      return NextResponse.json({ error: "Invalid paid plan" }, { status: 400 });
    }

    const existing = await prisma.subscription.findUnique({
      where: { userId },
      select: { stripeCustomerId: true },
    });

    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const checkout = await createCheckoutSession({
      userId,
      email,
      mode: "subscription",
      planTier,
      successUrl: `${origin}/dashboard?billing=success`,
      cancelUrl: `${origin}/pricing?billing=cancelled`,
      stripeCustomerId: existing?.stripeCustomerId,
    });

    if (!checkout.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
    }

    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    console.error("Stripe checkout error", error);
    return NextResponse.json({ error: "Unable to start checkout" }, { status: 500 });
  }
}
