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
import { getEvaluationContextForTenant, getEvaluationContext } from "@/lib/clients";
import { correlationIdFromHeaders } from "@/lib/correlation";
import { renderEvidencePdf } from "@/lib/evidencePdf";
import { getClientIp } from "@/lib/rate-limit";
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

  // ---- 4. Build the pack. ----
  // E3: per-tenant SQL-scoped context, scoped to the ASSET's tenant
  // (not the session tenant). platform_admin sessions may carry an
  // arbitrary session.tenantId that doesn't match the asset; using
  // assetTenant ensures we load the right properties regardless of
  // which council the admin belongs to.
  const evalCtx = await getEvaluationContextForTenant(assetTenant);
  const result = buildEvidencePack(assessmentNumber, evalCtx);
  if (result.kind !== "ok") {
    log.info({
      msg: "evidence.pdf.no_pack",
      assessmentNumber,
      reason: result.kind,
    });
    return fail("not_found", `Evidence pack for ${assessmentNumber} not available.`);
  }
  const pack = result.pack;

  // ---- 5. Resolve council display name + build the live evidence URL. ----
  const council = COUNCILS.find((c) => c.code === session.tenantId);
  const councilName = council?.name ?? session.tenantId;

  // Live evidence URL is the .html download served by the sibling route.
  // We build an absolute URL so the QR can be scanned from a printed
  // copy. Falls back to the request's host header when no env-configured
  // origin is set (dev mode).
  const evidenceUrl = buildEvidenceUrl(req, assessmentNumber);

  // ---- 6. Render. ----
  let pdf: Buffer;
  try {
    pdf = await renderEvidencePdf({
      pack,
      councilName,
      operatorName: session.displayName,
      evidenceUrl,
    });
  } catch (e) {
    log.error({
      msg: "evidence.pdf.render_failed",
      assessmentNumber,
      error: e instanceof Error ? e.message : String(e),
    });
    return fail("internal_error", "PDF render failed.");
  }

  // ---- 7. Audit — best-effort, logged on failure. ----
  await writeAuditAsync({
    tenantId: session.tenantId,
    actorId: session.userId,
    correlationId,
    ip: getClientIp(req),
    userAgent: req.headers.get("user-agent") ?? undefined,
    packId: pack.packId,
    assessmentNumber,
    operatorName: session.displayName,
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
 * Best-effort audit write. The adapter-demo audit module is dynamically
 * imported to mirror the lazy-load pattern used elsewhere in apps/web
 * (mcp-client, tools). Failure is swallowed and logged — the audit
 * surface logs to stderr on its own; we don't want the audit write to
 * fail the PDF download.
 */
async function writeAuditAsync(args: {
  tenantId: string;
  actorId: string;
  correlationId: string;
  ip?: string;
  userAgent?: string;
  packId: string;
  assessmentNumber: string;
  operatorName: string;
}): Promise<void> {
  try {
    const audit = await import("@ratesassist/adapter-demo/audit");
    audit.recordMutation({
      tenantId: args.tenantId,
      actorId: args.actorId,
      actorKind: "user",
      action: "pdf.generated",
      target: { type: "evidence_pack", id: args.packId },
      after: {
        assessmentNumber: args.assessmentNumber,
        operatorName: args.operatorName,
      },
      correlationId: args.correlationId,
      ...(args.ip !== undefined ? { ip: args.ip } : {}),
      ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
    });
  } catch {
    // Audit failure is non-fatal — the audit module already writes a
    // structured stderr line on internal failure. We swallow here so
    // a missing module surface (e.g. when the route is exercised in
    // an environment where the adapter isn't bundled) doesn't 500
    // the PDF.
  }
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
