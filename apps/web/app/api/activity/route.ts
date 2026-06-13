import { NextResponse, type NextRequest } from "next/server";
import { ACTIVITY } from "@/lib/data";
import { fail, resolveRouteSession } from "@/lib/api-helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // The activity log carries per-council operational events (overdue pulls,
  // ABN checks, evidence packs) tagged with their council. Require a session
  // and, for non-admins, show only the caller's own council plus statewide
  // system/auth events (council "—"). Cross-council aggregates (e.g. a
  // cross-council recovery summary, tagged "—" with category "recovery")
  // stay platform_admin-only.
  const session = await resolveRouteSession(req);
  if (session === null) {
    return fail("unauthorized", "Authentication required.");
  }
  const isAdmin = session.roles.includes("platform_admin");
  const activity = isAdmin
    ? ACTIVITY
    : ACTIVITY.filter(
        (e) =>
          e.council === session.tenantId ||
          (e.council === "—" &&
            (e.category === "system" || e.category === "auth")),
      );
  return NextResponse.json({ activity });
}
