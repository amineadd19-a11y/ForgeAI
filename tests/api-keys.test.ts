import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "crypto";

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function generateRawApiKey() {
  const KEY_PREFIX = "fa_live_";
  const secret = randomBytes(32).toString("base64url");
  const raw = `${KEY_PREFIX}${secret}`;
  const prefix = raw.slice(0, 12);
  const hash = hashKey(raw);
  return { raw, prefix, hash };
}

describe("API key generation", () => {
  it("generates fa_live_ prefixed keys", () => {
    const { raw, prefix } = generateRawApiKey();
    expect(raw.startsWith("fa_live_")).toBe(true);
    expect(prefix.startsWith("fa_live_")).toBe(true);
    expect(prefix.length).toBe(12);
  });

  it("hashes deterministically and does not equal plaintext", () => {
    const { raw, hash } = generateRawApiKey();
    expect(hash).toBe(hashKey(raw));
    expect(hash).not.toBe(raw);
    expect(hash.length).toBe(64);
  });

  it("produces unique keys", () => {
    const a = generateRawApiKey();
    const b = generateRawApiKey();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });
});
