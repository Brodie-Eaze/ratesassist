import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runChat, isLive } from "@/lib/llm";
import {
  exceedsBodyCap,
  getClientIp,
  rateLimit,
  retryAfterSeconds,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 20;

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

  const rl = rateLimit(getClientIp(req), RATE_LIMIT_MAX);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", code: "rate_limited", correlationId },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } },
    );
  }

  if (exceedsBodyCap(req)) {
    return NextResponse.json(
      { error: "invalid_input", code: "invalid_input", message: "request body too large", correlationId },
      { status: 413 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    const message = e instanceof SyntaxError ? "invalid JSON" : undefined;
    return NextResponse.json(
      { error: "invalid_input", code: "invalid_input", ...(message ? { message } : {}), correlationId },
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

  // Strip assistant turns from history; the model regenerates them each call.
  // Defends against forged tool-decision injection.
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
