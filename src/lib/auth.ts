import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare, hash } from "bcryptjs";
import { prisma } from "./db";
import { ensureBalanceRecord, grantCredits } from "./credits";
import { PLANS } from "./config";
import { CreditTransactionType } from "@prisma/client";
import { mapPrismaAuthError } from "./db-status";

export const authOptions: NextAuthOptions = {
  // JWT sessions with credentials — adapter keeps Account/Session tables available
  // if OAuth is added later. Credentials login does not require database sessions.
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          const user = await prisma.user.findUnique({
            where: { email: credentials.email.toLowerCase().trim() },
          });

          if (!user || !user.passwordHash) return null;

          const valid = await compare(credentials.password, user.passwordHash);
          if (!valid) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          };
        } catch (e) {
          console.error("Credentials authorize database error", {
            prismaCode:
              e && typeof e === "object" && "code" in e
                ? String((e as { code: unknown }).code)
                : undefined,
          });
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role || "USER";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
};

export type RegisterResult =
  | { id: string; email: string }
  | {
      error: string;
      code:
        | "INVALID_INPUT"
        | "EMAIL_ALREADY_EXISTS"
        | "DATABASE_NOT_CONFIGURED"
        | "DATABASE_ERROR"
        | "AUTH_CONFIGURATION_ERROR"
        | "REGISTRATION_FAILED";
      stage?: string;
      prismaCode?: string;
    };

export async function registerUser(
  email: string,
  password: string,
  name?: string
): Promise<RegisterResult> {
  const normalized = email.toLowerCase().trim();
  if (!normalized || !password || password.length < 8) {
    return {
      error: "Invalid email or password (min 8 characters)",
      code: "INVALID_INPUT",
      stage: "validate",
    };
  }

  if (!process.env.DATABASE_URL?.trim()) {
    return {
      error: "Database is not configured. Set DATABASE_URL in Production.",
      code: "DATABASE_NOT_CONFIGURED",
      stage: "env",
    };
  }

  let stage = "duplicate_check";
  try {
    const existing = await prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    if (existing) {
      return {
        error: "Email already registered",
        code: "EMAIL_ALREADY_EXISTS",
        stage,
      };
    }

    stage = "hash_password";
    const passwordHash = await hash(password, 12);

    stage = "create_user";
    const user = await prisma.user.create({
      data: {
        email: normalized,
        name: name?.trim() || null,
        passwordHash,
        role: "USER",
      },
    });

    // Credits / balance — best-effort after user exists so login still works
    stage = "welcome_credits";
    try {
      await ensureBalanceRecord(user.id);
      await grantCredits(
        user.id,
        PLANS.FREE.includedCredits,
        CreditTransactionType.BONUS,
        "Welcome credits (Free plan)"
      );
    } catch (creditErr) {
      console.error("Welcome credits failed after user create", {
        userId: user.id,
        prismaCode:
          creditErr && typeof creditErr === "object" && "code" in creditErr
            ? String((creditErr as { code: unknown }).code)
            : undefined,
      });
    }

    stage = "free_subscription";
    try {
      let freePlan = await prisma.plan.findUnique({ where: { tier: "FREE" } });
      if (!freePlan) {
        freePlan = await prisma.plan.create({
          data: {
            tier: "FREE",
            name: PLANS.FREE.name,
            description: PLANS.FREE.description,
            monthlyPriceCents: PLANS.FREE.monthlyPriceCents,
            yearlyPriceCents: PLANS.FREE.yearlyPriceCents ?? null,
            includedCredits: PLANS.FREE.includedCredits,
            maxRequestsPerMinute: PLANS.FREE.maxRequestsPerMinute,
            maxRequestsPerDay: PLANS.FREE.maxRequestsPerDay,
            maxInputTokens: PLANS.FREE.maxInputTokens,
            maxOutputTokens: PLANS.FREE.maxOutputTokens,
            allowedModels: [...PLANS.FREE.allowedModels],
            features: PLANS.FREE.features,
            isActive: true,
          },
        });
      }
      await prisma.subscription.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          planId: freePlan.id,
          status: "ACTIVE",
        },
        update: {
          planId: freePlan.id,
          status: "ACTIVE",
        },
      });
    } catch (subErr) {
      console.error("Free plan subscription failed after user create", {
        userId: user.id,
        prismaCode:
          subErr && typeof subErr === "object" && "code" in subErr
            ? String((subErr as { code: unknown }).code)
            : undefined,
      });
    }

    return { id: user.id, email: user.email };
  } catch (e) {
    const mapped = mapPrismaAuthError(e);
    console.error("registerUser failed", {
      stage,
      code: mapped.code,
      prismaCode: mapped.prismaCode,
    });
    return {
      error:
        mapped.code === "EMAIL_ALREADY_EXISTS"
          ? "Email already registered"
          : mapped.code === "DATABASE_ERROR"
            ? "Database is temporarily unavailable. Please try again later."
            : "Registration failed. Please try again.",
      code: mapped.code,
      stage,
      prismaCode: mapped.prismaCode,
    };
  }
}
