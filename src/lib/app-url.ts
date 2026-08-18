/**
 * Production-safe application URL resolution.
 * Never returns an empty string — empty env vars are treated as unset.
 */

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeCandidate(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // VERCEL_URL is host-only (no scheme)
  if (!/^https?:\/\//i.test(trimmed)) {
    const withScheme = `https://${trimmed}`;
    return isValidHttpUrl(withScheme) ? withScheme : null;
  }
  return isValidHttpUrl(trimmed) ? trimmed : null;
}

/**
 * Resolve the public application origin for redirects, auth, and Stripe.
 * Order: explicit app URL → NEXTAUTH_URL → Vercel production/branch URLs → localhost.
 */
export function getAppUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXTAUTH_URL,
    process.env.APP_URL,
    process.env.NEXTAUTH_URL_INTERNAL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
  ];

  for (const c of candidates) {
    const normalized = normalizeCandidate(c);
    if (normalized) {
      try {
        return new URL(normalized).origin;
      } catch {
        // continue
      }
    }
  }

  return "http://localhost:3000";
}

/**
 * Resolve origin from a request when available, else fall back to getAppUrl().
 * Safe for API routes; never calls new URL with an empty string.
 */
export function getRequestOrigin(req?: { url?: string; headers?: Headers }): string {
  const fromEnv = getAppUrl();
  if (!req?.url) return fromEnv;

  try {
    const u = new URL(req.url);
    // During build/prerender, req.url can be relative or empty-origin
    if (u.origin && u.origin !== "null" && u.protocol.startsWith("http")) {
      return u.origin;
    }
  } catch {
    // fall through
  }

  // Prefer forwarded host on Vercel if present
  const host = req.headers?.get?.("x-forwarded-host") || req.headers?.get?.("host");
  const proto = req.headers?.get?.("x-forwarded-proto") || "https";
  if (host && host.trim()) {
    const candidate = `${proto}://${host.trim()}`;
    if (isValidHttpUrl(candidate)) return new URL(candidate).origin;
  }

  return fromEnv;
}
