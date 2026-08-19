import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateRequestId } from "@/lib/request-id";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sceneSchema = z.object({
  id: z.string().optional(),
  videoUrl: z.string().url(),
});

const schema = z.object({
  scenes: z.array(sceneSchema).min(1).max(200),
  projectId: z.string().max(200).optional(),
});

function workerHeaders() {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.VIDEO_WORKER_TOKEN) headers.authorization = `Bearer ${process.env.VIDEO_WORKER_TOKEN}`;
  return headers;
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED", requestId }, { status: 401 });
  }
  const workerUrl = process.env.VIDEO_WORKER_URL?.replace(/\/$/, "");
  if (!workerUrl) {
    return NextResponse.json({ error: "Video worker is not configured", code: "VIDEO_WORKER_NOT_CONFIGURED", requestId }, { status: 503 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid video job", code: "INVALID_REQUEST", requestId, details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const response = await fetch(`${workerUrl}/jobs`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ ...parsed.data, requestId }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || `Worker returned HTTP ${response.status}`);
    return NextResponse.json({ requestId, ...payload }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to queue video job", code: "VIDEO_WORKER_UNAVAILABLE", requestId }, { status: 503 });
  }
}
