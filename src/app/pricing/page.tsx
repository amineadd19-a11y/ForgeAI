"use client";

import { useState } from "react";

const plans = [
  { tier: "STARTER", name: "Starter", price: "$9", credits: "2,000 credits", description: "For indie developers and small projects." },
  { tier: "PRO", name: "Pro", price: "$29", credits: "10,000 credits", description: "For growing teams and production workloads." },
  { tier: "BUSINESS", name: "Business", price: "$99", credits: "50,000 credits", description: "Enterprise-grade limits and controls." },
];

export default function PricingPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkout(tier: string) {
    setLoading(tier);
    setError(null);
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: tier }),
      });
      const data = await response.json();
      if (response.status === 401) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent(`/pricing?plan=${tier}`)}`;
        return;
      }
      if (!response.ok || !data.url) throw new Error(data.error || "Unable to start checkout");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start checkout");
      setLoading(null);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">ForgeAI Billing</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Choose your plan</h1>
        <p className="mt-4 text-slate-400">Secure recurring billing powered by Stripe. Cancel anytime from the billing portal.</p>
      </div>

      {error && <div className="mx-auto mt-8 max-w-2xl rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <section key={plan.tier} className="rounded-2xl border border-white/10 bg-white/[0.03] p-7 shadow-xl">
            <h2 className="text-xl font-semibold">{plan.name}</h2>
            <p className="mt-2 min-h-12 text-sm text-slate-400">{plan.description}</p>
            <div className="mt-6 flex items-end gap-2"><span className="text-4xl font-bold">{plan.price}</span><span className="pb-1 text-slate-400">/ month</span></div>
            <div className="mt-5 rounded-lg bg-white/5 p-3 text-sm font-medium">{plan.credits}</div>
            <button
              type="button"
              onClick={() => checkout(plan.tier)}
              disabled={loading !== null}
              className="mt-6 w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading === plan.tier ? "Opening Stripe…" : `Choose ${plan.name}`}
            </button>
          </section>
        ))}
      </div>
    </main>
  );
}
