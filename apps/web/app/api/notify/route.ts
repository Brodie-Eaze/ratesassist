/**
 * POST /api/notify
 *
 * Dispatches an email notification to a council clerk via the
 * `notify_clerk` MCP tool. Provider matrix lives in lib/notifier.ts; the
 * default console transport logs but does not send.
 *
 * RBAC: `write.draft_mutation` (rates_officer and above). Ratepayer is
 * denied. Honest framing: production wiring requires Resend / SendGrid /
 * SMTP credentials configured via RA_NOTIFY_PROVIDER + RA_NOTIFY_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  fail,
  ok,
  sessionMayAccessTenant,
  tenantFromAssessmentNumber,
} from "@/lib/api-helpers";
import { getSessionFromRequest, hasPermission } from "@/lib/auth";
import { scoped } from "@/lib/logger";
import { getClientIp } from "@/lib/rate-limit";
import { runTool } from "@/lib/tools";
import { correlationIdFromHeaders } from "@/lib/correlation";
import { captureCrossTenantRefused } from "@/lib/sentry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  recipientEmail?: string;
  subject?: string;
  candidateAssessmentNumber?: string;
  severity?: "high" | "medium" | "low";
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const correlationId = correlationIdFromHeaders(req.headers);
  const log = scoped("api/notify", { correlationId });

  const session = getSessionFromRequest(req);
  if (!session) return fail("unauthorized", "session required", 401);
  if (!hasPermission(session, "write.draft_mutation")) {
    log.warn({ msg: "notify.forbidden", userId: session.userId, roles: session.roles });
    return fail("forbidden", "write.draft_mutation permission required", 403);
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return fail("invalid_input", "request body must be JSON");
  }

  const { recipientEmail, subject, candidateAssessmentNumber, severity } = body;
  if (
    typeof recipientEmail !== "string" ||
    typeof subject !== "string" ||
    typeof candidateAssessmentNumber !== "string"
  ) {
    return fail(
      "invalid_input",
      "recipientEmail, subject, and candidateAssessmentNumber are required",
    );
  }

  // Defence-in-depth tenant scope. The assessment number embeds its owning
  // council (e.g. KAL-4401-12 → KAL). An officer bound to council A must not
  // fire a clerk notification about council B's candidate — even though the
  // discovery + export scoping already stops them enumerating foreign
  // assessment numbers. platform_admin bypasses for cross-tenant ops. Masked
  // as 404 so this endpoint can't be an existence oracle for assessment
  // numbers on other tenants.
  const assetTenant = tenantFromAssessmentNumber(candidateAssessmentNumber);
  if (!sessionMayAccessTenant(session, assetTenant)) {
    log.warn({
      msg: "notify.cross_tenant_refused",
      userId: session.userId,
      sessionTenant: session.tenantId,
      attemptedAssessment: candidateAssessmentNumber,
    });
    captureCrossTenantRefused({
      actorId: session.userId,
      sessionTenant: session.tenantId,
      attemptedTenant: assetTenant ?? "unknown",
      route: "/api/notify",
    });
    return fail("not_found", "candidate not found");
  }

  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") ?? undefined;

  const result = await runTool(
    "notify_clerk",
    {
      recipientEmail,
      subject,
      candidateAssessmentNumber,
      ...(severity !== undefined ? { severity } : {}),
    },
    correlationId,
    {
      tenantId: session.tenantId,
      actorId: session.userId,
      actorKind: "user",
      ip,
      ...(userAgent !== undefined ? { userAgent } : {}),
    },
  );

  if (!result.ok) {
    return fail(
      (result.code as
        | "invalid_input"
        | "forbidden"
        | "not_found"
        | "internal_error") ?? "internal_error",
      result.error ?? "notify failed",
    );
  }

  return ok(result.data ?? {});
}
