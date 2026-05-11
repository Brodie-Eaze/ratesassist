/**
 * GET /api/audit/verify-chain
 *
 * Verifies the tamper-evident hash chain over the caller's tenant audit log.
 * Supervisor-and-above only — gated by `read.audit_log`. Cross-tenant
 * verification (?tenantId=...) requires platform_admin.
 *
 * Calls the `verify_audit_chain` MCP tool which walks rows in chain order
 * and recomputes each rowHash. See packages/adapter-demo/src/audit/hashChain.ts
 * for the algorithm.
 */

import { NextRequest, NextResponse } from "next/server";

import { fail, maybeNotModified, ok, weakEtag } from "@/lib/api-helpers";
import { getSessionFromRequest, hasPermission } from "@/lib/auth";
import { scoped } from "@/lib/logger";
import { getClientIp } from "@/lib/rate-limit";
import { runTool } from "@/lib/tools";
import { correlationIdFromHeaders } from "@/lib/correlation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = correlationIdFromHeaders(req.headers);
  const log = scoped("api/audit/verify-chain", { correlationId });

  const session = getSessionFromRequest(req);
  if (!session) return fail("unauthorized", "session required", 401);
  if (!hasPermission(session, "read.audit_log")) {
    log.warn({ msg: "audit.verify.forbidden", userId: session.userId });
    return fail("forbidden", "read.audit_log permission required", 403);
  }

  const url = new URL(req.url);
  const requestedTenant = url.searchParams.get("tenantId") ?? undefined;
  const isPlatformAdmin = session.roles.includes("platform_admin");
  let tenantId: string | null = session.tenantId;
  if (requestedTenant !== undefined && requestedTenant !== session.tenantId) {
    if (!isPlatformAdmin) {
      log.warn({
        msg: "audit.verify.cross_tenant_blocked",
        userId: session.userId,
      });
      return fail("forbidden", "cross-tenant read requires platform_admin", 403);
    }
    tenantId = requestedTenant;
  }

  const limitRaw = url.searchParams.get("limit");
  const limit = Math.max(1, Math.min(10_000, Number(limitRaw ?? 1000) || 1000));

  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") ?? undefined;

  const result = await runTool(
    "verify_audit_chain",
    { tenantId, limit },
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
      result.error ?? "verify-chain failed",
    );
  }

  const data = (result.data ?? {
    tenantId,
    verified: 0,
    allOk: true,
  }) as Record<string, unknown>;

  const etag = weakEtag(data);
  const not = maybeNotModified(req, etag);
  if (not) return not;

  return ok(data, { headers: { etag } });
}
