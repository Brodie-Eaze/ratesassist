/**
 * GET /api/audit/verify-chain
 *
 * Walks the tamper-evident hash chain over the caller's tenant audit_log
 * rows and recomputes each row's hash via the shared
 * `@ratesassist/audit-core` canonicaliser. The chain is byte-identical to
 * what the in-memory demo store produces (one verifier, both stores).
 *
 * Tenancy:
 *   - Caller can only verify their OWN tenant unless they hold the
 *     `platform_admin` role. Tenant override via `?tenantId=…`.
 *   - RBAC: requires `read.audit_log` (rates_supervisor / council_admin /
 *     platform_admin).
 *
 * Response envelope:
 *   { ok: true,  data: { ok: true,  totalRows, latestTs, evictionTruncated } }
 *   { ok: true,  data: { ok: false, totalRows, latestTs, brokenAt, expectedHash, actualHash, evictionTruncated } }
 *
 * Outer `ok` is the HTTP envelope (still 200 on chain break — the request
 * succeeded; the chain didn't). Inner `data.ok` is the chain verdict.
 *
 * On a GENUINE break (full-scan, not eviction-truncated) the handler:
 *   1. Logs `audit.chain_break` at error level with the row context.
 *   2. Captures the break to Sentry when `@sentry/nextjs` is wired (best-
 *      effort; never let observability throw into the response).
 *   3. Returns 200 with the diagnosis payload so dashboards and runbooks
 *      can surface it without retry storms.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  PRE_CHAIN_SENTINEL,
  genesisHash,
  orderByChainLinkage,
  verifyChain,
  type AuditRowWithHashes,
} from "@ratesassist/audit-core";

import { fail, ok, resolveRouteSession } from "@/lib/api-helpers";
import { hasPermission } from "@/lib/auth";
import { correlationIdFromHeaders } from "@/lib/correlation";
import { getWebDb, isDbWired } from "@/lib/db";
import { scoped } from "@/lib/logger";
import { getClientIp, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VerifyChainResponse {
  readonly ok: boolean;
  readonly totalRows: number;
  readonly latestTs: string | null;
  readonly brokenAt?: number;
  readonly expectedHash?: string;
  readonly actualHash?: string;
  /**
   * True when the caller passed a `since=` window that snipped the chain at
   * a point that is NOT the genesis row. The verifier still runs and reports
   * `ok` based on the window-internal chain consistency — but the caller
   * should not treat a `prev_hash !== genesisHash` at index 0 as tamper.
   */
  readonly evictionTruncated: boolean;
}

interface AuditLogDbRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly actor_kind: string;
  readonly action: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly correlation_id: string | null;
  readonly ip: string | null;
  readonly user_agent: string | null;
  readonly occurred_at: string | Date;
  readonly prev_hash: string | null;
  readonly row_hash: string | null;
}

/**
 * Limit clamp.
 *
 * F-011 mitigation (Wave 3 pen-test). The original default was 10 000 —
 * that's 10 000 SHA-256 passes per request on the Node.js single-thread
 * event loop. Ten concurrent supervisors could DoS the worker for
 * seconds at a time. New default is 1 000, hard ceiling 10 000 for
 * platform_admin explicit opt-in. Combine with the rate limit in the
 * handler.
 */
function clampLimit(raw: string | null): number {
  const n = Number(raw ?? 1_000);
  if (!Number.isFinite(n) || n < 1) return 1_000;
  return Math.min(10_000, Math.floor(n));
}

function toIsoString(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function hydrate(row: AuditLogDbRow): AuditRowWithHashes {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    actorKind: row.actor_kind,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    before: row.before ?? null,
    after: row.after ?? null,
    correlationId: row.correlation_id ?? null,
    ip: row.ip ?? null,
    userAgent: row.user_agent ?? null,
    occurredAt: toIsoString(row.occurred_at),
    prevHash: row.prev_hash ?? "",
    rowHash: row.row_hash ?? "",
  };
}

/**
 * Capture a chain break to Sentry if `@sentry/nextjs` is loadable. Best
 * effort — never throws into the route. Logs are structured + correlated
 * regardless of Sentry status, so on-call has the data either way.
 */
async function captureChainBreakToSentry(payload: {
  readonly tenantId: string;
  readonly brokenAt: number;
  readonly expectedHash: string;
  readonly actualHash: string;
  readonly correlationId: string;
}): Promise<void> {
  try {
    // Dynamic-import so a missing dep doesn't break the route build.
    const mod = await import("@sentry/nextjs").catch(() => null);
    if (!mod) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry = mod as any;
    if (typeof Sentry.captureMessage !== "function") return;
    // F-011 mitigation (Wave 3 pen-test, Chain-1). The previous
    // fingerprint was tenant-only, which clustered EVERY break into
    // one Sentry issue per tenant — an attacker who could insert one
    // bad row also masked subsequent genuine tampers. Including the
    // actualHash + brokenAt row index in the fingerprint separates
    // distinct breaks while keeping repeated identical breaks
    // clustered (same row, same recompute → same fingerprint).
    Sentry.captureMessage("audit.chain_break", {
      level: "error",
      fingerprint: [
        "audit",
        "chain_break",
        payload.tenantId,
        String(payload.brokenAt),
        payload.actualHash,
      ],
      tags: {
        tenant_id: payload.tenantId,
        correlation_id: payload.correlationId,
      },
      extra: {
        brokenAt: payload.brokenAt,
        expectedHash: payload.expectedHash,
        actualHash: payload.actualHash,
      },
    });
  } catch {
    /* never let observability throw */
  }
}

/**
 * Rate-limit cap for verify-chain. F-011 mitigation (Wave 3 pen-test).
 *
 * Each request runs up to 10 000 SHA-256 passes synchronously on the
 * Node event loop. Without a limit, a handful of concurrent supervisors
 * could effectively DoS the worker. 6 requests/minute per IP is
 * generous for a human operator checking integrity and tight enough to
 * prevent a malicious burst. Behind a single IP at scale, swap for
 * per-(tenant, actor) keying via Redis when load-bearing.
 */
const VERIFY_CHAIN_RATE_LIMIT = 6;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = correlationIdFromHeaders(req.headers);
  const log = scoped("api/audit/verify-chain", { correlationId });

  // F-011 rate limit — cap concurrent invocations before any work
  // happens. The session check below also runs, but we want the cheap
  // limit to fire first so an unauthenticated burst doesn't trigger
  // session-resolver work.
  const ip = getClientIp(req);
  const rl = rateLimit(ip, VERIFY_CHAIN_RATE_LIMIT);
  if (!rl.ok) {
    log.warn({ msg: "audit.verify.rate_limited", ip });
    return new NextResponse(
      JSON.stringify({
        ok: false,
        code: "rate_limited",
        message: "verify-chain rate limit exceeded (6/min); back off",
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "Retry-After": retryAfterSeconds(rl.resetAt),
        },
      },
    );
  }

  const session = await resolveRouteSession(req);
  if (!session) return fail("unauthorized", "session required", 401);
  if (!hasPermission(session as Parameters<typeof hasPermission>[0], "read.audit_log")) {
    log.warn({ msg: "audit.verify.forbidden", userId: session.userId });
    return fail("forbidden", "read.audit_log permission required", 403);
  }

  // Tenant resolution — caller can only verify their own tenant unless
  // platform_admin. This is enforced HERE (not in the DB layer) because
  // the verifier's whole point is to detect tampering, and a cross-tenant
  // request from a non-admin is itself suspicious.
  const url = new URL(req.url);
  const requestedTenant = url.searchParams.get("tenantId") ?? undefined;
  const isPlatformAdmin = session.roles.includes("platform_admin");
  let tenantId: string = session.tenantId;
  if (requestedTenant !== undefined && requestedTenant !== session.tenantId) {
    if (!isPlatformAdmin) {
      log.warn({
        msg: "audit.verify.cross_tenant_blocked",
        userId: session.userId,
        requestedTenant,
      });
      return fail("forbidden", "cross-tenant verify requires platform_admin", 403);
    }
    tenantId = requestedTenant;
  }

  const limit = clampLimit(url.searchParams.get("limit"));
  const since = url.searchParams.get("since") ?? undefined;

  if (!isDbWired()) {
    log.warn({ msg: "audit.verify.db_not_wired" });
    return fail(
      "internal_error",
      "chain verification requires RA_USE_DB=true",
      500,
    );
  }

  const db = await getWebDb();
  // Reach for sql tagged-template helper via @ratesassist/db's re-export.
  const { sql } = await import("@ratesassist/db");

  // Walk in chain order: (tenant_id, occurred_at ASC, id ASC). Uses
  // `audit_log_tenant_chain_idx`. We pull the raw DB rows here rather than
  // going through drizzle's select() because the route's only job is to
  // hash-verify — we don't need the typed projection.
  let rows: ReadonlyArray<AuditLogDbRow>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = since !== undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await (db as any).execute(sql`
          SELECT id, tenant_id, actor_id, actor_kind::text AS actor_kind,
                 action, target_type, target_id, before, after,
                 correlation_id, ip, user_agent, occurred_at,
                 prev_hash, row_hash
            FROM audit_log
           WHERE tenant_id = ${tenantId}
             AND occurred_at >= ${since}::timestamptz
           ORDER BY occurred_at ASC, id ASC
           LIMIT ${limit}
        `)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : await (db as any).execute(sql`
          SELECT id, tenant_id, actor_id, actor_kind::text AS actor_kind,
                 action, target_type, target_id, before, after,
                 correlation_id, ip, user_agent, occurred_at,
                 prev_hash, row_hash
            FROM audit_log
           WHERE tenant_id = ${tenantId}
           ORDER BY occurred_at ASC, id ASC
           LIMIT ${limit}
        `);
    rows = (result.rows ?? result) as ReadonlyArray<AuditLogDbRow>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ msg: "audit.verify.read_failed", tenantId, error: msg });
    return fail("internal_error", "audit-log read failed", 500);
  }

  const hydrated = rows.map(hydrate);
  const totalRows = hydrated.length;

  // The SQL above orders by (occurred_at ASC, id ASC) — a STABLE fetch order,
  // but NOT necessarily chain order. `occurred_at` comes from `new Date()`, so
  // a burst of writes collides on the same millisecond and the wall-clock sort
  // interleaves chain-adjacent rows out of linked order. `verifyChain` walks
  // position-by-position and would then report a FALSE break (SEV1 + Sentry)
  // on a perfectly intact chain. The hash linkage is the only authority on
  // order, so reconstruct true chain order before verifying. Seed with the
  // tenant genesis so the common full-chain case anchors deterministically;
  // `orderByChainLinkage` discovers the head structurally for `since=`
  // eviction windows where the genesis row isn't in the set.
  const orderedRows = orderByChainLinkage(hydrated, genesisHash(tenantId));

  // latestTs is the chain TAIL's timestamp — the most recent row that is part
  // of the verified chain (orderedRows ends at the tail for an intact chain).
  const latestTs =
    totalRows > 0 ? orderedRows[totalRows - 1]!.occurredAt : null;

  // Detect eviction-truncated windows: if the caller passed `since=` AND
  // the chain HEAD's prev_hash is not genesisHash(tenantId), the chain anchor
  // was outside the window. The verifier still runs but the caller MUST NOT
  // alert on a row-0 prev_hash mismatch — the chain is intact, just not
  // visible from this window. We read the head from orderedRows (the true
  // chain head), not the wall-clock-first row.
  let evictionTruncated = false;
  if (since !== undefined && totalRows > 0) {
    const firstReal = orderedRows.find(
      (r) => r.prevHash !== PRE_CHAIN_SENTINEL,
    );
    if (firstReal && firstReal.prevHash !== genesisHash(tenantId)) {
      evictionTruncated = true;
    }
  }

  const verdict = verifyChain(orderedRows);

  if (verdict.ok) {
    log.info({
      msg: "audit.verify.ok",
      tenantId,
      totalRows,
      evictionTruncated,
    });
    const data: VerifyChainResponse = {
      ok: true,
      totalRows,
      latestTs,
      evictionTruncated,
    };
    return ok(data);
  }

  // If the chain "break" is at index 0 AND we're inside an eviction window,
  // it's a legitimate window break, not tamper. Treat as ok.
  if (evictionTruncated && verdict.firstBreakIndex === 0) {
    log.info({
      msg: "audit.verify.eviction_truncated",
      tenantId,
      totalRows,
      since,
    });
    const data: VerifyChainResponse = {
      ok: true,
      totalRows,
      latestTs,
      evictionTruncated: true,
    };
    return ok(data);
  }

  // GENUINE break. SEV1.
  log.error({
    msg: "audit.chain_break",
    tenantId,
    totalRows,
    brokenAt: verdict.firstBreakIndex,
    expectedHash: verdict.expectedHash,
    actualHash: verdict.actualHash,
    evictionTruncated,
  });
  await captureChainBreakToSentry({
    tenantId,
    brokenAt: verdict.firstBreakIndex,
    expectedHash: verdict.expectedHash,
    actualHash: verdict.actualHash,
    correlationId,
  });

  const data: VerifyChainResponse = {
    ok: false,
    totalRows,
    latestTs,
    brokenAt: verdict.firstBreakIndex,
    expectedHash: verdict.expectedHash,
    actualHash: verdict.actualHash,
    evictionTruncated,
  };
  return ok(data);
}
