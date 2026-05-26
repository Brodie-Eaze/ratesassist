/**
 * GET /api/owners/[ownerId] — full owner record + portfolio.
 *
 * Owner field comes from `get_owner`. Portfolio (the properties this
 * owner appears against) is derived from the in-process evaluation
 * context's per-owner index — same data the recovery engine uses.
 *
 * `abnCheck` is whatever the upstream record carries today; this route
 * does NOT trigger a live ABN lookup (that would be a `verify_abn` tool
 * call and is left to explicit caller intent).
 */

import type { NextRequest } from "next/server";

import { runTool } from "@/lib/tools";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ ownerId: string }> },
): Promise<Response> {
  const session = await resolveRouteSession(req);
  if (!session) {
    return fail("unauthorized", "Authentication required.");
  }

  const { ownerId: encoded } = await ctx.params;
  const ownerId = decodeURIComponent(encoded);

  const result = await runTool("get_owner", { ownerId });
  if (!result.ok) {
    if (result.code === "not_found") {
      return fail("not_found", `Owner ${ownerId} not found.`);
    }
    if (result.code === "invalid_input") {
      return fail("invalid_input", result.error ?? "Invalid owner id.");
    }
    return fail("upstream_error", result.error ?? "get_owner failed", 502);
  }

  const data = (result.data ?? {}) as { owner?: unknown };
  const owner = data.owner;

  // Portfolio — properties this owner is on.
  const evalCtx = getEvaluationContext();
  const portfolio = evalCtx.propertiesByOwnerId?.get(ownerId) ?? [];

  // F-002 mitigation for owners: owner IDs are state-scoped (`O-WA-001`),
  // not tenant-scoped, so the assessment-prefix shortcut used elsewhere
  // doesn't apply directly. Instead, derive the owner's accessible
  // tenants from the portfolio — if NONE of their properties are in
  // the session's tenant, refuse. 404 to avoid being an enumeration
  // oracle. Platform admins bypass via sessionMayAccessTenant.
  const accessibleByPortfolio = portfolio.some(
    (p: { assessmentNumber: string }) =>
      sessionMayAccessTenant(
        session,
        tenantFromAssessmentNumber(p.assessmentNumber),
      ),
  );
  if (!accessibleByPortfolio && !session.roles.includes("platform_admin")) {
    return fail("not_found", `Owner ${ownerId} not found.`);
  }

  const isPlatformAdmin = session.roles.includes("platform_admin");

  // Scope the portfolio response to only properties the session can
  // see, so platform-admin reads still get the whole portfolio but
  // a regular council_admin only sees their tenant's rows.
  const scopedPortfolio = isPlatformAdmin
    ? portfolio
    : portfolio.filter((p: { assessmentNumber: string }) =>
        sessionMayAccessTenant(
          session,
          tenantFromAssessmentNumber(p.assessmentNumber),
        ),
      );

  // F-008 follow-up (council code-review iter3, confidence 80):
  // owners carry a SINGLE `email` / `phone` / `postalAddress` /
  // `mobilePhone` field, not per-tenant variants. When an owner
  // appears in multiple tenants (a small fraction in the seed data;
  // realistic at scale), a TPS clerk reading the record receives the
  // owner's KAL-side contact data because there's nowhere to scope
  // it. The proper fix is a schema change to per-tenant contact
  // (iter4 — see internal/PHASE-1B-DATA-MODEL.md). Until then we
  // redact the contact fields whenever the owner spans tenants the
  // current session cannot see. Platform-admins bypass — they
  // legitimately need everything for support workflows.
  //
  // The owner's NAME, ABN, and ownerId are NOT redacted — those are
  // identity fields that the council legitimately needs to confirm
  // they're looking at the right person. Contact-method-only
  // redaction is the minimum-disclosure shape.
  const ownerSpansMultipleTenants = (() => {
    const tenants = new Set<string>();
    for (const p of portfolio) {
      const t = tenantFromAssessmentNumber(
        (p as { assessmentNumber: string }).assessmentNumber,
      );
      if (t !== null) tenants.add(t);
    }
    return tenants.size > 1;
  })();

  const redactContactPII =
    !isPlatformAdmin && ownerSpansMultipleTenants;

  const scopedOwner = redactContactPII
    ? {
        ...(owner as Record<string, unknown>),
        email: undefined,
        phone: undefined,
        mobilePhone: undefined,
        postalAddress: undefined,
        // Hint to the UI that contact fields are intentionally redacted,
        // not "data missing". Lets the client render an explanation
        // instead of an empty cell.
        contactRedacted: true,
        contactRedactedReason: "shared_owner_cross_tenant",
      }
    : owner;

  const payload = {
    owner: scopedOwner,
    portfolio: scopedPortfolio,
    abnCheck: (owner as { abnCheck?: unknown } | undefined)?.abnCheck ?? {
      kind: "unchecked" as const,
    },
  };

  const etag = weakEtag(payload);
  const notModified = maybeNotModified(req, etag);
  if (notModified !== null) return notModified;

  return ok(payload, {
    headers: { etag, "cache-control": "private, max-age=60" },
  });
}
