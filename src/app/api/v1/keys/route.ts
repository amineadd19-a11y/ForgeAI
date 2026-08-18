import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createApiKey,
  listUserApiKeys,
} from "@/lib/api-keys";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
      { status: 401 }
    );
  }

  const keys = await listUserApiKeys(session.user.id);
  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
      { status: 401 }
    );
  }

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: e instanceof z.ZodError ? e.errors : "Invalid body",
        },
      },
      { status: 400 }
    );
  }

  const activeCount = await prisma.apiKey.count({
    where: { userId: session.user.id, isActive: true },
  });
  if (activeCount >= 20) {
    return NextResponse.json(
      {
        error: {
          code: "LIMIT_EXCEEDED",
          message: "Maximum 20 active API keys per account",
        },
      },
      { status: 400 }
    );
  }

  const created = await createApiKey(session.user.id, body.name);

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "api_key.created",
      resource: "api_key",
      resourceId: created.id,
      metadata: { name: body.name, prefix: created.prefix },
    },
  });

  return NextResponse.json(
    {
      id: created.id,
      name: created.name,
      key: created.key,
      prefix: created.prefix,
      message: "Store this key securely. It will not be shown again.",
    },
    { status: 201 }
  );
}
