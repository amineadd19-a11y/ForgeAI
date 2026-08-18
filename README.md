# ForgeAI

**Production AI infrastructure platform for developers and businesses.**

Secure API · Credits · Subscriptions · Usage-based billing · Provider-agnostic AI gateway

## Mission

ForgeAI provides a production-ready AI processing layer with:

- Versioned REST API (`/api/v1/...`)
- Cryptographically secure API keys (hashed at rest, shown once)
- Real credit system with atomic deductions
- Subscription plans + one-time credit packs
- Provider abstraction (swap providers without rewriting app logic)
- Rate limiting, usage tracking, request history
- Dashboard, playground, docs
- Stripe billing with webhook-only credit grants

We do **not** resell a third-party API key. Value is in the infrastructure, billing, security, DX, and abstraction.

## Architecture

```
User → Dashboard / API → Auth (API Key) → Credits & Rate Limits
     → AI Gateway → Configured Provider → Result
     → Usage recorded · Credits charged only on success
```

Provider is selected via environment:

```
AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
AI_API_KEY=sk-...
```

## Quick Start (Local)

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- (Optional) Stripe account + CLI for webhooks
- (Optional) OpenAI or compatible API key

### Setup

```bash
git clone https://github.com/amineadd19-a11y/ForgeAI.git
cd ForgeAI
cp .env.example .env.local
# Edit .env.local with DATABASE_URL, AUTH_SECRET, AI_* keys

npm install
npx prisma generate
npx prisma db push
npm run db:seed

npm run dev
```

Open http://localhost:3000

### Quality gate

```bash
npm run quality-gate
```

## API Overview

### Authentication

```http
Authorization: Bearer fa_live_...
```

### Generate

```bash
curl -X POST https://YOUR_DOMAIN/api/v1/ai/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Explain rate limiting in one sentence.","complexity":"basic"}'
```

Credits are **never** charged if the request does not reach a successful provider response.

## Plans

| Plan | Price | Credits / mo | RPM |
|------|-------|--------------|-----|
| Free | $0 | 100 | 10 |
| Starter | $9 | 2,000 | 30 |
| Pro | $29 | 10,000 | 100 |
| Business | $99 | 50,000 | 500 |

Prices and limits are configuration-driven.

## Security

- API keys hashed (SHA-256), never stored in plaintext
- Server-side only credit & payment verification
- Stripe webhook signature verification + idempotency
- Rate limits per user / plan
- Input size limits, model allow-lists by plan
- No secrets in NEXT_PUBLIC_*

## Open Core

- **Community**: core API, gateway, self-host, basic providers
- **Cloud**: hosted billing, advanced limits, managed infra

## Environment

See `.env.example`. Required for production:

- `DATABASE_URL`
- `AUTH_SECRET` / `NEXTAUTH_SECRET`
- `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` for billing

## License

Apache-2.0

Built for real commercial use. No fake metrics, no placeholder AI responses in production.
