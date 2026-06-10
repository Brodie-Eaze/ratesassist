import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runChat, isLive } from "@/lib/llm";
import { resolveRouteSession } from "@/lib/api-helpers";
import {
  exceedsBodyCap,
  getClientIp,
  rateLimitComposite,
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

/**
 * AI-safety kill switch. Setting `RA_CHAT_KILL=1` disables the LLM/agent chat
 * surface instantly — no redeploy — returning 503 to callers. This is the
 * break-glass control for a prompt-injection incident, a runaway tool loop, a
 * model-provider outage, or a cost spike. The deterministic product surface
 * (properties, recovery audit, evidence packs, exports) is unaffected, so an
 * operator can pull the AI without taking the platform down.
 */
function isChatKilled(): boolean {
  return process.env["RA_CHAT_KILL"] === "1";
}

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

      // AI-safety kill switch (break-glass). Checked BEFORE any work so a
      // runaway loop, prompt-injection incident, provider outage, or cost
      // spike can be stopped instantly via env without a redeploy. The
      // deterministic product surface keeps serving — only the AI is pulled.
      if (isChatKilled()) {
        log.warn({ msg: "chat.kill_switch_active" });
        return NextResponse.json(
          {
            error: "chat_disabled",
            code: "chat_disabled",
            message:
              "The AI assistant is temporarily disabled. The rest of RatesAssist is unaffected.",
            correlationId,
          },
          { status: 503, headers: { "Retry-After": "120" } },
        );
      }

      // A6-NEW-04: session resolves BEFORE the limiter so the bucket keys on
      // (scope, tenantId, ip) — one council's burst can't starve another
      // tenant's chat on the same instance, and a single officer rotating
      // IPs still shares the tenant dimension. Sessionless requests are
      // rejected here (they would have been at the later check anyway).
      const session = await resolveRouteSession(req);
      if (session === null) {
        log.warn({ msg: "chat.no_session" });
        return NextResponse.json(
          { error: "unauthorized", code: "unauthorized", correlationId },
          { status: 401 },
        );
      }

      const rl = rateLimitComposite({
        scope: "chat",
        ip,
        tenantId: session.tenantId,
        max: RATE_LIMIT_MAX,
      });
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

      // Tenant + RBAC scope for the tool-dispatch loop — session was already
      // resolved (fail-closed) before the rate limiter above. Chat must never
      // dispatch tools without a scope (an unscoped session reads every
      // council's data).
      const scope = { tenantId: session.tenantId, roles: session.roles };

      const safeHistory = parse.data.history
        .filter((m) => m.role === "user")
        .map((m, i) => ({
          id: `hist_${i}`,
          role: m.role,
          content: m.content,
          timestamp: new Date().toISOString(),
        }));

      try {
        const result = await runChat(safeHistory, parse.data.message, correlationId, scope);
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
  return NextResponse.json({ live: isLive(), enabled: !isChatKilled() });
}
