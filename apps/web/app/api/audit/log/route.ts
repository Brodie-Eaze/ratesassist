/**
 * GET /api/audit/log
 *
 * Returns recent audit-log entries for the caller's tenant. Supervisor-and-
 * above only — gated by the `read.audit_log` permission.
 *
 * Auth flow:
 *   1. Middleware has already verified the session and forwarded it via
 *      the `x-session` header.
 *   2. We pull the session from that header (no re-verification).
 *   3. RBAC: requires `read.audit_log` (rates_supervisor / council_admin /
 *      platform_admin). Anything less → 403.
 *   4. Cross-tenant read: blocked unless the caller is platform_admin.
 *
 * The handler reads from the in-memory ring buffer in adapter-demo via
 * the `list_audit_log` tool. Production deployments switch the underlying
 * source to Postgres (RA_USE_DB=true) without changing this surface.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  fail,
  maybeNotModified,
  ok,
  readPageParams,
  weakEtag,
} from "@/lib/api-helpers";
import {
  getSessionFromRequest,
  hasPermission,
} from "@/lib/auth";
import { scoped } from "@/lib/logger";
import { getClientIp, rateLimitComposite, retryAfterSeconds } from "@/lib/rate-limit";
import { runTool } from "@/lib/tools";
import { correlationIdFromHeaders } from "@/lib/correlation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = correlationIdFromHeaders(req.headers);
  const log = scoped("api/audit/log", { correlationId });

  const session = getSessionFromRequest(req);
  if (!session) {
    return fail("unauthorized", "session required", 401);
  }
  const ip = getClientIp(req);
  const rl = rateLimitComposite({ scope: "audit-log", ip, tenantId: session.tenantId, max: 30 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } }
    );
  }
  if (!hasPermission(session, "read.audit_log")) {
    log.warn({
      msg: "audit.log.forbidden",
      userId: session.userId,
      roles: session.roles,
    });
    return fail("forbidden", "read.audit_log permission required", 403);
  }

  // Tenant scoping — query param can override only for platform_admin.
  const url = new URL(req.url);
  const requestedTenant = url.searchParams.get("tenantId") ?? undefined;
  const isPlatformAdmin = session.roles.includes("platform_admin");
  const tenantId =
    requestedTenant !== undefined && requestedTenant !== session.tenantId
      ? isPlatformAdmin
        ? requestedTenant
        : (() => {
            log.warn({
              msg: "audit.log.cross_tenant_blocked",
              userId: session.userId,
              sessionTenant: session.tenantId,
              requestedTenant,
            });
            return null;
          })()
      : session.tenantId;
  if (tenantId === null) {
    return fail("forbidden", "cross-tenant read requires platform_admin", 403);
  }

  // Audit log uses a flat limit (newest-first). readPageParams clamps to
  // the package-wide cap; the contract schema clamps again at 500.
  const { limit: rawLimit } = readPageParams(url);
  const limit = Math.min(rawLimit, 500);
  const since = url.searchParams.get("since") ?? undefined;

  const userAgent = req.headers.get("user-agent") ?? undefined;

  const result = await runTool(
    "list_audit_log",
    {
      tenantId,
      limit,
      ...(since !== undefined ? { since } : {}),
    },
    correlationId,
    {
      tenantId: session.tenantId,
      actorId: session.userId,
      actorKind: "user",
      ip,
      ...(userAgent !== undefined ? { userAgent } : {}),
    },
  );

  if (!result.ok) {
    return fail(
      (result.code as "invalid_input" | "forbidden" | "internal_error") ??
        "internal_error",
      result.error ?? "audit log read failed",
    );
  }

  const data = (result.data ?? { entries: [], tenantId }) as {
    tenantId: string;
    entries: ReadonlyArray<unknown>;
  };

  // ETag based on the (tenant, count, latest-id) tuple — cheap and stable
  // enough for the supervisor dashboard's polling cadence.
  const etag = weakEtag({
    tenantId: data.tenantId,
    count: data.entries.length,
    latestId:
      data.entries.length > 0
        ? (data.entries[0] as { id?: string }).id
        : null,
  });
  const not = maybeNotModified(req, etag);
  if (not) return not;

  return ok({ entries: data.entries }, { headers: { etag } });
}
