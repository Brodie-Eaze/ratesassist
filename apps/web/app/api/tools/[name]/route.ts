import { NextRequest, NextResponse } from "next/server";
import { runTool, isKnownTool } from "@/lib/tools";
import { schemas } from "@ratesassist/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function rateLimit(ip: string, max: number): { ok: true } | { ok: false; resetAt: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }
  if (bucket.count >= max) return { ok: false, resetAt: bucket.resetAt };
  bucket.count++;
  return { ok: true };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const correlationId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Per-IP rate limit
  const ip = getClientIp(req);
  const rl = rateLimit(ip, RATE_LIMIT_MAX);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", message: "rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  // Body size cap (64KB)
  const cl = req.headers.get("content-length");
  if (cl && Number(cl) > MAX_BODY_BYTES) {
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

  // Look up Zod schema for this tool input
  const inputs = schemas.inputs as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } } }>;
  const schema = inputs[name];
  let validatedInput: Record<string, unknown> = {};
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
