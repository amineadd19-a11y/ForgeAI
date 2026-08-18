import Stripe from "stripe";
import { CREDIT_PACKS, PLANS } from "./config";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
    stripeClient = new Stripe(key, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    });
  }
  return stripeClient;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function priceIdForPlan(tier: keyof typeof PLANS): string | undefined {
  return process.env[`STRIPE_PRICE_${tier}_MONTHLY`];
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
  const metadata: Record<string, string> = { userId: params.userId };

  if (params.mode === "subscription" && params.planTier) {
    const plan = PLANS[params.planTier];
    if (!plan || plan.monthlyPriceCents <= 0) throw new Error("Invalid plan for subscription");

    const configuredPrice = priceIdForPlan(params.planTier);
    lineItems.push(
      configuredPrice
        ? { price: configuredPrice, quantity: 1 }
        : {
            price_data: {
              currency: "usd",
              unit_amount: plan.monthlyPriceCents,
              recurring: { interval: "month" },
              product_data: { name: `ForgeAI ${plan.name}`, description: plan.description },
            },
            quantity: 1,
          }
    );
    metadata.planTier = params.planTier;
    metadata.type = "subscription";
  } else if (params.mode === "payment" && params.creditPackId) {
    const pack = CREDIT_PACKS.find((p) => p.id === params.creditPackId);
    if (!pack) throw new Error("Invalid credit pack");
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: pack.priceCents,
        product_data: { name: pack.label, description: `${pack.credits} ForgeAI credits` },
      },
      quantity: 1,
    });
    metadata.creditPackId = pack.id;
    metadata.credits = String(pack.credits);
    metadata.type = "credits";
  } else {
    throw new Error("Invalid checkout parameters");
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: params.mode,
    customer_email: params.email,
    line_items: lineItems,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.userId,
    metadata,
    ...(params.mode === "subscription" ? { subscription_data: { metadata } } : {}),
  };

  if (params.stripeCustomerId) {
    sessionParams.customer = params.stripeCustomerId;
    delete sessionParams.customer_email;
  }

  return stripe.checkout.sessions.create(sessionParams);
}
