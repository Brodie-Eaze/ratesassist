/**
 * GET /api/evidence/<assessmentNumber>/pdf
 *
 * Statutory-grade PDF rendering of the reclassification evidence pack.
 * This is the council finance team's downloadable artefact — selectable
 * text, deterministic layout, council letterhead, and a back-reference
 * QR code linking to the live HTML pack.
 *
 * Auth + tenancy:
 *   - resolveRouteSession: same path the rest of the protected REST API
 *     uses (header → cookie → dev autologin). 401 on absence.
 *   - tenantFromAssessmentNumber + sessionMayAccessTenant: tenant-scopes
 *     the request to the assessment-number prefix. Cross-tenant returns
 *     404 — same shape as "asset does not exist" so the endpoint is not
 *     an enumeration oracle (F-002).
 *
 * Audit:
 *   - On a successful render, we record a `pdf.generated` mutation
 *     against target {type:"evidence_pack", id:packId}. The audit row
 *     captures the operator, tenant, correlation id, IP and user-agent.
 *     This is statutory-grade output and the row is required for
 *     downstream review. We do not fail the request when the audit
 *     write throws (best-effort; logged to stderr by the audit shim),
 *     but the audit module already covers `generate_statutory_certificate`
 *     in FAIL_CLOSED_ACTIONS — the parallel for `pdf.generated` is the
 *     same intent and may be added later if the pilot demands it.
 *
 * Caching: dynamic, no caching. The PDF embeds the operator name and a
 * fresh QR; serving a cached copy across operators would be wrong.
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
import { renderEvidencePdf } from "@/lib/evidencePdf";
import {
  pdfIdentityHmac,
  pdfIntegrityReceipt,
  type PdfIdentity,
} from "@/lib/pdfIntegrity";
import { persistPdfReceipt } from "@/lib/pdfReceiptStore";
import { getClientIp, rateLimitComposite, retryAfterSeconds } from "@/lib/rate-limit";
import { scoped } from "@/lib/logger";
import { buildEvidencePack } from "@ratesassist/recovery-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirror the .md/.html route's validator so we share an attack surface
// vocabulary: alphanumerics + dashes only, between 3 and 40 characters.
const ASSESSMENT_PATTERN = /^[A-Z0-9-]{3,40}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ file: string }> },
): Promise<Response> {
  const correlationId = correlationIdFromHeaders(req.headers);
  const log = scoped("api/evidence/pdf", { correlationId });

  // ---- 1. Auth: session required. ----
  const session = await resolveRouteSession(req);
  if (!session) {
    log.warn({ msg: "evidence.pdf.unauthorized" });
    return fail("unauthorized", "Authentication required.");
  }

  // ---- 1b. Rate limit: PDF renders are expensive (pdfkit on main thread). ----
  const ip = getClientIp(req);
  const rl = rateLimitComposite({ scope: "evidence-pdf", ip, tenantId: session.tenantId, max: 5 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } },
    );
  }

  // ---- 2. Path-param validation. ----
  const { file } = await ctx.params;
  if (!ASSESSMENT_PATTERN.test(file)) {
    log.warn({ msg: "evidence.pdf.invalid_assessment", file });
    return fail("invalid_input", "Invalid assessment number.");
  }
  const assessmentNumber = file;

  // ---- 3. Tenant scoping: cross-tenant returns 404 (not 403). ----
  const assetTenant = tenantFromAssessmentNumber(assessmentNumber);
  if (!assetTenant) {
    // Assessment number has no recognisable tenant prefix — treat as not found.
    return fail("not_found", `Evidence pack for ${assessmentNumber} not found.`);
  }
  if (!sessionMayAccessTenant(session, assetTenant)) {
    log.warn({
      msg: "evidence.pdf.cross_tenant_blocked",
      userId: session.userId,
      sessionTenant: session.tenantId,
      assessmentTenant: assetTenant,
    });
    return fail("not_found", `Evidence pack for ${assessmentNumber} not found.`);
  }

  // ---- 4. Build the pack (per-tenant context: E3 isolation). ----
  // Scope to the ASSET's tenant, not the session's: access was already
  // authorised by sessionMayAccessTenant above, and a platform_admin
  // reading a TPS asset needs the TPS context — while the context itself
  // still only ever contains ONE tenant's data (never the global
  // cross-tenant snapshot that could leak wrong-council records into a
  // statutory PDF).
  const evalCtx = await getEvaluationContextForTenant(
    assetTenant ?? session.tenantId,
  );
  const result = buildEvidencePack(assessmentNumber, evalCtx);
  if (result.kind !== "ok") {
    log.info({
      msg: "evidence.pdf.no_pack",
      assessmentNumber,
      reason: result.kind,
    });
    if (result.kind === "no_owner") {
      return NextResponse.json(
        { ok: false, code: "owner_missing", error: "No owner record found for this property. Reconcile the owner table before generating a statutory PDF." },
        { status: 422 },
      );
    }
    if (result.kind === "no_state_template") {
      return NextResponse.json(
        { ok: false, code: "jurisdiction_unsupported", error: `State '${result.state}' is not yet supported for PDF generation.`, supportedStates: ["WA"] },
        { status: 501 },
      );
    }
    return fail("not_found", `Evidence pack for ${assessmentNumber} not available.`);
  }
  const pack = result.pack;

  // ---- 5. Resolve council display name + build the live evidence URL. ----
  // F-001 (also applies here): bind the letterhead to the ASSET's tenant, not
  // the actor's session tenant, so a platform_admin reading another council's
  // asset renders that council's letterhead — matching the receipt binding.
  const pdfTenant = assetTenant ?? session.tenantId;
  const council = COUNCILS.find((c) => c.code === pdfTenant);
  const councilName = council?.name ?? pdfTenant;

  // Live evidence URL is the .html download served by the sibling route.
  // We build an absolute URL so the QR can be scanned from a printed
  // copy. Falls back to the request's host header when no env-configured
  // origin is set (dev mode).
  const evidenceUrl = buildEvidenceUrl(req, assessmentNumber);

  // ---- 6. Render (with a cryptographic integrity ref in the footer). ----
  // The identity HMAC + footer ref are computed BEFORE render so the ref can
  // be drawn into the document; the full byte-hash receipt is computed AFTER
  // render and stored in the audit log for /api/verify/pack to confirm.
  //
  // Tenant binding uses the ASSET tenant (the council whose document this is),
  // not the actor's session tenant. For a normal officer these are identical;
  // for a platform_admin generating a doc for another council they differ, and
  // the public verify endpoint can only derive the tenant from the docId's
  // council prefix — so the receipt MUST live under that tenant or an
  // admin-generated document would fail verification. assetTenant is
  // guaranteed non-null here (the tenant gate above rejects a null prefix).
  const receiptTenant = assetTenant ?? session.tenantId;
  const generatedAt = new Date().toISOString();
  const identity: PdfIdentity = {
    tenantId: receiptTenant,
    docId: pack.packId,
    userId: session.userId,
    timestamp: generatedAt,
  };
  const { ref: integrityRef } = pdfIdentityHmac(identity);

  let pdf: Buffer;
  try {
    pdf = await renderEvidencePdf({
      pack,
      councilName,
      operatorName: session.displayName,
      evidenceUrl,
      integrityRef,
    });
  } catch (e) {
    log.error({
      msg: "evidence.pdf.render_failed",
      assessmentNumber,
      error: e instanceof Error ? e.message : String(e),
    });
    return fail("internal_error", "PDF render failed.");
  }

  const receipt = pdfIntegrityReceipt(identity, pdf);

  // ---- 7. Persist the integrity receipt — best-effort. ----
  // Recorded under the ASSET tenant (see receiptTenant above) so the receipt
  // is collocated with the council whose document it is and is findable by
  // the public verify endpoint. Persists to the DURABLE shared store when a
  // DB is wired (RA-L3-01) so verification works across ECS tasks, plus the
  // in-memory audit-trail event. actorId still attributes the real operator.
  await persistPdfReceipt({
    tenantCode: receiptTenant,
    actorId: session.userId,
    docType: "evidence_pack",
    action: "pdf.generated",
    docId: pack.packId,
    assessmentNumber,
    operatorName: session.displayName,
    generatedAt,
    pdfSha256: receipt.sha256,
    pdfHmac: receipt.hmac,
    correlationId,
    ip: getClientIp(req),
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  log.info({
    msg: "evidence.pdf.served",
    assessmentNumber,
    packId: pack.packId,
    bytes: pdf.length,
    userId: session.userId,
    tenantId: session.tenantId,
  });

  // Convert the Node Buffer into a Uint8Array view for NextResponse — the
  // global response constructor in the Edge-compatible runtime types
  // doesn't accept Node Buffer directly under strict TS, even though it
  // works at runtime.
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${pack.packId}.pdf"`,
      "cache-control": "private, no-store",
      "x-correlation-id": correlationId,
    },
  });
}

/**
 * Build an absolute URL to the live HTML evidence pack. The QR encodes
 * this string so a printed copy can be scanned back to the running
 * RatesAssist instance.
 *
 * Order of preference:
 *   1. `RA_PUBLIC_ORIGIN` env var (production / staging — explicit).
 *   2. `req.nextUrl.origin` (Next constructs this from the headers).
 *   3. The fallback `http://localhost:3000`.
 *
 * F-014 mitigation (Wave 3 pen-test). Behind a misconfigured reverse
 * proxy, `req.nextUrl.origin` reflects the inbound `Host` header — an
 * attacker who controls Host could redirect the QR code to a phishing
 * site. In production we REFUSE to fall back to `nextUrl.origin` and
 * throw instead; the route handler renders a 500 and the operator is
 * forced to configure `RA_PUBLIC_ORIGIN` explicitly. Dev/test still
 * fall back to `nextUrl.origin || localhost` so local workflows work.
 */
function buildEvidenceUrl(req: NextRequest, assessmentNumber: string): string {
  const envOrigin = process.env["RA_PUBLIC_ORIGIN"];
  if (envOrigin && envOrigin.length > 0) {
    return `${envOrigin.replace(/\/$/, "")}/api/evidence/${assessmentNumber}.html`;
  }
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "evidencePdf: RA_PUBLIC_ORIGIN is required in production (F-014 lockdown). " +
        "Set it to the canonical public URL of this deployment.",
    );
  }
  const origin = req.nextUrl.origin || "http://localhost:3000";
  return `${origin}/api/evidence/${assessmentNumber}.html`;
}
