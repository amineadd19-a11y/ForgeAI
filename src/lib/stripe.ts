import Stripe from "stripe";
import { CREDIT_PACKS, PLANS } from "./config";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripeClient = new Stripe(key, {
      apiVersion: "2024-06-20",
      typescript: true,
    });
  }
  return stripeClient;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export async function createCheckoutSession(params: {
  userId: string;
  email: string;
  mode: "subscription" | "payment";
  planTier?: keyof typeof PLANS;
  creditPackId?: string;
  successUrl: string;
  cancelUrl: string;
  stripeCustomerId?: string | null;
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  let metadata: Record<string, string> = { userId: params.userId };

  if (params.mode === "subscription" && params.planTier) {
    const plan = PLANS[params.planTier];
    if (!plan || plan.monthlyPriceCents <= 0) {
      throw new Error("Invalid plan for subscription");
    }
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: plan.monthlyPriceCents,
        recurring: { interval: "month" },
        product_data: {
          name: `ForgeAI ${plan.name}`,
          description: plan.description,
        },
      },
      quantity: 1,
    });
    metadata = { ...metadata, type: "subscription", planTier: params.planTier };
  } else if (params.mode === "payment" && params.creditPackId) {
    const pack = CREDIT_PACKS.find((p) => p.id === params.creditPackId);
    if (!pack) throw new Error("Invalid credit pack");
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: pack.priceCents,
        product_data: {
          name: `ForgeAI ${pack.label}`,
          description: `${pack.credits} credits`,
        },
      },
      quantity: 1,
    });
    metadata = {
      ...metadata,
      type: "credits",
      creditPackId: pack.id,
      credits: String(pack.credits),
    };
  } else {
    throw new Error("Invalid checkout parameters");
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: params.mode,
    line_items: lineItems,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.userId,
    metadata,
    customer_email: params.stripeCustomerId ? undefined : params.email,
  };

  if (params.stripeCustomerId) {
    sessionParams.customer = params.stripeCustomerId;
  }

  return stripe.checkout.sessions.create(sessionParams);
}

export async function createCustomerPortalSession(
  customerId: string,
  returnUrl: string
): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripe();
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}
