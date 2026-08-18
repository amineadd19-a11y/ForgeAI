import { prisma } from "./db";

export type DbStatus =
  | { ok: true; configured: true }
  | {
      ok: false;
      configured: boolean;
      code: "DATABASE_NOT_CONFIGURED" | "DATABASE_ERROR";
      prismaCode?: string;
      stage: string;
      detail: string;
    };

/** True when DATABASE_URL is present and non-empty. Does not validate connectivity. */
export function isDatabaseUrlConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  return Boolean(url && url.trim() && !url.includes("user:password@localhost"));
}

/**
 * Lightweight connectivity + required-table check for auth flows.
 * Never returns secrets or the connection string.
 */
export async function checkDatabaseForAuth(): Promise<DbStatus> {
  if (!process.env.DATABASE_URL?.trim()) {
    return {
      ok: false,
      configured: false,
      code: "DATABASE_NOT_CONFIGURED",
      stage: "env",
      detail: "DATABASE_URL is not set",
    };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    const prismaCode =
      e && typeof e === "object" && "code" in e
        ? String((e as { code: unknown }).code)
        : undefined;
    return {
      ok: false,
      configured: true,
      code: "DATABASE_ERROR",
      prismaCode,
      stage: "connect",
      detail: "Cannot reach the database",
    };
  }

  try {
    // Confirms User model/table is available (not just SELECT 1)
    await prisma.user.findFirst({ select: { id: true }, take: 1 });
  } catch (e) {
    const prismaCode =
      e && typeof e === "object" && "code" in e
        ? String((e as { code: unknown }).code)
        : undefined;
    // P2021 = table does not exist
    if (prismaCode === "P2021") {
      return {
        ok: false,
        configured: true,
        code: "DATABASE_ERROR",
        prismaCode,
        stage: "schema",
        detail: "User table is missing — run prisma db push / migrate against production",
      };
    }
    return {
      ok: false,
      configured: true,
      code: "DATABASE_ERROR",
      prismaCode,
      stage: "schema",
      detail: "Database schema is not ready for authentication",
    };
  }

  return { ok: true, configured: true };
}

export function mapPrismaAuthError(e: unknown): {
  code: "EMAIL_ALREADY_EXISTS" | "DATABASE_ERROR" | "REGISTRATION_FAILED";
  prismaCode?: string;
  detail: string;
} {
  if (e && typeof e === "object" && "code" in e) {
    const code = String((e as { code: unknown }).code);
    // Unique constraint
    if (code === "P2002") {
      return {
        code: "EMAIL_ALREADY_EXISTS",
        prismaCode: code,
        detail: "Email already registered",
      };
    }
    if (code === "P2021") {
      return {
        code: "DATABASE_ERROR",
        prismaCode: code,
        detail: "Required table is missing",
      };
    }
    if (code === "P1001" || code === "P1000" || code === "P1017") {
      return {
        code: "DATABASE_ERROR",
        prismaCode: code,
        detail: "Database connection failed",
      };
    }
    return {
      code: "DATABASE_ERROR",
      prismaCode: code,
      detail: "Database operation failed",
    };
  }
  return {
    code: "REGISTRATION_FAILED",
    detail: "Unexpected registration error",
  };
}
