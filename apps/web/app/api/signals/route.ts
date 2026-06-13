import { NextResponse, type NextRequest } from "next/server";
import { SIGNAL_CATALOGUE } from "@ratesassist/recovery-engine";
import { recoveryStatsForWeb } from "@/lib/clients";
import { fail, resolveRouteSession } from "@/lib/api-helpers";
import { getClientIp, rateLimitComposite, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // `signalCounts` aggregates over the recovery candidate set. Require a
  // session and scope the counts to the caller's council unless platform_admin
  // — otherwise a single-council officer sees signal density derived from
  // every council's candidates. SIGNAL_CATALOGUE is static signal metadata,
  // safe for any authenticated session.
  const session = await resolveRouteSession(req);
  if (session === null) {
    return fail("unauthorized", "Authentication required.");
  }
  const ip = getClientIp(req);
  const rl = rateLimitComposite({ scope: "signals", ip, tenantId: session.tenantId, max: 30 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } }
    );
  }
  const isAdmin = session.roles.includes("platform_admin");
  const stats = isAdmin
    ? recoveryStatsForWeb()
    : recoveryStatsForWeb(session.tenantId);
  return NextResponse.json({
    catalogue: SIGNAL_CATALOGUE,
    contributionByCandidate: stats.signalCounts,
  });
}
