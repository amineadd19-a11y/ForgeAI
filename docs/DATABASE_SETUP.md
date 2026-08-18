# Production database setup (auth)

Registration and login require a PostgreSQL database with the Prisma schema applied.

## Required environment variables

- `DATABASE_URL` — Postgres connection string (Production)
- `AUTH_SECRET` — session signing secret (`openssl rand -base64 32`)
- `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` — public app origin (non-empty)

## Apply schema

From a machine that can reach Production Postgres:

```bash
export DATABASE_URL="postgresql://..."   # Production URL
npx prisma db push
npx prisma db seed
```

Or with migrations:

```bash
npx prisma migrate deploy
npx prisma db seed
```

## Verify

`GET /api/health` should report:

- `checks.database.ok: true`
- `checks.database.authSchemaReady: true`
- `checks.auth.secretConfigured: true`

If `authSchemaReady` is false with `prismaCode: P2021`, tables are missing — run `db push`.

## Registration errors (API)

| Code | Meaning |
|------|--------|
| `INVALID_INPUT` | Bad email/password |
| `EMAIL_ALREADY_EXISTS` | Duplicate email |
| `DATABASE_NOT_CONFIGURED` | Missing `DATABASE_URL` |
| `DATABASE_ERROR` | Connect/schema failure |
| `AUTH_CONFIGURATION_ERROR` | Missing `AUTH_SECRET` |
| `REGISTRATION_FAILED` | Unexpected failure |
