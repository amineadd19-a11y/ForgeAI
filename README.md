# ForgeAI

**Production AI infrastructure platform for developers and businesses.**

Secure API · Credits · Subscriptions · Usage-based billing · Provider-agnostic AI gateway

> **v1.3** — Pro Playground, model catalog, streaming generate, native xAI / Grok.

## Mission

ForgeAI provides a production-ready AI processing layer with:

- Versioned REST API (`/api/v1/...`)
- Cryptographically secure API keys (hashed at rest, shown once)
- Real credit system with atomic deductions
- Subscription plans + one-time credit packs
- Provider abstraction (swap providers without rewriting app logic)
- **Streaming responses** (SSE) on generate
- **Pro Playground** — model selector, stream toggle, abort, live tokens, request metadata
- Rate limiting, usage tracking, request history
- Dashboard, playground, docs
- Stripe billing with webhook-only credit grants
- **Movie Studio** — screenplay → production package → scene images & video

We do **not** resell a third-party API key. Value is in the infrastructure, billing, security, DX, and abstraction.

## Supported providers

| Provider   | Env key             | Example models              | Streaming |
|------------|---------------------|-----------------------------|-----------|
| OpenAI     | `OPENAI_API_KEY`    | `gpt-4o-mini`, `gpt-4o`     | Yes       |
| Anthropic  | `ANTHROPIC_API_KEY` | `claude-3-5-haiku-latest`   | Yes       |
| Google     | `GEMINI_API_KEY`    | `gemini-2.5-flash-lite`     | Yes       |
| **xAI**    | `XAI_API_KEY`       | `grok-3-mini`, `grok-3`     | Yes       |
| Mock       | —                   | Local / test only           | Yes       |

Set `AI_PROVIDER` to choose the primary. Set `AI_FALLBACK_PROVIDER` (default `xai`) for automatic failover.

## Architecture

```
User → Dashboard / API → Auth (API Key) → Credits & Rate Limits
     → AI Gateway → Configured Provider → Result (JSON or SSE stream)
     → Usage recorded · Credits charged only on success
```

## Quick Start (Local)

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- (Optional) Stripe account + CLI for webhooks
- (Optional) OpenAI / Anthropic / Google / xAI API key

### Setup

```bash
git clone https://github.com/amineadd19-a11y/ForgeAI.git
cd ForgeAI
cp .env.example .env.local
# Edit .env.local with DATABASE_URL, AUTH_SECRET, AI_* / XAI_API_KEY keys

npm install
npx prisma generate
npx prisma db push
npm run db:seed

npm run dev
```

Open http://localhost:3000 — try **Dashboard → Playground**.

### Quality gate

```bash
npm run quality-gate
```

## API Overview

Full copy/paste examples: **[/docs](/docs)** on a running instance.

### Authentication

```http
Authorization: Bearer fa_live_...
```

### Generate (JSON)

```bash
curl -X POST https://YOUR_DOMAIN/api/v1/ai/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Explain rate limiting in one sentence.","model":"gpt-4o-mini","complexity":"basic","stream":false}'
```

### Generate (streaming SSE)

```bash
curl -N -X POST https://YOUR_DOMAIN/api/v1/ai/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Write a short haiku about APIs.","model":"grok-3-mini","stream":true,"complexity":"basic"}'
```

### Model examples

```bash
# OpenAI
-d '{"prompt":"Hi","model":"gpt-4o-mini","complexity":"basic"}'

# Gemini
-d '{"prompt":"Hi","model":"gemini-2.5-flash-lite","complexity":"basic"}'

# Anthropic
-d '{"prompt":"Hi","model":"claude-3-haiku","complexity":"basic"}'

# Grok
-d '{"prompt":"Hi","model":"grok-3-mini","complexity":"basic"}'
```

### SSE events

```text
data: {"type":"meta","requestId":"...","model":"..."}
data: {"type":"delta","content":"Hello","requestId":"..."}
data: {"type":"done","id":"...","requestId":"...","content":"...","usage":{...},"latencyMs":123}
data: [DONE]
```

Credits are **never** charged until a successful `done` event (or non-stream success). Failed / aborted / empty streams: **0 credits**.

## Plans

| Plan     | Price | Credits / mo | RPM |
|----------|-------|--------------|-----|
| Free     | $0    | 100          | 10  |
| Starter  | $9    | 2,000        | 30  |
| Pro      | $29   | 10,000       | 100 |
| Business | $99   | 50,000       | 500 |

Prices and limits are configuration-driven in `src/lib/config.ts`.

## Security

- API keys hashed (SHA-256), never stored in plaintext
- Server-side only credit & payment verification
- Stripe webhook signature verification + idempotency
- Rate limits per user / plan
- Input size limits, model allow-lists by plan
- No secrets in `NEXT_PUBLIC_*`

## Open Core

- **Community**: core API, gateway, self-host, basic providers
- **Cloud**: hosted billing, advanced limits, managed infra

## Environment

See `.env.example`. Required for production:

- `DATABASE_URL`
- `AUTH_SECRET` / `NEXTAUTH_SECRET`
- `AI_PROVIDER`, `AI_MODEL`, and the matching provider key (`OPENAI_API_KEY`, `XAI_API_KEY`, …)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` for billing

## License

Apache-2.0

Built for real commercial use. No fake metrics, no placeholder AI responses in production.
