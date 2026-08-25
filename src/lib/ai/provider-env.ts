/** Safe provider environment introspection. Never returns secret values. */
export type EnvPresence = { exists: boolean; trimmedLength: number };

export function envPresence(key: string): EnvPresence {
  if (!Object.prototype.hasOwnProperty.call(process.env, key)) return { exists: false, trimmedLength: 0 };
  const value = process.env[key];
  if (value === undefined) return { exists: false, trimmedLength: 0 };
  return { exists: true, trimmedLength: value.trim().length };
}

export function hasNonEmptyEnv(...keys: string[]): boolean {
  return keys.some((k) => envPresence(k).trimmedLength > 0);
}

export type ProviderId = "openai" | "anthropic" | "google" | "xai" | "openrouter" | "mock";

export function isProviderConfigured(provider: ProviderId): boolean {
  switch (provider) {
    case "openai": return hasNonEmptyEnv("AI_API_KEY", "OPENAI_API_KEY");
    case "anthropic": return hasNonEmptyEnv("ANTHROPIC_API_KEY");
    case "google": return hasNonEmptyEnv("GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY");
    case "xai": return hasNonEmptyEnv("XAI_API_KEY", "GROK_API_KEY");
    case "openrouter": return hasNonEmptyEnv("OPENROUTER_API_KEY");
    case "mock": return process.env.NODE_ENV !== "production";
    default: return false;
  }
}

export function getConfiguredProviders(): Record<ProviderId, boolean> {
  return {
    openai: isProviderConfigured("openai"),
    anthropic: isProviderConfigured("anthropic"),
    google: isProviderConfigured("google"),
    xai: isProviderConfigured("xai"),
    openrouter: isProviderConfigured("openrouter"),
    mock: isProviderConfigured("mock"),
  };
}

export function getPrimaryProviderName(): string {
  return (process.env.AI_PROVIDER || "openai").toLowerCase();
}
