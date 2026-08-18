import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revokeApiKey, rotateApiKey } from "@/lib/api-keys";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sign in required" } }, { status: 401 });
  }
  const { id } = await params;
  const ok = await revokeApiKey(session.user.id, id);
  if (!ok) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "API key not found" } }, { status: 404 });
  }
  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "api_key.revoked", resource: "api_key", resourceId: id },
  });
  return NextResponse.json({ revoked: true });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sign in required" } }, { status: 401 });
  }
  const { id } = await params;
  const result = await rotateApiKey(session.user.id, id);
  if (!result) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "API key not found" } }, { status: 404 });
  }
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "api_key.rotated",
      resource: "api_key",
      resourceId: result.id,
      metadata: { previousKeyId: id, prefix: result.prefix },
    },
  });
  return NextResponse.json({
    id: result.id,
    name: result.name,
    key: result.key,
    prefix: result.prefix,
    message: "Key rotated. Store the new key securely.",
  });
}
