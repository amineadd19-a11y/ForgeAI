import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calculateCost, deductCredits, getBalance } from "@/lib/credits";
import { generateRequestId } from "@/lib/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  type: z.enum(["image", "video"]),
  prompt: z.string().min(10).max(20_000),
  imageUrl: z.string().url().optional(),
});

function falError(payload: unknown) {
  if (payload && typeof payload === "object" && "detail" in payload) return String((payload as { detail: unknown }).detail);
  if (payload && typeof payload === "object" && "error" in payload) return String((payload as { error: unknown }).error);
  return "Media generation failed";
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.FAL_KEY) return NextResponse.json({ error: "Media generation is not configured. Add FAL_KEY to the server environment." }, { status: 503 });

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid media request" }, { status: 400 });

  const cost = parsed.data.type === "image" ? calculateCost("generate", "standard") : Math.max(calculateCost("generate", "advanced") * 3, 12);
  const balance = await getBalance(user.id);
  if (balance < cost) return NextResponse.json({ error: `This ${parsed.data.type} generation costs ${cost} credits. You have ${balance}.` }, { status: 402 });

  const endpoint = parsed.data.type === "image" ? "fal-ai/flux/schnell" : "fal-ai/kling-video/v2/master/image-to-video";
  const input = parsed.data.type === "image"
    ? { prompt: parsed.data.prompt, image_size: "landscape_16_9", num_images: 1, output_format: "jpeg", enable_safety_checker: true }
    : { prompt: parsed.data.prompt, image_url: parsed.data.imageUrl };

  if (parsed.data.type === "video" && !parsed.data.imageUrl) {
    return NextResponse.json({ error: "Video generation requires a rendered scene image first." }, { status: 400 });
  }

  const requestId = generateRequestId();
  await prisma.aiRequest.create({ data: { userId: user.id, requestId, provider: "fal", model: endpoint, status: "PENDING", creditsCharged: 0 } });

  try {
    const response = await fetch(`https://fal.run/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(parsed.data.type === "video" ? 120_000 : 60_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(falError(payload));

    const mediaUrl = parsed.data.type === "image"
      ? (payload?.images?.[0]?.url as string | undefined)
      : ((payload?.video?.url || payload?.video_url) as string | undefined);
    if (!mediaUrl) throw new Error("Provider returned no media URL");

    const charge = await deductCredits(user.id, cost, `Movie Studio ${parsed.data.type}`, requestId);
    await prisma.aiRequest.update({ where: { requestId }, data: { status: "SUCCESS", creditsCharged: charge.success ? cost : 0, completedAt: new Date(), metadata: { endpoint, mediaUrl } } });
    return NextResponse.json({ requestId, type: parsed.data.type, url: mediaUrl, usage: { credits: charge.success ? cost : 0, remaining: charge.balanceAfter } });
  } catch (error) {
    await prisma.aiRequest.update({ where: { requestId }, data: { status: "FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Media generation failed", completedAt: new Date() } });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Media generation failed", requestId }, { status: 502 });
  }
}
