/**
 * Central configuration for ForgeAI.
 * All pricing, limits, and plan definitions live here so they can be changed
 * without scattering magic numbers through the codebase.
 */

export const APP_NAME = "ForgeAI";
export const APP_VERSION = "1.0.0";

export const CREDIT_COSTS = {
  generate: { basic: 1, standard: 2, advanced: 5 },
  analyze: { basic: 3, standard: 5, advanced: 10 },
  default: 2,
} as const;

const FREE_MODELS = [
  "gpt-4o-mini",
  "claude-3-haiku",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
] as string[];

const STARTER_MODELS = [
  ...FREE_MODELS,
  "gpt-4o",
  "claude-3-5-sonnet",
  "gemini-2.5-pro",
  "gemini-3.5-flash",
] as string[];

export const PLANS = {
  FREE: {
    tier: "FREE" as const,
    name: "Free",
    description: "Get started with limited credits and rate limits.",
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    includedCredits: 100,
    maxRequestsPerMinute: 10,
    maxRequestsPerDay: 100,
    maxInputTokens: 2048,
    maxOutputTokens: 1024,
    allowedModels: FREE_MODELS,
    features: ["Basic generation", "API access", "Community support"],
  },
  STARTER: {
    tier: "STARTER" as const,
    name: "Starter",
    description: "For indie developers and small projects.",
    monthlyPriceCents: 900,
    yearlyPriceCents: 9000,
    includedCredits: 2000,
    maxRequestsPerMinute: 30,
    maxRequestsPerDay: 1000,
    maxInputTokens: 8192,
    maxOutputTokens: 4096,
    allowedModels: STARTER_MODELS,
    features: ["Everything in Free", "Higher rate limits", "Priority support", "Usage analytics"],
  },
  PRO: {
    tier: "PRO" as const,
    name: "Pro",
    description: "For growing teams and production workloads.",
    monthlyPriceCents: 2900,
    yearlyPriceCents: 29000,
    includedCredits: 10000,
    maxRequestsPerMinute: 100,
    maxRequestsPerDay: 10000,
    maxInputTokens: 32000,
    maxOutputTokens: 8192,
    allowedModels: ["*"] as string[],
    features: ["Everything in Starter", "Advanced models", "Higher limits", "Webhook support", "Dedicated support"],
  },
  BUSINESS: {
    tier: "BUSINESS" as const,
    name: "Business",
    description: "Enterprise-grade limits and controls.",
    monthlyPriceCents: 9900,
    yearlyPriceCents: 99000,
    includedCredits: 50000,
    maxRequestsPerMinute: 500,
    maxRequestsPerDay: 100000,
    maxInputTokens: 128000,
    maxOutputTokens: 16384,
    allowedModels: ["*"] as string[],
    features: ["Everything in Pro", "Custom rate limits", "SSO ready", "SLA", "Dedicated account manager"],
  },
} as const;

export type PlanTier = keyof typeof PLANS;

export const CREDIT_PACKS = [
  { id: "credits_500", credits: 500, priceCents: 500, label: "500 credits" },
  { id: "credits_2000", credits: 2000, priceCents: 1800, label: "2,000 credits" },
  { id: "credits_10000", credits: 10000, priceCents: 8000, label: "10,000 credits" },
] as const;

export const RATE_LIMITS = { globalIpPerMinute: 60, authAttemptsPerMinute: 10 } as const;

export const AI_DEFAULTS = {
  timeoutMs: 60_000,
  maxRetries: 2,
  maxInputChars: 100_000,
  maxOutputTokensDefault: 4096,
} as const;

export function getCreditCost(operation: "generate" | "analyze", complexity: "basic" | "standard" | "advanced" = "standard"): number {
  const costs = CREDIT_COSTS[operation];
  return costs[complexity] ?? CREDIT_COSTS.default;
}

export function isModelAllowed(planTier: PlanTier, model: string): boolean {
  const plan = PLANS[planTier];
  if (!plan) return false;
  if (plan.allowedModels.includes("*")) return true;
  return plan.allowedModels.includes(model);
}
