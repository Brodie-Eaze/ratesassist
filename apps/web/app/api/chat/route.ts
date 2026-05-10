import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runChat, isLive } from "@/lib/llm";
import {
  exceedsBodyCap,
  getClientIp,
  rateLimit,
  retryAfterSeconds,
} from "@/lib/rate-limit";
import { scoped } from "@/lib/logger";
import {
  correlationIdFromHeaders,
  runWithCorrelation,
} from "@/lib/correlation";

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const correlationId = correlationIdFromHeaders(req.headers);
  const log = scoped("api/chat", { correlationId });
  const ip = getClientIp(req);

  return runWithCorrelation(
    {
      correlationId,
      route: "/api/chat",
      method: "POST",
      ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
    },
    async () => {
      const start = Date.now();
      log.info({ msg: "chat.request.start" });

      const rl = rateLimit(ip, RATE_LIMIT_MAX);
      if (!rl.ok) {
        log.warn({ msg: "chat.rate_limited" });
        return NextResponse.json(
          { error: "rate_limited", code: "rate_limited", correlationId },
          { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } },
        );
      }

      if (exceedsBodyCap(req)) {
        log.warn({ msg: "chat.body_too_large" });
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
        log.warn({ msg: "chat.invalid_json" });
        return NextResponse.json(
          { error: "invalid_input", code: "invalid_input", ...(message ? { message } : {}), correlationId },
          { status: 400 },
        );
      }

      const parse = ChatRequestSchema.safeParse(raw);
      if (!parse.success) {
        log.warn({ msg: "chat.invalid_input", issues: parse.error.issues.length });
        return NextResponse.json(
          { error: "invalid_input", code: "invalid_input", message: parse.error.message, correlationId },
          { status: 400 },
        );
      }

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
        const durationMs = Date.now() - start;
        log.info({
          msg: "chat.request.ok",
          durationMs,
          iterations: result.iterations,
          modelUsed: result.modelUsed,
          toolCalls: result.toolCalls?.length ?? 0,
        });
        return NextResponse.json({
          content: result.content,
          toolCalls: result.toolCalls,
          iterations: result.iterations,
          modelUsed: result.modelUsed,
          correlationId,
        });
      } catch (e: unknown) {
        const durationMs = Date.now() - start;
        log.error(
          { msg: "chat.request.threw", durationMs, err: e instanceof Error ? e.message : String(e) },
        );
        return NextResponse.json(
          { error: "internal_error", code: "internal_error", correlationId },
          { status: 500 },
        );
      }
    },
  ) as Promise<NextResponse>;
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ live: isLive() });
}
