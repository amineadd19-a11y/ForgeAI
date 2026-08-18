"use client";

import { useState } from "react";

const plans = [
  { tier: "STARTER", name: "Starter", price: "$9/mo" },
  { tier: "PRO", name: "Pro", price: "$29/mo" },
  { tier: "BUSINESS", name: "Business", price: "$99/mo" },
] as const;

const packs = [
  { id: "credits_500", label: "500 credits", price: "$5" },
  { id: "credits_2000", label: "2,000 credits", price: "$18" },
  { id: "credits_10000", label: "10,000 credits", price: "$80" },
];

export default function BillingPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function checkout(body: Record<string, string>) {
    setError("");
    setLoading(JSON.stringify(body));
    try {
      const res = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || "Checkout failed");
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch {
      setError("Network error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="text-sm text-zinc-400 mt-1">Subscriptions and credit packs. Confirmed via Stripe webhooks only.</p>
      </div>
      {error && <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-400">{error}</div>}
      <section>
        <h2 className="font-semibold text-white mb-3">Plans</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {plans.map((p) => (
            <div key={p.tier} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-medium text-white">{p.name}</div>
              <div className="text-2xl font-bold text-white mt-1">{p.price}</div>
              <button type="button" disabled={!!loading} onClick={() => checkout({ mode: "subscription", planTier: p.tier })} className="mt-4 w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white disabled:opacity-50">Subscribe</button>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="font-semibold text-white mb-3">Credit packs</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {packs.map((pack) => (
            <div key={pack.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-medium text-white">{pack.label}</div>
              <div className="text-2xl font-bold text-white mt-1">{pack.price}</div>
              <button type="button" disabled={!!loading} onClick={() => checkout({ mode: "payment", creditPackId: pack.id })} className="mt-4 w-full rounded-lg border border-zinc-600 py-2 text-sm font-semibold text-zinc-200 disabled:opacity-50">Buy</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
