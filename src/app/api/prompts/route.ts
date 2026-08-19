import { NextResponse } from "next/server";
import { PROMPT_LIBRARY } from "@/lib/prompts/library";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({
    prompts: PROMPT_LIBRARY.map(({ id, title, description, category, tags, template }) => ({
      id,
      title,
      description,
      category,
      tags,
      template,
    })),
    count: PROMPT_LIBRARY.length,
  });
}
