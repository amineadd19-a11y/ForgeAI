import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { registerUser, type RegisterResult } from "@/lib/auth";
import { generateRequestId } from "@/lib/request-id";
import { checkDatabaseForAuth, isDatabaseUrlConfigured } from "@/lib/db-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  name: z.string().min(1).max(100).optional(),
});

function isRegisterError(
  result: RegisterResult
): result is Extract<RegisterResult, { error: string }> {
  return "error" in result;
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  let stage = "start";

  try {
    stage = "auth_config";
    if (!process.env.AUTH_SECRET?.trim() && !process.env.NEXTAUTH_SECRET?.trim()) {
      console.error("Registration AUTH_CONFIGURATION_ERROR", { requestId, stage });
      return NextResponse.json(
        {
          error: {
            code: "AUTH_CONFIGURATION_ERROR",
            message:
              "Authentication is not configured. Set AUTH_SECRET (or NEXTAUTH_SECRET) in Production.",
          },
          requestId,
        },
        { status: 503 }
      );
    }

    stage = "database_env";
    if (!isDatabaseUrlConfigured() && !process.env.DATABASE_URL?.trim()) {
      console.error("Registration DATABASE_NOT_CONFIGURED", { requestId, stage });
      return NextResponse.json(
        {
          error: {
            code: "DATABASE_NOT_CONFIGURED",
            message: "Database is not configured. Set DATABASE_URL in Production.",
          },
          requestId,
        },
        { status: 503 }
      );
    }

    stage = "database_check";
    const db = await checkDatabaseForAuth();
    if (!db.ok) {
      console.error("Registration database check failed", {
        requestId,
        stage: db.stage,
        code: db.code,
        prismaCode: db.prismaCode,
        detail: db.detail,
      });
      return NextResponse.json(
        {
          error: {
            code: db.code,
            message:
              db.code === "DATABASE_NOT_CONFIGURED"
                ? "Database is not configured. Set DATABASE_URL in Production."
                : "Database is temporarily unavailable. Please try again later.",
          },
          requestId,
          diagnostic: {
            stage: db.stage,
            prismaCode: db.prismaCode ?? null,
          },
        },
        { status: 503 }
      );
    }

    stage = "parse_body";
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json(
        {
          error: { code: "INVALID_INPUT", message: "Request body must be valid JSON" },
          requestId,
        },
        { status: 400 }
      );
    }

    stage = "validate";
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: first?.message || "Invalid email or password",
          },
          requestId,
        },
        { status: 400 }
      );
    }

    stage = "register_user";
    const result = await registerUser(
      parsed.data.email,
      parsed.data.password,
      parsed.data.name
    );

    if (isRegisterError(result)) {
      const status =
        result.code === "EMAIL_ALREADY_EXISTS"
          ? 409
          : result.code === "INVALID_INPUT"
            ? 400
            : result.code === "DATABASE_NOT_CONFIGURED" ||
                result.code === "DATABASE_ERROR" ||
                result.code === "AUTH_CONFIGURATION_ERROR"
              ? 503
              : 500;

      console.error("Registration business failure", {
        requestId,
        stage: result.stage ?? stage,
        code: result.code,
        prismaCode: result.prismaCode,
      });

      return NextResponse.json(
        {
          error: {
            code: result.code,
            message: result.error,
          },
          requestId,
          diagnostic: {
            stage: result.stage ?? stage,
            prismaCode: result.prismaCode ?? null,
          },
        },
        { status }
      );
    }

    console.info("Registration success", {
      requestId,
      userId: result.id,
      stage: "complete",
    });

    return NextResponse.json(
      {
        id: result.id,
        email: result.email,
        message: "Account created",
        requestId,
      },
      { status: 201 }
    );
  } catch (e) {
    console.error("Registration unhandled error", {
      requestId,
      stage,
      name: e instanceof Error ? e.name : "unknown",
      prismaCode:
        e && typeof e === "object" && "code" in e
          ? String((e as { code: unknown }).code)
          : undefined,
    });
    return NextResponse.json(
      {
        error: { code: "REGISTRATION_FAILED", message: "Registration failed. Please try again." },
        requestId,
      },
      { status: 500 }
    );
  }
}
