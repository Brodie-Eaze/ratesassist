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
import { captureTenantOverrideRefused } from "@/lib/sentry";

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
 *
 * **iter3 expansion:** the council pen-test re-check surfaced that the
 * original allowlist missed `council` (the actual schema name used by
 * `list_overdue`, `list_properties`, `find_mining_mismatches`,
 * `recovery_summary`, `daily_briefing`, `draft_chase_all_overdue`) and
 * `code` (`add_council`). Six of the highest-value tools were
 * exfiltratable via `{"input":{"council":"<other>"}}` while attribution
 * forced from session masked the cross-tenant read as the caller's own
 * — invisible exfil. Both keys now refused; their fully-qualified
 * snake/camel variants too in case future schemas use them.
 */
const TENANT_OVERRIDE_KEYS: ReadonlyArray<string> = [
  "tenantId",
  "tenant_id",
  "tenant",
  "councilCode",
  "council_code",
  // F-001 iter3: actual schema key for council-scoped reads.
  "council",
  // F-001 iter3: `add_council` uses `code` as the tenant identifier.
  "code",
];

const TENANT_OVERRIDE_KEY_SET: ReadonlySet<string> = new Set(TENANT_OVERRIDE_KEYS);

/**
 * Walk an arbitrary tool-input value tree looking for a tenant-
 * identifying key whose value diverges from the caller's session
 * tenant. Returns the JSON-Pointer-style path to the first violation,
 * or `null` if no override was found.
 *
 * The walk descends into plain objects and arrays only; primitives,
 * functions, and class instances are skipped. Cycle protection via a
 * visited-set guards against an attacker crafting a self-referential
 * input via `JSON.parse(reviver)` — pathologically rare but cheap to
 * defend against.
 *
 * Why recursive: pen-test F-001 + silent-failure-hunter both flagged
 * that the original flat-key scrub missed `{filter:{tenantId:"KAL"}}`.
 * No tool reads nested tenant keys today, but `.strict()` is not
 * applied on every schema in the contract package, so a future tool
 * could accept the field unintentionally. The recursive walk is
 * defence-in-depth at the dispatcher edge.
 */
function findTenantOverrideInTree(
  value: unknown,
  callerTenant: string,
  pathParts: ReadonlyArray<string> = [],
  visited: WeakSet<object> = new WeakSet(),
): { readonly path: string; readonly value: unknown } | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return null;
  if (visited.has(value as object)) return null;
  visited.add(value as object);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const v = findTenantOverrideInTree(
        value[i],
        callerTenant,
        [...pathParts, String(i)],
        visited,
      );
      if (v !== null) return v;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (TENANT_OVERRIDE_KEY_SET.has(key)) {
      if (typeof child === "string" && child !== callerTenant) {
        return { path: [...pathParts, key].join("."), value: child };
      }
    }
    const v = findTenantOverrideInTree(
      child,
      callerTenant,
      [...pathParts, key],
      visited,
    );
    if (v !== null) return v;
  }
  return null;
}

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
      // RAW, pre-validation candidate — the object the caller actually sent.
      // The cross-tenant scrub below MUST inspect this, NOT the post-Zod
      // `validatedInput`: Zod's default `.object()` strips unknown keys, so a
      // foreign `{tenantId:"KAL"}` would be silently dropped before the scrub
      // ever saw it — no 403, no audit event. The scope-forcing in `runTool`
      // would still mask the data (the read falls back to the caller's own
      // tenant), but the *attempt* would go unrecorded, defeating the
      // documented "explicit denial in the audit log" intent.
      const rawCandidate: unknown = body.input ?? body ?? {};
      let validatedInput: Record<string, unknown>;
      if (schema) {
        const parse = schema.safeParse(rawCandidate);
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
      //
      // ship-ready iter3: silent-failure-hunter surfaced that the
      // previous flat `k in input` walk only inspected TOP-LEVEL
      // keys. A payload like `{filter:{tenantId:"KAL"}}` would sail
      // through. None of the tool schemas read nested tenant keys
      // TODAY but the defence-in-depth answer is to walk the whole
      // tree. `findTenantOverrideInTree` returns the first violating
      // path (`"filter.tenantId"`) for a precise refusal message.
      const isPlatformAdmin = session.roles.includes("platform_admin");
      if (!isPlatformAdmin) {
        const violation = findTenantOverrideInTree(
          rawCandidate,
          session.tenantId,
        );
        if (violation !== null) {
          log.warn({
            msg: "tool.tenant_override_refused",
            actorId: session.userId,
            sessionTenant: session.tenantId,
            attemptedPath: violation.path,
            attemptedValue: String(violation.value),
          });
          // Audit-grade signal — pages the on-call via Sentry alert
          // rule #2. No-op when SENTRY_DSN is unset.
          captureTenantOverrideRefused({
            actorId: session.userId,
            sessionTenant: session.tenantId,
            attemptedPath: violation.path,
            attemptedValue: String(violation.value),
          });
          return NextResponse.json(
            {
              ok: false,
              code: "forbidden",
              message: `tenant override via input.${violation.path} is not permitted`,
            },
            { status: 403 },
          );
        }
      }

      try {
        // SECURITY (cross-tenant IDOR fix): pass the caller's tenant + roles
        // as the SCOPE (5th arg), not just the attribution (4th arg). Without
        // the scope, `runTool` skips `applyToolScope` entirely, so the
        // per-tool policy table (assessmentGuard/ownerGuard/council-injection +
        // RBAC) never runs. The `findTenantOverrideInTree` scrub above only
        // blocks the explicit tenant keys (tenantId/council/code); it does NOT
        // cover identifiers that ENCODE the tenant by prefix
        // (assessmentNumber/ownerId/parentAssessmentNumber). Passing the scope
        // routes this generic dispatcher through the exact same chokepoint the
        // chat surface uses, closing the read-IDOR, draft-write-IDOR,
        // commit-mutation-IDOR, and the RBAC-bypass class in one change.
        const result = await runTool(
          name,
          validatedInput,
          correlationId,
          {
            tenantId: session.tenantId,
            actorId: session.userId,
            actorKind: "user",
            ip,
            userAgent: req.headers.get("user-agent") ?? undefined,
          },
          { tenantId: session.tenantId, roles: session.roles },
        );
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
