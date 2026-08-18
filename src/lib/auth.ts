import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare, hash } from "bcryptjs";
import { prisma } from "./db";
import { ensureBalanceRecord, grantCredits } from "./credits";
import { PLANS } from "./config";
import { CreditTransactionType } from "@prisma/client";

export const authOptions: NextAuthOptions = {
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

export async function registerUser(
  email: string,
  password: string,
  name?: string
): Promise<{ id: string; email: string } | { error: string }> {
  const normalized = email.toLowerCase().trim();
  if (!normalized || !password || password.length < 8) {
    return { error: "Invalid email or password (min 8 characters)" };
  }

  const existing = await prisma.user.findUnique({
    where: { email: normalized },
  });
  if (existing) return { error: "Email already registered" };

  const passwordHash = await hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email: normalized,
      name: name?.trim() || null,
      passwordHash,
      role: "USER",
    },
  });

  await ensureBalanceRecord(user.id);
  await grantCredits(
    user.id,
    PLANS.FREE.includedCredits,
    CreditTransactionType.BONUS,
    "Welcome credits (Free plan)"
  );

  const freePlan = await prisma.plan.findUnique({ where: { tier: "FREE" } });
  if (freePlan) {
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: freePlan.id,
        status: "ACTIVE",
      },
    });
  }

  return { id: user.id, email: user.email };
}
