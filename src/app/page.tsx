import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-zinc-800">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <span className="text-xl font-bold tracking-tight text-white">
            Forge<span className="text-blue-500">AI</span>
          </span>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/docs" className="text-zinc-400 hover:text-white transition">Docs</Link>
            <Link href="/login" className="text-zinc-400 hover:text-white transition">Sign in</Link>
            <Link href="/register" className="rounded-lg bg-blue-600 px-4 py-2 text-white font-medium hover:bg-blue-500 transition">Get started</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-24 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-white max-w-3xl mx-auto leading-tight">
            AI infrastructure for developers who ship
          </h1>
          <p className="mt-6 text-lg text-zinc-400 max-w-2xl mx-auto">
            Secure API, credits, subscriptions, and a provider-agnostic gateway. Charge only on success.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link href="/register" className="rounded-lg bg-blue-600 px-6 py-3 text-white font-semibold hover:bg-blue-500 transition">Start free</Link>
            <Link href="/docs" className="rounded-lg border border-zinc-700 px-6 py-3 text-zinc-200 font-medium hover:border-zinc-500 transition">Read the docs</Link>
          </div>
        </section>
      </main>
      <footer className="border-t border-zinc-800 py-8 text-center text-sm text-zinc-500">ForgeAI · Production AI infrastructure</footer>
    </div>
  );
}
