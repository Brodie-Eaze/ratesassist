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
import { getSessionFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 60;

type InputSchema = {
  safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } };
};

/**
 * Tool input keys that, prior to this fix, could be set by an attacker
 * to **redirect a tool call to a different tenant** than the caller's
 * session. The MCP dispatcher used to forward `input` verbatim with no
 * attribution, so any signed-in clerk could do
 *
 *     POST /api/tools/list_audit_log {"input":{"tenantId":"<other>"}}
 *
 * and read another council's data (pen-test F-001 / F-002).
 *
 * The dispatcher now refuses any tool input that carries one of these
 * tenant-identifying keys unless the caller is a platform_admin. Tools
 * that legitimately scope to a tenant receive it via the `attribution`
 * field set below, not via the request body.
 */
const TENANT_OVERRIDE_KEYS: ReadonlyArray<string> = [
  "tenantId",
  "tenant",
  "councilCode",
  "council_code",
];

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

      // ---- Authentication (F-001 mitigation) -------------------------
      // Until this gate landed, the dispatcher served every signed-in
      // user (and every anonymous one when `RA_DEMO_AUTOLOGIN=1`) every
      // tool with NO RBAC and NO tenant attribution — the audit log
      // showed "demo-officer" while the actual mutation could span
      // tenants. We now require a verified session before any tool
      // body is even read.
      const session = await getSessionFromRequest(req);
      if (!session) {
        log.warn({ msg: "tool.unauthorized" });
        return NextResponse.json(
          { ok: false, code: "unauthorized", message: "session required" },
          { status: 401 },
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

      // ---- Cross-tenant input scrub (F-001 / F-002 mitigation) -------
      // A non-platform_admin caller cannot supply a tenant-identifying
      // key in their tool input. The tool runs against whatever tenant
      // the session resolves to via `attribution.tenantId` below; the
      // body is the wrong layer to carry it. If the caller did supply
      // one, we 403 — fail closed rather than silently rewrite, so the
      // attempt shows up as an explicit denial in the audit log.
      const isPlatformAdmin = session.roles.includes("platform_admin");
      if (!isPlatformAdmin) {
        for (const k of TENANT_OVERRIDE_KEYS) {
          if (k in validatedInput && validatedInput[k] !== session.tenantId) {
            log.warn({
              msg: "tool.tenant_override_refused",
              actorId: session.userId,
              sessionTenant: session.tenantId,
              attemptedKey: k,
              attemptedValue: String(validatedInput[k]),
            });
            return NextResponse.json(
              {
                ok: false,
                code: "forbidden",
                message: `tenant override via input.${k} is not permitted`,
              },
              { status: 403 },
            );
          }
        }
      }

      try {
        const result = await runTool(name, validatedInput, correlationId, {
          tenantId: session.tenantId,
          actorId: session.userId,
          actorKind: "user",
          ip,
          userAgent: req.headers.get("user-agent") ?? undefined,
        });
        const durationMs = Date.now() - start;
        log.info({
          msg: "tool.request.ok",
          durationMs,
          ok: (result as { ok?: boolean }).ok,
          actorId: session.userId,
          tenantId: session.tenantId,
        });
        return NextResponse.json(result);
      } catch (e: unknown) {
        const durationMs = Date.now() - start;
        log.error({
          msg: "tool.request.threw",
          durationMs,
          actorId: session.userId,
          tenantId: session.tenantId,
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
