import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runChat, isLive } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function rateLimit(ip: string): { ok: true } | { ok: false; resetAt: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }
  if (bucket.count >= RATE_LIMIT_MAX) return { ok: false, resetAt: bucket.resetAt };
  bucket.count++;
  return { ok: true };
}

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8000),
});

const ChatRequestSchema = z.object({
  history: z.array(ChatMessageSchema).max(20).default([]),
  message: z.string().min(1).max(8000),
});

export async function POST(req: NextRequest) {
  const correlationId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Per-IP rate limit (Anthropic spend protection)
  const ip = getClientIp(req);
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", code: "rate_limited", correlationId },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  // Body size cap (64KB)
  const cl = req.headers.get("content-length");
  if (cl && Number(cl) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "invalid_input", code: "invalid_input", message: "request body too large", correlationId },
      { status: 413 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    if (e instanceof SyntaxError) {
      return NextResponse.json(
        { error: "invalid_input", code: "invalid_input", message: "invalid JSON", correlationId },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "invalid_input", code: "invalid_input", correlationId },
      { status: 400 },
    );
  }

  const parse = ChatRequestSchema.safeParse(raw);
  if (!parse.success) {
    return NextResponse.json(
      { error: "invalid_input", code: "invalid_input", message: parse.error.message, correlationId },
      { status: 400 },
    );
  }

  // Defence against forged tool-decision injection: strip assistant turns from
  // history; the model regenerates them each call. Only user turns persist.
  const safeHistory = parse.data.history
    .filter((m) => m.role === "user")
    .map((m, i) => ({
      id: `hist_${i}`,
      role: m.role,
      content: m.content,
      timestamp: new Date().toISOString(),
    }));

  try {
    const result = await runChat(safeHistory, parse.data.message, correlationId);
    return NextResponse.json({
      content: result.content,
      toolCalls: result.toolCalls,
      iterations: result.iterations,
      modelUsed: result.modelUsed,
      correlationId,
    });
  } catch (e: unknown) {
    console.error("[chat]", correlationId, e);
    return NextResponse.json(
      { error: "internal_error", code: "internal_error", correlationId },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ live: isLive() });
}
