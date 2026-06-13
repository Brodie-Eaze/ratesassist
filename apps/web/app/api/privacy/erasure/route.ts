/**
 * POST /api/privacy/erasure — right-to-be-forgotten (RTBF) / right-to-erasure.
 *
 * A council privacy officer (DPO delegate) triggers destruction of a data
 * subject's personal information under the *Privacy Act 1988 (Cth)* APP 11.2.
 * The route is a thin guard around {@link eraseOwnerData}; all the
 * shared-owner authorisation, idempotency, dual-store erasure, retention
 * carve-outs and tamper-evident auditing live in `lib/privacy-erasure.ts`.
 *
 * Contract
 * --------
 *   Body: { ownerId: string, legalBasis?: string, legalHold?: boolean }
 *   - `ownerId`    — state-scoped data-subject identifier, e.g. "O-WA-001".
 *   - `legalBasis` — optional free-text basis / privacy-officer ticket ref,
 *                    recorded on the audit row (never any erased value).
 *   - `legalHold`  — when true, the subject is under a statutory hold; the
 *                    service defers (409) and documents the conflict rather
 *                    than destroying (policy §4.3 step 3 / §7).
 *
 * Permission model (enforced in the service; see its header for the rationale):
 *   - Requires `write.user_management` (council_admin or platform_admin).
 *   - SHARED owner (appears in >1 council) → cross-tenant → platform_admin only.
 *   - SINGLE-council owner → that council's council_admin, own tenant only.
 *
 * Responses:
 *   200 { ok, erased, alreadyErased, tenantsAffected, shared, ownerId }
 *   401 unauthorized | 403 forbidden | 404 not_found | 409 conflict (hold)
 *   400 invalid_input | 500 internal_error
 */

import type { NextRequest } from "next/server";

import { NextResponse } from "next/server";

import { fail, ok, resolveRouteSession } from "@/lib/api-helpers";
import { eraseOwnerData } from "@/lib/privacy-erasure";
import { currentCorrelationId } from "@/lib/correlation";
import { getClientIp, rateLimitComposite, retryAfterSeconds } from "@/lib/rate-limit";
import { scoped } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = scoped("api.privacy.erasure");

export async function POST(req: NextRequest): Promise<Response> {
  const session = await resolveRouteSession(req);
  if (session === null) {
    return fail("unauthorized", "Authentication required.");
  }

  // A6-NEW-02: erasure is an irreversible audited mutation — tight limit.
  const rl = rateLimitComposite({
    scope: "privacy-erasure",
    ip: getClientIp(req),
    tenantId: session.tenantId,
    max: 3,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_input", "Body must be JSON.");
  }
  const b = (body ?? {}) as {
    ownerId?: unknown;
    legalBasis?: unknown;
    legalHold?: unknown;
  };
  if (typeof b.ownerId !== "string" || b.ownerId.trim().length === 0) {
    return fail("invalid_input", "ownerId (non-empty string) is required.");
  }
  if (b.legalBasis !== undefined && typeof b.legalBasis !== "string") {
    return fail("invalid_input", "legalBasis must be a string when provided.");
  }
  if (b.legalHold !== undefined && typeof b.legalHold !== "boolean") {
    return fail("invalid_input", "legalHold must be a boolean when provided.");
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;
  const correlationId = currentCorrelationId();

  const result = await eraseOwnerData({
    ownerId: b.ownerId.trim(),
    session,
    ...(b.legalBasis !== undefined ? { legalBasis: b.legalBasis } : {}),
    ...(b.legalHold !== undefined ? { legalHold: b.legalHold } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(ip !== undefined ? { ip } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
  });

  if (!result.ok) {
    log.warn({
      event: "erasure.refused",
      code: result.code,
      ownerId: b.ownerId,
      actor: session.userId,
    });
    return fail(result.code, result.message);
  }

  return ok({
    ownerId: result.ownerId,
    erased: result.erased,
    alreadyErased: result.alreadyErased,
    shared: result.shared,
    tenantsAffected: result.tenantsAffected,
  });
}
