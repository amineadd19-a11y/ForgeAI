import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { registerUser } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const result = await registerUser(body.email, body.password, body.name);
    if ("error" in result) {
      return NextResponse.json(
        { error: { code: "REGISTER_FAILED", message: result.error } },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { id: result.id, email: result.email, message: "Account created" },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: e.errors } },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Registration failed" } },
      { status: 500 }
    );
  }
}
