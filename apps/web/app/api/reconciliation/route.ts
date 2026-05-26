/**
 * GET /api/reconciliation — per-tenant bank-deposit reconciliation feed.
 *
 * Pen-test F-008b (ship-ready iter3) flagged that the prior shape served
 * the full cross-tenant `BANK_DEPOSITS` array on a bare GET with NO
 * session check and NO scoping — a TPS clerk could read every council's
 * bank-deposit feed. The flow is high-value: it carries amounts,
 * receivable IDs, and council-side reconciliation matches that a
 * competitor (or a council-side adversary in a parallel tenant) could
 * use to reverse-engineer rate collection patterns.
 *
 * This handler now:
 *
 *   1. Requires a verified session via `resolveRouteSession`.
 *   2. Filters `BANK_DEPOSITS` to the rows whose owning tenant matches
 *      the caller's session. The seed fixtures use mixed key names
 *      (`councilCode` from TechOne-style imports, `tenantId` from the
 *      demo path, the bare `council` on a couple of older rows) — we
 *      accept any of the three and treat the FIRST hit as authoritative.
 *   3. Lets `platform_admin` read everything — needed for cross-tenant
 *      reconciliation reports.
 */

import { NextResponse } from "next/server";
import { BANK_DEPOSITS } from "@/lib/data";
import { resolveRouteSession } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await resolveRouteSession(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, code: "unauthorized", message: "Authentication required." },
      { status: 401 },
    );
  }

  const isPlatformAdmin = session.roles.includes("platform_admin");

  const scopedDeposits = isPlatformAdmin
    ? BANK_DEPOSITS
    : BANK_DEPOSITS.filter((d) => {
        const row = d as Record<string, unknown>;
        const owningTenant =
          (typeof row.councilCode === "string" ? row.councilCode : null) ??
          (typeof row.tenantId === "string" ? row.tenantId : null) ??
          (typeof row.council === "string" ? row.council : null);
        // Fail-closed: rows with no identifiable owning tenant never
        // leave the platform_admin scope.
        return owningTenant === session.tenantId;
      });

  return NextResponse.json({ deposits: scopedDeposits });
}
