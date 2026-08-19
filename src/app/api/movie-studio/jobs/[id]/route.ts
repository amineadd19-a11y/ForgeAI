import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });

  const workerUrl = process.env.VIDEO_WORKER_URL?.replace(/\/$/, "");
  if (!workerUrl) return NextResponse.json({ error: "Video worker is not configured", code: "VIDEO_WORKER_NOT_CONFIGURED" }, { status: 503 });

  const { id } = await params;
  try {
    const headers: Record<string, string> = {};
    if (process.env.VIDEO_WORKER_TOKEN) headers.authorization = `Bearer ${process.env.VIDEO_WORKER_TOKEN}`;
    const response = await fetch(`${workerUrl}/jobs/${encodeURIComponent(id)}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null);
    return NextResponse.json(payload ?? { error: "Invalid worker response" }, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to read video job", code: "VIDEO_WORKER_UNAVAILABLE" }, { status: 503 });
  }
}
