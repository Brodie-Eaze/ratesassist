/**
 * GET /api/roll-quality — Assessment Roll Quality report (IAAO-style).
 *
 * Surfaces the `rollQuality` analysis from @ratesassist/recovery-engine: per
 * (land-use × suburb) stratum, the dispersion of valuations (IAAO COD proxy)
 * and the parcels furthest from their stratum median. This is the governance /
 * triage artifact no WA council currently receives — it finds SYSTEMIC,
 * category-level non-uniformity the manual, parcel-by-parcel review can't see.
 *
 * HONEST SCOPE: this is a peer-DISPERSION study on current valuations, not a
 * market-calibrated sales-ratio study (no sale prices yet — Landgate transfer
 * data is paid/queued). High dispersion flags a stratum for officer REVIEW; it
 * is not an automatic recovery signal (a genuinely expensive parcel in a cheap
 * suburb is an outlier but may be correctly rated). The `note` field says so.
 *
 * Query params:
 *   ?landUse=Residential|Commercial|Industrial|Rural|Vacant|Mining   filter
 *   ?flaggedOnly=true                                                only strata over the IAAO band
 *
 * Response: { ok, data: { summary, strata, flaggedStrata, note } }
 * Cache-Control: private, max-age=60. Weak ETag from canonical JSON.
 */

import { NextResponse, type NextRequest } from "next/server";
import { rollQuality } from "@ratesassist/recovery-engine";
import type { LandUse } from "@ratesassist/contract";

import {
  fail,
  maybeNotModified,
  ok,
  resolveRouteSession,
  sessionMayAccessTenant,
  tenantFromAssessmentNumber,
  weakEtag,
} from "@/lib/api-helpers";
import { getEvaluationContext } from "@/lib/clients";
import { getClientIp, rateLimitComposite, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_LAND_USE: ReadonlySet<string> = new Set([
  "Residential",
  "Commercial",
  "Industrial",
  "Rural",
  "Vacant",
  "Mining",
]);

export async function GET(req: NextRequest): Promise<Response> {
  const session = await resolveRouteSession(req);
  if (!session) {
    return fail("unauthorized", "Authentication required.");
  }
  const ip = getClientIp(req);
  const rl = rateLimitComposite({ scope: "roll-quality", ip, tenantId: session.tenantId, max: 10 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } }
    );
  }
  const isPlatformAdmin = session.roles.includes("platform_admin");

  const url = req.nextUrl;
  const landUseRaw = url.searchParams.get("landUse");
  if (landUseRaw !== null && !VALID_LAND_USE.has(landUseRaw)) {
    return fail(
      "invalid_input",
      "landUse must be one of Residential|Commercial|Industrial|Rural|Vacant|Mining",
    );
  }
  const landUse = landUseRaw as LandUse | null;
  const flaggedOnly = url.searchParams.get("flaggedOnly") === "true";

  // Get the full evaluation context; non-admin officers are scoped to their
  // tenant via sessionMayAccessTenant below. platform_admin sees all parcels.
  const evalCtx = getEvaluationContext();
  const all = evalCtx.properties;
  const scoped = isPlatformAdmin
    ? all
    : all.filter((p) =>
        sessionMayAccessTenant(session, tenantFromAssessmentNumber(p.assessmentNumber)),
      );

  const report = rollQuality(scoped);

  let strata = report.strata;
  if (landUse !== null) strata = strata.filter((s) => s.landUse === landUse);
  if (flaggedOnly) strata = strata.filter((s) => s.exceedsStandard);
  const flaggedStrata = report.flaggedStrata.filter(
    (s) => landUse === null || s.landUse === landUse,
  );

  const payload = {
    summary: {
      propertiesAnalysed: scoped.length,
      totalStrata: report.strata.length,
      flaggedStrata: report.flaggedStrata.length,
    },
    strata,
    flaggedStrata,
    note: report.note,
  };

  const etag = weakEtag(payload);
  const notModified = maybeNotModified(req, etag);
  if (notModified !== null) return notModified;

  return ok(payload, {
    headers: {
      etag,
      "cache-control": "private, max-age=60",
      "x-total-count": String(report.strata.length),
    },
  });
}
