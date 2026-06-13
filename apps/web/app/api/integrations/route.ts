import { NextResponse, type NextRequest } from "next/server";
import { INTEGRATIONS } from "@/lib/data";
import { fail, resolveRouteSession } from "@/lib/api-helpers";

export const runtime = "nodejs";

/**
 * Rating-system integration cards are per-council: their id carries a
 * council-code suffix (e.g. `techone-tps`, `civica-brk`). Every other card
 * (DMIRS, Landgate, Nearmap, ATO, ASIC, Twilio, Stripe, observability, …) is
 * statewide / global infrastructure shared by all tenants. A non-admin
 * officer must only see their OWN council's rating-system row plus the shared
 * infrastructure — not which rating platform/endpoint another council runs.
 */
function isForeignCouncilIntegration(id: string, tenantCode: string): boolean {
  const m = id.match(/^(?:techone|civica)-([a-z]{2,5})$/);
  return m !== null && m[1].toUpperCase() !== tenantCode;
}

export async function GET(req: NextRequest) {
  const session = await resolveRouteSession(req);
  if (session === null) {
    return fail("unauthorized", "Authentication required.");
  }
  const isAdmin = session.roles.includes("platform_admin");
  const integrations = isAdmin
    ? INTEGRATIONS
    : INTEGRATIONS.filter(
        (i) => !isForeignCouncilIntegration(i.id, session.tenantId),
      );
  return NextResponse.json({ integrations });
}
