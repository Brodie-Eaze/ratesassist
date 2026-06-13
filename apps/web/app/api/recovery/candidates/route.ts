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

import { NextResponse, type NextRequest } from "next/server";
import {
  findMismatchesWithOvertax,
  type EvaluationContext,
  type MismatchResult,
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
 * Capacity is 1 entry — there's only ever one live context. Holding
 * a single ref is enough; a Map would just leak as contexts age out.
 */
let _lastCtx: EvaluationContext | null = null;
let _lastResult: MismatchResult | null = null;

function findMismatchesCached(ctx: EvaluationContext): MismatchResult {
  if (ctx === _lastCtx && _lastResult !== null) return _lastResult;
  // Single sweep yields both the recovery headline AND the over-rated
  // (review-and-refund) bucket — cache the whole object so the overtaxed
  // surface never triggers a second pass.
  const fresh = findMismatchesWithOvertax(ctx);
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
import {
  getEvaluationContext,
  overtaxedStatsFor,
  recoveryStatsFor,
} from "@/lib/clients";
import { getClientIp, rateLimitComposite, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Severity = "high" | "medium" | "low";
type SortKey = "score" | "uplift" | "granted";

const VALID_SEVERITY: ReadonlySet<string> = new Set(["high", "medium", "low"]);
const VALID_SORT: ReadonlySet<string> = new Set(["score", "uplift", "granted"]);

// Cap the over-rated list shipped in the envelope. The full count + refund
// exposure is always reported via overtaxedStats; the list itself is a
// triage starting point, not an exhaustive export.
const OVERTAXED_CAP = 50;

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
  const ip = getClientIp(req);
  const rl = rateLimitComposite({ scope: "recovery-candidates", ip, tenantId: session.tenantId, max: 20 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } }
    );
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

  const evalCtx = getEvaluationContext();
  const swept = findMismatchesCached(evalCtx);

  // ship-ready iter3: scope BOTH the recovery list and the over-rated list
  // to the session's tenant before any other filter. Same derivation model
  // as the [assessmentNumber] routes — the assessment-number prefix carries
  // the owning tenant. platform_admin bypasses the scope.
  const inTenant = (c: MismatchCandidate): boolean =>
    isPlatformAdmin ||
    sessionMayAccessTenant(
      session,
      tenantFromAssessmentNumber(c.property.assessmentNumber),
    );

  let filtered: readonly MismatchCandidate[] = swept.candidates.filter(inTenant);
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

  // Over-rated ("review & refund") surface — tenant-scoped, NOT subject to
  // the severity/signal filters (it is a separate governance list), capped
  // so a large over-rating set can't bloat the envelope. The full count +
  // refund exposure is reported via overtaxedStats regardless of the cap.
  const overtaxedAll = swept.overtaxedCandidates.filter(inTenant);
  const overtaxedStats = overtaxedStatsFor(overtaxedAll);
  const overtaxedCandidates = overtaxedAll.slice(0, OVERTAXED_CAP);

  const payload = {
    candidates: slice,
    stats,
    overtaxedCandidates,
    overtaxedStats,
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
