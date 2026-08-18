import Link from "next/link";

export default function DocsPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800">
        <div className="mx-auto max-w-3xl px-4 py-4 flex justify-between">
          <Link href="/" className="font-bold text-white">Forge<span className="text-blue-500">AI</span></Link>
          <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-white">Dashboard</Link>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold text-white mb-2">API Documentation</h1>
        <p className="text-zinc-400 mb-8">Versioned REST API for AI generation with credits and rate limits.</p>
        <h2 className="text-xl font-semibold text-white mt-10 mb-3">Authentication</h2>
        <pre className="rounded-lg bg-zinc-900 border border-zinc-800 p-4 text-sm overflow-x-auto text-zinc-300">Authorization: Bearer fa_live_...</pre>
        <h2 className="text-xl font-semibold text-white mt-10 mb-3">Generate</h2>
        <pre className="rounded-lg bg-zinc-900 border border-zinc-800 p-4 text-sm overflow-x-auto text-zinc-300">{`curl -X POST "$APP_URL/api/v1/ai/generate" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"prompt":"Hello","complexity":"basic"}'`}</pre>
        <h2 className="text-xl font-semibold text-white mt-10 mb-3">Credits</h2>
        <ul className="list-disc pl-5 text-zinc-400 space-y-1">
          <li>Basic generation: 1 credit</li>
          <li>Standard: 2 credits</li>
          <li>Advanced: 5 credits</li>
          <li>Credits are never charged if the provider fails</li>
        </ul>
        <h2 className="text-xl font-semibold text-white mt-10 mb-3">Error codes</h2>
        <ul className="list-disc pl-5 text-zinc-400 space-y-1 text-sm">
          <li>UNAUTHORIZED — missing/invalid API key</li>
          <li>INSUFFICIENT_CREDITS — not enough balance (402)</li>
          <li>RATE_LIMITED — RPM exceeded (429)</li>
          <li>PROVIDER_ERROR / TIMEOUT — AI provider issues (no charge)</li>
        </ul>
      </article>
    </div>
  );
}
