/**
 * GET /api/evidence/<assessmentNumber>/notice — DRAFT statutory rate-
 * reclassification notice (PDF).
 *
 * JD-1. Produces a formal, fully-worded DRAFT rate notice from the same
 * structured EvidencePack the evidence PDF is built from — council
 * letterhead, recipient of record, the proposed determination, the
 * backdating calculation, and the statutory basis. Pure template
 * interpolation; no LLM. The document is stamped DRAFT throughout and is
 * never a served instrument — the officer reviews, authorises, and serves
 * it themselves.
 *
 * Auth + tenancy + audit mirror the evidence PDF route exactly:
 *   - resolveRouteSession → 401 on absence.
 *   - tenantFromAssessmentNumber + sessionMayAccessTenant → cross-tenant 404
 *     (same shape as "asset does not exist"; not an enumeration oracle).
 *   - per-tenant evaluation context (asset tenant) — never the global
 *     cross-tenant snapshot.
 *   - best-effort `statutory_notice.drafted` audit row on success.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  fail,
  resolveRouteSession,
  sessionMayAccessTenant,
  tenantFromAssessmentNumber,
} from "@/lib/api-helpers";
import { COUNCILS } from "@/lib/data";
import { getEvaluationContextForTenant } from "@/lib/clients";
import { correlationIdFromHeaders } from "@/lib/correlation";
import { renderStatutoryNotice } from "@/lib/evidencePdf";
import {
  pdfIdentityHmac,
  pdfIntegrityReceipt,
  type PdfIdentity,
} from "@/lib/pdfIntegrity";
import { getClientIp, rateLimitComposite, retryAfterSeconds } from "@/lib/rate-limit";
import { scoped } from "@/lib/logger";
import { buildEvidencePack } from "@ratesassist/recovery-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSESSMENT_PATTERN = /^[A-Z0-9-]{3,40}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ file: string }> },
): Promise<Response> {
  const correlationId = correlationIdFromHeaders(req.headers);
  const log = scoped("api/evidence/notice", { correlationId });

  // ---- 1. Auth. ----
  const session = await resolveRouteSession(req);
  if (!session) {
    log.warn({ msg: "notice.unauthorized" });
    return fail("unauthorized", "Authentication required.");
  }

  // ---- 1b. Rate limit (notice render is as expensive as the PDF). ----
  const ip = getClientIp(req);
  const rl = rateLimitComposite({ scope: "evidence-notice", ip, tenantId: session.tenantId, max: 5 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } },
    );
  }

  // ---- 2. Path-param validation. ----
  const { file } = await ctx.params;
  if (!ASSESSMENT_PATTERN.test(file)) {
    log.warn({ msg: "notice.invalid_assessment", file });
    return fail("invalid_input", "Invalid assessment number.");
  }
  const assessmentNumber = file;

  // ---- 3. Tenant scoping: cross-tenant → 404 (not 403). ----
  const assetTenant = tenantFromAssessmentNumber(assessmentNumber);
  if (!sessionMayAccessTenant(session, assetTenant)) {
    log.warn({
      msg: "notice.cross_tenant_blocked",
      userId: session.userId,
      sessionTenant: session.tenantId,
      assessmentTenant: assetTenant,
    });
    return fail("not_found", `Evidence for ${assessmentNumber} not found.`);
  }

  // ---- 4. Build the pack from the ASSET tenant's context. ----
  const evalCtx = await getEvaluationContextForTenant(
    assetTenant ?? session.tenantId,
  );
  const result = buildEvidencePack(assessmentNumber, evalCtx);
  if (result.kind !== "ok") {
    log.info({ msg: "notice.no_pack", assessmentNumber, reason: result.kind });
    if (result.kind === "no_owner") {
      return NextResponse.json(
        { ok: false, code: "owner_missing", error: "No owner record is linked to this property. A notice cannot be drafted without a recipient of record." },
        { status: 422 },
      );
    }
    if (result.kind === "no_state_template") {
      return NextResponse.json(
        { ok: false, code: "jurisdiction_unsupported", error: `State '${result.state}' is not yet supported for notice drafting.`, supportedStates: ["WA"] },
        { status: 501 },
      );
    }
    return fail("not_found", `No reclassification evidence for ${assessmentNumber}.`);
  }
  const pack = result.pack;

  // ---- 5. Resolve recipient of record (owner) + council name. ----
  // F-001: bind the letterhead council to the ASSET's tenant, not the actor's
  // session tenant. A platform_admin in council A drafting a notice for
  // council B's assessment must render B's letterhead — using session.tenantId
  // would stamp A's council name onto B's statutory document. Matches the
  // evidence-pdf sibling and the integrity receipt (both asset-tenant bound).
  const noticeTenant = assetTenant ?? session.tenantId;
  const council = COUNCILS.find((c) => c.code === noticeTenant);
  const councilName = council?.name ?? noticeTenant;

  const property = pack.candidate.property;
  const ownerId = property.ownerIds[0];
  const owner = ownerId !== undefined ? evalCtx.ownersById.get(ownerId) : undefined;
  // Prefer the council's owner of record; fall back to the registered
  // proprietor on title; finally a neutral placeholder the officer fills in.
  const recipient = {
    name: owner?.name ?? property.proprietorOnTitle ?? "Owner of record",
    postalAddress:
      owner?.postalAddress ??
      property.proprietorPostalAddress ??
      `${property.address}, ${property.suburb} ${property.postcode} ${property.state}`,
  };

  const generatedAtFull = new Date().toISOString();
  const issuedDate = generatedAtFull.slice(0, 10);
  const noticeRef = `RN-${assessmentNumber}-${issuedDate.replace(/-/g, "")}`;

  // Receipt is bound to + stored under the ASSET tenant (see the pdf route for
  // rationale) so a platform_admin-drafted notice still verifies publicly.
  const receiptTenant = assetTenant ?? session.tenantId;

  // Integrity identity — computed before render so the footer carries the ref.
  const identity: PdfIdentity = {
    tenantId: receiptTenant,
    docId: noticeRef,
    userId: session.userId,
    timestamp: generatedAtFull,
  };
  const { ref: integrityRef } = pdfIdentityHmac(identity);

  // ---- 6. Render. ----
  let pdf: Buffer;
  try {
    pdf = await renderStatutoryNotice({
      pack,
      councilName,
      operatorName: session.displayName,
      recipient,
      noticeRef,
      issuedDate,
      integrityRef,
    });
  } catch (e) {
    log.error({
      msg: "notice.render_failed",
      assessmentNumber,
      error: e instanceof Error ? e.message : String(e),
    });
    return fail("internal_error", "Notice render failed.");
  }

  const receipt = pdfIntegrityReceipt(identity, pdf);

  // ---- 7. Audit — best-effort (recorded under the asset tenant). ----
  await writeNoticeAudit({
    tenantId: receiptTenant,
    actorId: session.userId,
    correlationId,
    ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
    noticeRef,
    assessmentNumber,
    operatorName: session.displayName,
    generatedAt: generatedAtFull,
    pdfSha256: receipt.sha256,
    pdfHmac: receipt.hmac,
  });

  log.info({
    msg: "notice.served",
    assessmentNumber,
    noticeRef,
    bytes: pdf.length,
    userId: session.userId,
    tenantId: session.tenantId,
  });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${noticeRef}.pdf"`,
      "cache-control": "private, no-store",
      "x-correlation-id": correlationId,
    },
  });
}

/**
 * Best-effort audit write for a drafted notice. Mirrors the evidence PDF
 * route's lazy-import pattern; failure is swallowed + logged so a missing
 * audit surface never fails the download.
 */
async function writeNoticeAudit(args: {
  tenantId: string;
  actorId: string;
  correlationId: string;
  ip?: string;
  userAgent?: string;
  noticeRef: string;
  assessmentNumber: string;
  operatorName: string;
  generatedAt: string;
  pdfSha256: string;
  pdfHmac: string;
}): Promise<void> {
  try {
    const audit = await import("@ratesassist/adapter-demo/audit");
    audit.recordMutation({
      tenantId: args.tenantId,
      actorId: args.actorId,
      actorKind: "user",
      action: "statutory_notice.drafted",
      target: { type: "statutory_notice", id: args.noticeRef },
      after: {
        assessmentNumber: args.assessmentNumber,
        operatorName: args.operatorName,
        generatedAt: args.generatedAt,
        pdfSha256: args.pdfSha256,
        pdfHmac: args.pdfHmac,
      },
      correlationId: args.correlationId,
      ...(args.ip !== undefined ? { ip: args.ip } : {}),
      ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
    });
  } catch {
    // Non-fatal — see the evidence PDF route for rationale.
  }
}
