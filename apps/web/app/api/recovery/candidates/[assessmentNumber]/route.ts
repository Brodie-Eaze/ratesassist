/**
 * GET /api/recovery/candidates/[assessmentNumber] — single recovery
 * candidate detail.
 *
 * Returns the candidate record for one assessment number IF it is
 * currently flagged by the recovery engine. Includes full signal hits,
 * intersecting tenements, the upstream evidence pack (if a build is
 * possible), and the uplift estimate.
 *
 * 404 — assessment number is not currently a candidate. (The property
 * may still exist; clients should fall back to /api/properties/<n> for
 * non-flagged properties.)
 */

import type { NextRequest } from "next/server";
import { findMismatches } from "@ratesassist/recovery-engine";

import { runTool } from "@/lib/tools";
import {
  fail,
  hasSession,
  maybeNotModified,
  ok,
  weakEtag,
} from "@/lib/api-helpers";
import { getEvaluationContext } from "@/lib/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ assessmentNumber: string }> },
): Promise<Response> {
  if (!hasSession(req)) {
    return fail("unauthorized", "Authentication required.");
  }

  const { assessmentNumber: encoded } = await ctx.params;
  const assessmentNumber = decodeURIComponent(encoded);

  const evalCtx = getEvaluationContext();
  const candidates = findMismatches(evalCtx);
  const candidate = candidates.find(
    (c) => c.property.assessmentNumber === assessmentNumber,
  );

  if (candidate === undefined) {
    return fail(
      "not_found",
      `Assessment ${assessmentNumber} is not a current recovery candidate.`,
    );
  }

  // Best-effort evidence pack — the tool may legitimately return ok:false
  // (e.g. no producing tenement, no overlap). Surface its data when
  // available; otherwise omit.
  const evidence = await runTool("generate_evidence_pack", { assessmentNumber });

  const payload = {
    candidate,
    signals: candidate.signals,
    tenements: candidate.tenements,
    estUplift: candidate.estUplift,
    estArrears3y: candidate.estArrears3y,
    evidence: evidence.ok ? evidence.data ?? null : null,
  };

  const etag = weakEtag(payload);
  const notModified = maybeNotModified(req, etag);
  if (notModified !== null) return notModified;

  return ok(payload, {
    headers: { etag, "cache-control": "private, max-age=60" },
  });
}
