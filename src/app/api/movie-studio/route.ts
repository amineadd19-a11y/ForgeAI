import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getAiGateway } from "@/lib/ai/gateway";
import { calculateCost, deductCredits, getBalance } from "@/lib/credits";
import { prisma } from "@/lib/db";
import { generateRequestId } from "@/lib/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  script: z.string().min(20).max(100_000),
  format: z.string().min(1).max(50),
  style: z.string().min(1).max(80),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 401 });

  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid screenplay input" }, { status: 400 });

  const cost = calculateCost("generate", "advanced");
  const balance = await getBalance(user.id);
  if (balance < cost) return NextResponse.json({ error: `This film transformation costs ${cost} credits. You have ${balance}.` }, { status: 402 });

  const requestId = generateRequestId();
  const prompt = `You are ForgeAI Movie Studio: an expert screenwriter, director, cinematographer, storyboard artist, sound designer and AI-video prompt engineer. Transform the supplied screenplay into a coherent film production package. Preserve the source story, characters, chronology and dialogue intent. Never invent important facts that contradict the source.

OUTPUT JSON with these keys exactly: title, logline, characters, scenes, imagePrompts, videoPrompts, soundDesign, editingPlan, productionChecklist.
Each scene must contain: sceneNumber, slugline, durationSeconds, action, dialogue, emotion, visualContinuity, shots. Each shot must contain shotType, framing, cameraMovement, lens, lighting, prompt. imagePrompts and videoPrompts must be an array with one item per scene. Keep character appearance descriptions consistent across every scene. Video prompts should describe motion, camera movement and environment and be suitable for downstream AI video generation. Do not claim to have rendered a video.

FORMAT: ${body.data.format}
VISUAL STYLE: ${body.data.style}

SCREENPLAY:
${body.data.script}`;

  await prisma.aiRequest.create({ data: { userId: user.id, requestId, provider: process.env.AI_PROVIDER || "openai", model: process.env.AI_MODEL || "gpt-4o-mini", status: "PENDING", creditsCharged: 0 } });

  try {
    const result = await getAiGateway().generate({ prompt, model: process.env.AI_MODEL || "gpt-4o-mini", maxTokens: 12000, operation: "generate", complexity: "advanced" });
    const charge = await deductCredits(user.id, cost, "AI Movie Studio", requestId);
    await prisma.aiRequest.update({ where: { requestId }, data: { status: "SUCCESS", inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, creditsCharged: charge.success ? cost : 0, completedAt: new Date(), metadata: { provider: result.provider, finishReason: result.finishReason } } });
    return NextResponse.json({ requestId, film: result.content, usage: { credits: charge.success ? cost : 0, remaining: charge.balanceAfter } });
  } catch (error) {
    await prisma.aiRequest.update({ where: { requestId }, data: { status: "FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Generation failed", completedAt: new Date() } });
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI generation failed", requestId }, { status: 502 });
  }
}
