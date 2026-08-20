import Link from "next/link";

export const dynamic = "force-dynamic";

const features = [
  {
    title: "Provider-agnostic gateway",
    description:
      "Route traffic across OpenAI, Anthropic, Google, xAI (Grok) and more. Automatic failover keeps your product online.",
  },
  {
    title: "Real credit system",
    description:
      "Atomic deductions. Credits are charged only after a successful provider response — never on errors or timeouts.",
  },
  {
    title: "Secure by default",
    description:
      "API keys hashed at rest, rate limits per plan, model allow-lists, Stripe webhook verification, and audit-ready logs.",
  },
  {
    title: "Billing that works",
    description:
      "Subscriptions + one-time credit packs powered by Stripe. Usage tracking and dashboards out of the box.",
  },
  {
    title: "Movie Studio",
    description:
      "Turn a screenplay into a full production package, then render scene images and videos — all billed through the same credits.",
  },
  {
    title: "Developer experience",
    description:
      "Versioned REST API, playground, docs, request IDs, and clear error codes. Built for teams that ship.",
  },
];

const plans = [
  { name: "Free", price: "$0", credits: "100 credits", rpm: "10 RPM", cta: "Start free" },
  { name: "Starter", price: "$9", credits: "2,000 credits", rpm: "30 RPM", cta: "Choose Starter", highlight: false },
  { name: "Pro", price: "$29", credits: "10,000 credits", rpm: "100 RPM", cta: "Choose Pro", highlight: true },
  { name: "Business", price: "$99", credits: "50,000 credits", rpm: "500 RPM", cta: "Choose Business" },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-xl font-bold tracking-tight">
            Forge<span className="text-blue-500">AI</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link href="#features" className="text-zinc-400 transition hover:text-white">
              Features
            </Link>
            <Link href="#pricing" className="text-zinc-400 transition hover:text-white">
              Pricing
            </Link>
            <Link href="/docs" className="text-zinc-400 transition hover:text-white">
              Docs
            </Link>
            <Link href="/login" className="text-zinc-400 transition hover:text-white">
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-500"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent" />
          <div className="mx-auto max-w-6xl px-4 pb-20 pt-24 text-center sm:pt-32">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 text-xs font-medium text-blue-300">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              Now with native xAI / Grok support
            </div>
            <h1 className="mx-auto max-w-4xl text-4xl font-bold tracking-tight text-white sm:text-6xl sm:leading-[1.1]">
              Production AI infrastructure
              <span className="block text-blue-400">for developers who ship</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
              Secure API · Credits · Subscriptions · Provider-agnostic gateway.
              Charge only on success. Swap models without rewriting your app.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/register"
                className="rounded-xl bg-blue-600 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-500"
              >
                Start free — 100 credits
              </Link>
              <Link
                href="/docs"
                className="rounded-xl border border-zinc-700 bg-zinc-900/50 px-7 py-3.5 text-base font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800/50"
              >
                Read the docs
              </Link>
            </div>
            <p className="mt-6 text-sm text-zinc-500">
              No credit card required · Open core · Self-host ready
            </p>
          </div>
        </section>

        {/* Social proof strip */}
        <section className="border-y border-zinc-800/80 bg-zinc-900/30">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-4 py-8 text-sm text-zinc-500">
            <span>OpenAI</span>
            <span>Anthropic</span>
            <span>Google Gemini</span>
            <span className="font-medium text-zinc-300">xAI Grok</span>
            <span>Stripe</span>
            <span>PostgreSQL</span>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-24">
          <div className="mb-14 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Everything you need to sell AI
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-zinc-400">
              ForgeAI is not a resold API key. Value is in the infrastructure,
              billing, security, developer experience, and abstraction layer.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition hover:border-zinc-700 hover:bg-zinc-900/70"
              >
                <h3 className="text-lg font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Code sample */}
        <section className="border-y border-zinc-800/80 bg-zinc-900/20">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-white">
                  One API. Every model.
                </h2>
                <p className="mt-4 text-zinc-400">
                  Authenticate with a ForgeAI key, pick any allowed model, and
                  get structured usage + remaining credits back on every response.
                </p>
                <ul className="mt-6 space-y-2 text-sm text-zinc-400">
                  <li className="flex items-center gap-2">
                    <span className="text-blue-400">✓</span> Credits only charged on success
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-blue-400">✓</span> Automatic provider fallback
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-blue-400">✓</span> Request IDs + rate-limit headers
                  </li>
                </ul>
              </div>
              <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
                  <span className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
                  <span className="ml-2 text-xs text-zinc-500">curl</span>
                </div>
                <pre className="overflow-x-auto p-5 text-left text-sm leading-relaxed text-zinc-300">
{`curl -X POST https://api.forgeai.dev/v1/ai/generate \\
  -H "Authorization: Bearer fa_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "Explain rate limiting",
    "model": "grok-3-mini",
    "complexity": "basic"
  }'`}
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl px-4 py-24">
          <div className="mb-14 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Simple, transparent pricing
            </h2>
            <p className="mt-4 text-zinc-400">
              Start free. Scale when you need to. Buy extra credit packs anytime.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => (
              <div
                key={p.name}
                className={`relative flex flex-col rounded-2xl border p-6 ${
                  p.highlight
                    ? "border-blue-500/50 bg-blue-500/5 shadow-lg shadow-blue-500/10"
                    : "border-zinc-800 bg-zinc-900/40"
                }`}
              >
                {p.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-0.5 text-xs font-medium text-white">
                    Most popular
                  </span>
                )}
                <div className="text-sm font-medium text-zinc-400">{p.name}</div>
                <div className="mt-2 text-3xl font-bold text-white">
                  {p.price}
                  <span className="text-base font-normal text-zinc-500">/mo</span>
                </div>
                <ul className="mt-5 flex-1 space-y-2 text-sm text-zinc-400">
                  <li>{p.credits} / month</li>
                  <li>{p.rpm}</li>
                  <li>API + Dashboard</li>
                </ul>
                <Link
                  href="/register"
                  className={`mt-6 block rounded-lg py-2.5 text-center text-sm font-semibold transition ${
                    p.highlight
                      ? "bg-blue-600 text-white hover:bg-blue-500"
                      : "border border-zinc-700 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
                  }`}
                >
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-zinc-800/80">
          <div className="mx-auto max-w-4xl px-4 py-20 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white">
              Ready to ship AI features?
            </h2>
            <p className="mt-4 text-zinc-400">
              Create an account, grab an API key, and start generating in under two minutes.
            </p>
            <Link
              href="/register"
              className="mt-8 inline-flex rounded-xl bg-blue-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-500"
            >
              Create free account
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-800 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-zinc-500 sm:flex-row">
          <div>
            Forge<span className="text-blue-500">AI</span> · Production AI infrastructure
          </div>
          <div className="flex gap-6">
            <Link href="/docs" className="hover:text-zinc-300">
              Docs
            </Link>
            <Link href="/pricing" className="hover:text-zinc-300">
              Pricing
            </Link>
            <Link href="/login" className="hover:text-zinc-300">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
