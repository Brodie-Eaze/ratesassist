/**
 * GET /api/recovery/candidates — paginated mismatch list.
 *
 * Replaces the /api/data fan-out for the Recovery dashboard. The previous
 * shape shipped the full PROPERTIES, OWNERS and TENEMENTS arrays even
 * though the Recovery UI only needs `mismatches` + `stats` + a council
 * lookup. This route ships only the candidate list (filtered, sorted,
 * paginated) and keeps stats inline.
 *
 * Query params:
 *   ?severity=high|medium|low                  filter by severity
 *   ?signal=<signal-id>                        only candidates with that signal
 *   ?sortBy=score|uplift|granted               default: score (desc)
 *   ?limit=N      (1..200, default 50)
 *   ?offset=M     (>=0, default 0)
 *
 * Response payload:
 *   {
 *     ok: true,
 *     data: { candidates: MismatchCandidate[], stats: WebRecoveryStats },
 *     pagination: { total, limit, offset }
 *   }
 *
 * Cache-Control: private, max-age=60. Weak ETag from canonical JSON.
 */

import type { NextRequest } from "next/server";
import {
  findMismatches,
  type EvaluationContext,
} from "@ratesassist/recovery-engine";
import type { MismatchCandidate } from "@ratesassist/contract";

/**
 * Memoised sweep — keyed by the EvaluationContext reference.
 *
 * Performance review surfaced (P0): every filter-click on /recovery
 * re-ran `findMismatches(evalCtx)` over the full 50k-row context.
 * The context is rebuilt only when something material changes
 * (mutation lands, lifecycle event, periodic refresh), so caching
 * the previous sweep by identity is safe — when the context object
 * is replaced, the cache misses and we re-sweep.
 *
 * Capacity is 1 entry. With per-tenant evaluation contexts (E3), the
 * most recent tenant's sweep is cached. Under single-tenant deployments
 * (the normal case) this is effectively a full hit — the same context
 * object is returned for 5 minutes by `getEvaluationContextForTenant`.
 * In a high-concurrency multi-tenant deployment this entry thrashes; a
 * `Map<tenantId, result>` would be the right upgrade at that point.
 */
let _lastCtx: EvaluationContext | null = null;
let _lastResult: readonly MismatchCandidate[] | null = null;

function findMismatchesCached(
  ctx: EvaluationContext,
): readonly MismatchCandidate[] {
  if (ctx === _lastCtx && _lastResult !== null) return _lastResult;
  const fresh = findMismatches(ctx);
  _lastCtx = ctx;
  _lastResult = fresh;
  return fresh;
}

import {
  applyPagination,
  fail,
  maybeNotModified,
  ok,
  readPageParams,
  resolveRouteSession,
  sessionMayAccessTenant,
  tenantFromAssessmentNumber,
  weakEtag,
} from "@/lib/api-helpers";
import { getEvaluationContext, getEvaluationContextForTenant, recoveryStatsFor } from "@/lib/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Severity = "high" | "medium" | "low";
type SortKey = "score" | "uplift" | "granted";

const VALID_SEVERITY: ReadonlySet<string> = new Set(["high", "medium", "low"]);
const VALID_SORT: ReadonlySet<string> = new Set(["score", "uplift", "granted"]);

function parseSortBy(raw: string | null): SortKey {
  if (raw !== null && (VALID_SORT as ReadonlySet<string>).has(raw)) {
    return raw as SortKey;
  }
  return "score";
}

function sortCandidates(
  rows: readonly MismatchCandidate[],
  by: SortKey,
): MismatchCandidate[] {
  const arr = [...rows];
  switch (by) {
    case "uplift":
      arr.sort((a, b) => (b.estUplift ?? 0) - (a.estUplift ?? 0));
      return arr;
    case "granted":
      // "granted" = newest tenement grant date. Pull max grantedDate per
      // candidate and sort desc; missing dates fall to the bottom.
      arr.sort((a, b) => {
        const ad = maxGranted(a);
        const bd = maxGranted(b);
        return bd.localeCompare(ad);
      });
      return arr;
    case "score":
    default:
      arr.sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
      return arr;
  }
}

function maxGranted(c: MismatchCandidate): string {
  let max = "";
  for (const t of c.tenements) {
    if (t.grantedDate > max) max = t.grantedDate;
  }
  return max;
}

export async function GET(req: NextRequest): Promise<Response> {
  // ship-ready iter3: the previous gate used `hasSession`, which reads
  // through the api-helpers `readSession` path. That path tolerated
  // ANY non-empty `RA_DEV_AUTOLOGIN_SESSION` value (returned a
  // placeholder `{id: dev}` object), completely bypassing the
  // `parseDevAutologin` allowlist that the rest of the platform
  // adopted in iter1. Switching to `resolveRouteSession` makes this
  // route enforce the same allowlist + cookie + header chain as every
  // other authenticated endpoint.
  const session = await resolveRouteSession(req);
  if (!session) {
    return fail("unauthorized", "Authentication required.");
  }
  const isPlatformAdmin = session.roles.includes("platform_admin");

  const url = req.nextUrl;
  const severityRaw = url.searchParams.get("severity");
  const signalId = url.searchParams.get("signal");
  const sortBy = parseSortBy(url.searchParams.get("sortBy"));
  const { limit, offset } = readPageParams(url);

  if (severityRaw !== null && !(VALID_SEVERITY as ReadonlySet<string>).has(severityRaw)) {
    return fail("invalid_input", "severity must be one of high|medium|low");
  }
  const severity = severityRaw as Severity | null;

  // E3: per-tenant SQL-scoped context — loads only this tenant's
  // candidate properties instead of the global all-tenants context.
  // platform_admin uses the global context so they can see all tenants'
  // candidates (e.g. cross-tenant evidence review, rate-table integration
  // tests, and bulk tooling). Non-admin sessions scope to their own tenant.
  const evalCtx = isPlatformAdmin
    ? getEvaluationContext()
    : await getEvaluationContextForTenant(session.tenantId);
  const all = findMismatchesCached(evalCtx);

  // ship-ready iter3: scope the candidate list to the session's
  // tenant before any other filter. Same derivation model as the
  // [assessmentNumber] routes — the assessment-number prefix carries
  // the owning tenant. platform_admin bypasses the scope.
  let filtered: readonly MismatchCandidate[] = isPlatformAdmin
    ? all
    : all.filter((c) =>
        sessionMayAccessTenant(
          session,
          tenantFromAssessmentNumber(c.property.assessmentNumber),
        ),
      );
  if (severity !== null) {
    filtered = filtered.filter((c) => c.severity === severity);
  }
  if (signalId !== null && signalId.length > 0) {
    filtered = filtered.filter((c) => c.signals.some((s) => s.id === signalId));
  }

  const sorted = sortCandidates(filtered, sortBy);
  const { slice, total } = applyPagination(sorted, limit, offset);

  // Stats are computed on the FULL (post-filter) set — the UI cards show
  // "X candidates match these filters", not "X on this page".
  const stats = recoveryStatsFor(filtered);

  const payload = {
    candidates: slice,
    stats,
  };

  const etag = weakEtag({ payload, total, limit, offset });
  const notModified = maybeNotModified(req, etag);
  if (notModified !== null) return notModified;

  return ok(payload, {
    pagination: { total, limit, offset },
    headers: {
      etag,
      "cache-control": "private, max-age=60",
      "x-total-count": String(total),
    },
  });
}
