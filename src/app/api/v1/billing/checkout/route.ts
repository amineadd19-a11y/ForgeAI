import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { createCheckoutSession, isStripeConfigured } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { PLANS, CREDIT_PACKS } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  mode: z.enum(["subscription", "payment"]),
  planTier: z.enum(["STARTER", "PRO", "BUSINESS"]).optional(),
  creditPackId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
      { status: 401 }
    );
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      {
        error: {
          code: "BILLING_UNAVAILABLE",
          message: "Stripe is not configured on this deployment",
        },
      },
      { status: 503 }
    );
  }

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: e instanceof z.ZodError ? e.errors : "Invalid body",
        },
      },
      { status: 400 }
    );
  }

  if (body.mode === "subscription" && !body.planTier) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "planTier required" } },
      { status: 400 }
    );
  }
  if (body.mode === "payment" && !body.creditPackId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "creditPackId required" } },
      { status: 400 }
    );
  }
  if (body.planTier && !PLANS[body.planTier]) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid plan" } },
      { status: 400 }
    );
  }
  if (body.creditPackId && !CREDIT_PACKS.find((p) => p.id === body.creditPackId)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid credit pack" } },
      { status: 400 }
    );
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId: session.user.id },
  });

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  try {
    const checkout = await createCheckoutSession({
      userId: session.user.id,
      email: session.user.email,
      mode: body.mode,
      planTier: body.planTier,
      creditPackId: body.creditPackId,
      successUrl: `${appUrl}/dashboard/billing?success=1`,
      cancelUrl: `${appUrl}/dashboard/billing?canceled=1`,
      stripeCustomerId: subscription?.stripeCustomerId,
    });

    return NextResponse.json({
      url: checkout.url,
      sessionId: checkout.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    console.error("Checkout error:", message);
    return NextResponse.json(
      { error: { code: "CHECKOUT_FAILED", message } },
      { status: 500 }
    );
  }
}
