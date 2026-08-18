import type { NextConfig } from "next";

/**
 * Empty string env vars (common when set-but-blank in Vercel) must be treated as
 * unset. next-auth client code does `new URL(process.env.NEXTAUTH_URL)` at module
 * init and throws ERR_INVALID_URL when the value is "".
 */
function resolveBuildAppUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXTAUTH_URL,
    process.env.APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "",
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
  ];

  for (const raw of candidates) {
    const value = (raw || "").trim();
    if (!value) continue;
    try {
      const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      return new URL(withScheme).origin;
    } catch {
      // continue
    }
  }
  return "http://localhost:3000";
}

const resolvedAppUrl = resolveBuildAppUrl();

// Normalize empty strings so next-auth and client bundles never see "".
if (!process.env.NEXTAUTH_URL?.trim()) {
  process.env.NEXTAUTH_URL = resolvedAppUrl;
}
if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) {
  process.env.NEXT_PUBLIC_APP_URL = resolvedAppUrl;
}
if (!process.env.NEXTAUTH_URL_INTERNAL?.trim()) {
  process.env.NEXTAUTH_URL_INTERNAL = process.env.NEXTAUTH_URL;
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // Embed non-empty values into the client bundle used by next-auth/react.
  env: {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
};

export default nextConfig;
