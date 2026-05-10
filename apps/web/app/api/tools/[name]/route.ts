import { NextRequest, NextResponse } from "next/server";
import { runTool, isKnownTool } from "@/lib/tools";
import { schemas } from "@ratesassist/contract";
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

const RATE_LIMIT_MAX = 60;

type InputSchema = {
  safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } };
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await ctx.params;
  const correlationId = correlationIdFromHeaders(req.headers);
  const log = scoped("api/tools", { correlationId, tool: name });
  const ip = getClientIp(req);

  return runWithCorrelation(
    {
      correlationId,
      route: `/api/tools/${name}`,
      method: "POST",
      ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
    },
    async () => {
      const start = Date.now();
      log.info({ msg: "tool.request.start" });

      const rl = rateLimit(ip, RATE_LIMIT_MAX);
      if (!rl.ok) {
        log.warn({ msg: "tool.rate_limited" });
        return NextResponse.json(
          { ok: false, code: "rate_limited", message: "rate limit exceeded" },
          { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } },
        );
      }

      if (exceedsBodyCap(req)) {
        log.warn({ msg: "tool.body_too_large" });
        return NextResponse.json(
          { ok: false, code: "invalid_input", message: "request body too large" },
          { status: 413 },
        );
      }

      if (!isKnownTool(name)) {
        log.warn({ msg: "tool.unknown" });
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
          log.warn({ msg: "tool.invalid_input" });
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
        const durationMs = Date.now() - start;
        log.info({ msg: "tool.request.ok", durationMs, ok: (result as { ok?: boolean }).ok });
        return NextResponse.json(result);
      } catch (e: unknown) {
        const durationMs = Date.now() - start;
        log.error({
          msg: "tool.request.threw",
          durationMs,
          err: e instanceof Error ? e.message : String(e),
        });
        return NextResponse.json(
          { ok: false, code: "internal_error", error: "tool_error", correlationId },
          { status: 500 },
        );
      }
    },
  ) as Promise<NextResponse>;
}
