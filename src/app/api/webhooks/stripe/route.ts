import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { grantCredits } from "@/lib/credits";
import { CreditTransactionType, SubscriptionStatus } from "@prisma/client";
import { PLANS, PlanTier } from "@/lib/config";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    console.error("Stripe webhook signature verification failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const existing = await prisma.webhookEvent.findUnique({ where: { eventId: event.id } });
  if (existing?.processed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await prisma.webhookEvent.upsert({
      where: { eventId: event.id },
      create: {
        provider: "stripe",
        eventId: event.id,
        type: event.type,
        payload: event as unknown as object,
        processed: false,
      },
      update: {},
    });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);
    await prisma.webhookEvent.update({
      where: { eventId: event.id },
      data: { processed: true, processedAt: new Date() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing error";
    await prisma.webhookEvent.update({
      where: { eventId: event.id },
      data: { processingError: message.slice(0, 1000) },
    });
    console.error("Webhook processing error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.created": {
      await handleSubscriptionChange(event.data.object as Stripe.Subscription);
      break;
    }
    case "customer.subscription.deleted": {
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    }
    case "invoice.payment_failed": {
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    }
    default:
      break;
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.client_reference_id || session.metadata?.userId;
  if (!userId) throw new Error("checkout.session.completed missing userId");

  const type = session.metadata?.type;

  await prisma.payment.upsert({
    where: { stripeSessionId: session.id },
    create: {
      userId,
      stripeSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? "usd",
      status: "SUCCEEDED",
      type: type === "credits" ? "one_time_credits" : "subscription",
      creditsGranted: type === "credits" ? Number(session.metadata?.credits || 0) : null,
      description:
        type === "credits"
          ? `Credit pack: ${session.metadata?.creditPackId}`
          : `Subscription: ${session.metadata?.planTier}`,
      metadata: session.metadata as object,
    },
    update: { status: "SUCCEEDED" },
  });

  if (type === "credits") {
    const credits = Number(session.metadata?.credits || 0);
    if (credits > 0) {
      await grantCredits(
        userId,
        credits,
        CreditTransactionType.PURCHASE,
        `Stripe credit purchase (${session.metadata?.creditPackId})`,
        session.id
      );
    }
  }

  if (type === "subscription" && session.metadata?.planTier) {
    const planTier = session.metadata.planTier as PlanTier;
    const plan = await prisma.plan.findUnique({ where: { tier: planTier } });
    if (!plan) throw new Error(`Plan ${planTier} not found`);

    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id;

    await prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        planId: plan.id,
        status: "ACTIVE",
        stripeCustomerId: customerId ?? null,
        stripeSubscriptionId:
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null,
      },
      update: {
        planId: plan.id,
        status: "ACTIVE",
        stripeCustomerId: customerId ?? undefined,
        stripeSubscriptionId:
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? undefined,
      },
    });

    const included = PLANS[planTier]?.includedCredits ?? 0;
    if (included > 0) {
      await grantCredits(
        userId,
        included,
        CreditTransactionType.SUBSCRIPTION_GRANT,
        `${plan.name} plan credits`,
        session.id
      );
    }
  }
}

async function handleSubscriptionChange(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const existing = await prisma.subscription.findFirst({
    where: {
      OR: [{ stripeSubscriptionId: sub.id }, { stripeCustomerId: customerId }],
    },
  });
  if (!existing) return;

  const statusMap: Record<string, SubscriptionStatus> = {
    active: "ACTIVE",
    past_due: "PAST_DUE",
    canceled: "CANCELED",
    incomplete: "INCOMPLETE",
    trialing: "TRIALING",
    unpaid: "UNPAID",
  };

  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      status: statusMap[sub.status] ?? "ACTIVE",
      stripeSubscriptionId: sub.id,
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
  });
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const existing = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: sub.id },
  });
  if (!existing) return;

  const freePlan = await prisma.plan.findUnique({ where: { tier: "FREE" } });
  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      status: "CANCELED",
      planId: freePlan?.id ?? existing.planId,
      canceledAt: new Date(),
      cancelAtPeriodEnd: false,
    },
  });
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  const sub = await prisma.subscription.findFirst({
    where: { stripeCustomerId: customerId },
  });
  if (!sub) return;

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: "PAST_DUE" },
  });
}
