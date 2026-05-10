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
import { findMismatches } from "@ratesassist/recovery-engine";
import type { MismatchCandidate } from "@ratesassist/contract";

import {
  applyPagination,
  fail,
  hasSession,
  maybeNotModified,
  ok,
  readPageParams,
  weakEtag,
} from "@/lib/api-helpers";
import { getEvaluationContext, recoveryStatsFor } from "@/lib/clients";

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
  if (!hasSession(req)) {
    return fail("unauthorized", "Authentication required.");
  }

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
  const all = findMismatches(evalCtx);

  let filtered: readonly MismatchCandidate[] = all;
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
