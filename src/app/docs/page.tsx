import Link from "next/link";

function Code({ children }: { children: string }) {
  return (
    <pre className="rounded-lg bg-zinc-900 border border-zinc-800 p-4 text-sm overflow-x-auto text-zinc-300 whitespace-pre-wrap">
      {children}
    </pre>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800">
        <div className="mx-auto max-w-3xl px-4 py-4 flex justify-between">
          <Link href="/" className="font-bold text-white">
            Forge<span className="text-blue-500">AI</span>
          </Link>
          <div className="flex gap-4 text-sm text-zinc-400">
            <Link href="/dashboard/playground" className="hover:text-white">
              Playground
            </Link>
            <Link href="/dashboard" className="hover:text-white">
              Dashboard
            </Link>
          </div>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-4 py-12 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">API Documentation</h1>
          <p className="text-zinc-400">
            Versioned REST API for AI generation with credits, rate limits, and streaming.
          </p>
        </div>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">1. Authentication</h2>
          <p className="text-zinc-400 text-sm mb-3">
            Create an API key in the dashboard. Keys are shown once and stored hashed.
          </p>
          <Code>{"Authorization: Bearer fa_live_YOUR_KEY"}</Code>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">2. Non-streaming generate</h2>
          <Code>{`curl -X POST "$APP_URL/api/v1/ai/generate" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "Explain rate limiting in one sentence.",
    "model": "gpt-4o-mini",
    "complexity": "basic",
    "stream": false
  }'`}</Code>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">3. Streaming generate (SSE)</h2>
          <Code>{`curl -N -X POST "$APP_URL/api/v1/ai/generate" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "Write a short haiku about APIs.",
    "model": "grok-3-mini",
    "complexity": "basic",
    "stream": true
  }'`}</Code>
          <p className="text-zinc-500 text-sm mt-2">Response Content-Type: text/event-stream</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">4. OpenAI model</h2>
          <Code>{`curl -X POST "$APP_URL/api/v1/ai/generate" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"Hello from OpenAI","model":"gpt-4o-mini","complexity":"basic"}'`}</Code>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">5. Gemini model</h2>
          <Code>{`curl -X POST "$APP_URL/api/v1/ai/generate" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"Hello from Gemini","model":"gemini-2.5-flash-lite","complexity":"basic"}'`}</Code>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">6. Anthropic model</h2>
          <Code>{`curl -X POST "$APP_URL/api/v1/ai/generate" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"Hello from Claude","model":"claude-3-haiku","complexity":"basic"}'`}</Code>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">7. Grok (xAI) model</h2>
          <Code>{`curl -X POST "$APP_URL/api/v1/ai/generate" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"Hello from Grok","model":"grok-3-mini","complexity":"basic"}'`}</Code>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">8. Handling SSE events</h2>
          <Code>{`data: {"type":"meta","requestId":"req_...","model":"gpt-4o-mini"}

data: {"type":"delta","content":"Hello","requestId":"req_..."}

data: {"type":"done","id":"...","requestId":"req_...","content":"Hello world",
       "provider":"openai","model":"gpt-4o-mini",
       "usage":{"inputTokens":10,"outputTokens":2,"totalTokens":12,"credits":1},
       "latencyMs":420}

data: [DONE]`}</Code>
          <p className="text-zinc-500 text-sm mt-2">
            Clients should treat <code className="text-zinc-300">done</code> or{" "}
            <code className="text-zinc-300">error</code> as terminal. Credits are charged only on{" "}
            <code className="text-zinc-300">done</code>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">9. Error handling</h2>
          <ul className="list-disc pl-5 text-zinc-400 space-y-1 text-sm">
            <li>
              <strong className="text-zinc-300">UNAUTHORIZED</strong> — missing/invalid API key (401)
            </li>
            <li>
              <strong className="text-zinc-300">INSUFFICIENT_CREDITS</strong> — not enough balance (402)
            </li>
            <li>
              <strong className="text-zinc-300">MODEL_NOT_ALLOWED</strong> — model not on your plan
              (403)
            </li>
            <li>
              <strong className="text-zinc-300">RATE_LIMITED</strong> — RPM exceeded (429)
            </li>
            <li>
              <strong className="text-zinc-300">VALIDATION_ERROR</strong> — bad body (400)
            </li>
            <li>
              Provider failures return 502 (JSON) or an SSE{" "}
              <code className="text-zinc-300">error</code> event — <strong>no credit charge</strong>
            </li>
          </ul>
          <Code>{`// SSE error event
data: {"type":"error","code":"PROVIDER_UNAVAILABLE","message":"...","retryable":true,"requestId":"..."}`}</Code>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">10. Credits & usage</h2>
          <ul className="list-disc pl-5 text-zinc-400 space-y-1 text-sm">
            <li>Basic generation: 1 credit · Standard: 2 · Advanced: 5</li>
            <li>Credits are deducted only after a successful provider response (JSON success or SSE done)</li>
            <li>Failed, timed-out, empty, or aborted streams: 0 credits</li>
            <li>Never charged twice for the same requestId</li>
            <li>
              Inspect history in the dashboard{" "}
              <Link href="/dashboard/usage" className="text-blue-400 hover:underline">
                Usage
              </Link>{" "}
              page
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">Gateway reliability</h2>
          <ul className="list-disc pl-5 text-zinc-400 space-y-1 text-sm">
            <li>Per-provider timeouts (AI_TIMEOUT_MS, default 60s)</li>
            <li>Retries with exponential backoff for transient non-stream failures</li>
            <li>Configured fallback providers if primary fails before content</li>
            <li>Streaming: no intermediate terminal errors before fallback is exhausted</li>
            <li>Streaming: no provider switch after partial tokens have been emitted</li>
          </ul>
        </section>
      </article>
    </div>
  );
}
