import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAiGateway } from "@/lib/ai/gateway";
import { calculateCost, deductCredits, getBalance } from "@/lib/credits";
import { prisma } from "@/lib/db";
import { generateRequestId } from "@/lib/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicAiError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (lower.includes("api key") || lower.includes("unauthorized") || lower.includes("authentication")) return { code: "AI_NOT_CONFIGURED", message: "Movie Studio AI is not configured on the server. Please configure the AI provider key in Production." };
  if (lower.includes("rate limit") || lower.includes("429")) return { code: "AI_RATE_LIMITED", message: "The AI provider is temporarily rate-limited. Please try again in a moment." };
  if (lower.includes("timeout") || lower.includes("timed out")) return { code: "AI_TIMEOUT", message: "Movie Studio AI timed out. Please try the scene again." };
  return { code: "AI_GENERATION_FAILED", message: "Movie Studio could not generate this production package. No credits were charged. Please try again." };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 401 });

  let input: unknown;
  try { input = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON request" }, { status: 400 }); }
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const script = typeof body.script === "string" ? body.script.trim() : "";
  const format = typeof body.format === "string" && body.format.trim() ? body.format.trim() : "Short Film";
  const style = typeof body.style === "string" && body.style.trim() ? body.style.trim() : "Cinematic";
  if (script.length < 20) return NextResponse.json({ error: "Please enter at least 20 characters of screenplay text.", code: "INVALID_SCREENPLAY" }, { status: 400 });
  if (script.length > 100_000) return NextResponse.json({ error: "Screenplay is too long. Maximum is 100,000 characters.", code: "SCREENPLAY_TOO_LONG" }, { status: 400 });

  const cost = calculateCost("generate", "advanced");
  const balance = await getBalance(user.id);
  if (balance < cost) return NextResponse.json({ error: `This film transformation costs ${cost} credits. You have ${balance}.` }, { status: 402 });

  const requestId = generateRequestId();
  const prompt = `You are ForgeAI Movie Studio: an expert screenwriter, director, cinematographer, storyboard artist, sound designer and AI-video prompt engineer. Transform the supplied screenplay into a coherent film production package. Preserve the source story, characters, chronology and dialogue intent. Never invent important facts that contradict the source.\n\nOUTPUT JSON with these keys exactly: title, logline, characters, scenes, imagePrompts, videoPrompts, soundDesign, editingPlan, productionChecklist.\nEach scene must contain: sceneNumber, slugline, durationSeconds, action, dialogue, emotion, visualContinuity, shots. Each shot must contain shotType, framing, cameraMovement, lens, lighting, prompt. imagePrompts and videoPrompts must be an array with one item per scene. Keep character appearance descriptions consistent across every scene. Video prompts should describe motion, camera movement and environment and be suitable for downstream AI video generation. Do not claim to have rendered a video.\n\nFORMAT: ${format}\nVISUAL STYLE: ${style}\n\nSCREENPLAY:\n${script}`;

  await prisma.aiRequest.create({ data: { userId: user.id, requestId, provider: process.env.AI_PROVIDER || "openai", model: process.env.AI_MODEL || "gpt-4o-mini", status: "PENDING", creditsCharged: 0 } });
  try {
    const result = await getAiGateway().generate({ prompt, model: process.env.AI_MODEL || "gpt-4o-mini", maxTokens: 12000, operation: "generate", complexity: "advanced" });
    const charge = await deductCredits(user.id, cost, "AI Movie Studio", requestId);
    await prisma.aiRequest.update({ where: { requestId }, data: { status: "SUCCESS", inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, creditsCharged: charge.success ? cost : 0, completedAt: new Date(), metadata: { provider: result.provider, finishReason: result.finishReason } } });
    return NextResponse.json({ requestId, film: result.content, usage: { credits: charge.success ? cost : 0, remaining: charge.balanceAfter } });
  } catch (error) {
    await prisma.aiRequest.update({ where: { requestId }, data: { status: "FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Generation failed", completedAt: new Date() } });
    const safe = publicAiError(error);
    console.error("Movie Studio generation failed", { requestId, code: safe.code, provider: process.env.AI_PROVIDER || "openai" });
    return NextResponse.json({ error: safe.message, code: safe.code, requestId, creditsCharged: 0 }, { status: 502 });
  }
}
