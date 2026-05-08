import { NextRequest, NextResponse } from "next/server";
import { runTool, isKnownTool } from "@/lib/tools";
import { schemas } from "@ratesassist/contract";
import {
  exceedsBodyCap,
  getClientIp,
  rateLimit,
  retryAfterSeconds,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 60;

type InputSchema = {
  safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } };
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const correlationId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const rl = rateLimit(getClientIp(req), RATE_LIMIT_MAX);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", message: "rate limit exceeded" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } },
    );
  }

  if (exceedsBodyCap(req)) {
    return NextResponse.json(
      { ok: false, code: "invalid_input", message: "request body too large" },
      { status: 413 },
    );
  }

  if (!isKnownTool(name)) {
    return NextResponse.json({ ok: false, code: "not_found", error: "unknown_tool" }, { status: 404 });
  }

  let body: { input?: unknown } = {};
  try {
    body = (await req.json()) as { input?: unknown };
  } catch {
    body = {};
  }

  const inputs = schemas.inputs as Record<string, InputSchema>;
  const schema = inputs[name];
  let validatedInput: Record<string, unknown>;
  if (schema) {
    const candidate = body.input ?? body ?? {};
    const parse = schema.safeParse(candidate);
    if (!parse.success) {
      return NextResponse.json(
        { ok: false, code: "invalid_input", message: parse.error?.message ?? "invalid input" },
        { status: 400 },
      );
    }
    validatedInput = (parse.data as Record<string, unknown>) ?? {};
  } else {
    validatedInput = (body.input as Record<string, unknown>) ?? (body as Record<string, unknown>) ?? {};
  }

  try {
    const result = await runTool(name, validatedInput);
    return NextResponse.json(result);
  } catch (e: unknown) {
    console.error("[tool]", correlationId, name, e);
    return NextResponse.json(
      { ok: false, code: "internal_error", error: "tool_error", correlationId },
      { status: 500 },
    );
  }
}
