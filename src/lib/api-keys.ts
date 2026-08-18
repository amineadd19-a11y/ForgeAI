import { createHash, randomBytes } from "crypto";
import { prisma } from "./db";

/**
 * Secure API key management.
 * - Keys are shown only once at creation
 * - Stored as SHA-256 hash
 * - Prefix for identification (fa_live_xxxx)
 */

const KEY_PREFIX = "fa_live_";

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateRawApiKey(): { raw: string; prefix: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  const raw = `${KEY_PREFIX}${secret}`;
  const prefix = raw.slice(0, 12);
  const hash = hashKey(raw);
  return { raw, prefix, hash };
}

export async function createApiKey(
  userId: string,
  name: string
): Promise<{ id: string; key: string; prefix: string; name: string }> {
  const { raw, prefix, hash } = generateRawApiKey();

  const record = await prisma.apiKey.create({
    data: {
      userId,
      name,
      keyHash: hash,
      keyPrefix: prefix,
      isActive: true,
    },
  });

  return {
    id: record.id,
    key: raw,
    prefix,
    name: record.name,
  };
}

export async function revokeApiKey(
  userId: string,
  keyId: string
): Promise<boolean> {
  const result = await prisma.apiKey.updateMany({
    where: { id: keyId, userId, isActive: true },
    data: { isActive: false, revokedAt: new Date() },
  });
  return result.count > 0;
}

export async function rotateApiKey(
  userId: string,
  keyId: string
): Promise<{ id: string; key: string; prefix: string; name: string } | null> {
  const existing = await prisma.apiKey.findFirst({
    where: { id: keyId, userId },
  });
  if (!existing) return null;

  await prisma.apiKey.update({
    where: { id: keyId },
    data: { isActive: false, revokedAt: new Date() },
  });

  return createApiKey(userId, existing.name);
}

export async function authenticateApiKey(
  authorizationHeader: string | null
): Promise<{
  userId: string;
  apiKeyId: string;
  keyPrefix: string;
} | null> {
  if (!authorizationHeader) return null;

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const rawKey = match[1].trim();
  if (!rawKey.startsWith(KEY_PREFIX)) return null;

  const hash = hashKey(rawKey);

  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hash },
    select: {
      id: true,
      userId: true,
      keyPrefix: true,
      isActive: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (!key || !key.isActive || key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt < new Date()) return null;

  prisma.apiKey
    .update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    userId: key.userId,
    apiKeyId: key.id,
    keyPrefix: key.keyPrefix,
  };
}

export async function listUserApiKeys(userId: string) {
  return prisma.apiKey.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      isActive: true,
      lastUsedAt: true,
      createdAt: true,
      revokedAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
