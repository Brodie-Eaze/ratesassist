/**
 * GET /api/grants/[tenementId] — single-grant briefing.
 *
 * Path param is the percent-encoded raw tenid (e.g. `M%20%204701569`).
 * Wraps the `get_grant_detail` MCP tool so the /alerts/[tenementId] page
 * can fetch the joined record without going through the LLM.
 *
 * Auth: requires a session. The `get_grant_detail` payload embeds
 * council-registered parcel detail (assessment number, address, valuation,
 * annual rates, recovery uplift estimate) — commercially sensitive council
 * data, not anonymous-public. This matches the canonical successor route
 * `/api/tenements/[tenementId]`, which has always gated on `hasSession`;
 * this legacy alias was missed when that gate was added. Tenement records
 * themselves are public (DMIRS/MINEDEX), so the bar is "any authenticated
 * session" rather than tenant-scoped — consistent with the successor route.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveRouteSession } from "@/lib/api-helpers";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ tenementId: string }> },
) {
  const session = await resolveRouteSession(req);
  if (session === null) {
    return NextResponse.json(
      { ok: false, code: "unauthorized", error: "Authentication required." },
      { status: 401 },
    );
  }

  const { tenementId: encoded } = await ctx.params;
  const tenementId = decodeURIComponent(encoded);
  const sinceDaysRaw = req.nextUrl.searchParams.get("sinceDays");
  const sinceDays = sinceDaysRaw === null ? 90 : Number(sinceDaysRaw);

  if (!Number.isFinite(sinceDays) || sinceDays < 1 || sinceDays > 365) {
    return NextResponse.json(
      { ok: false, code: "invalid_input", error: "sinceDays must be 1..365" },
      { status: 400 },
    );
  }

  // Tenant scope: the tenement metadata is public (DMIRS/MINEDEX), but the
  // intersecting parcels carry commercially sensitive per-council valuation,
  // annual rates and recovery uplift. A council session must only see ITS OWN
  // parcels — inject the caller's tenant as the `council` filter. Omitting it
  // for platform_admin returns all councils' parcels.
  const councilScope = session.roles.includes("platform_admin")
    ? {}
    : { council: session.tenantId };
  const result = await runTool("get_grant_detail", {
    tenementId,
    sinceDays,
    ...councilScope,
  });

  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 502;
    return NextResponse.json(
      {
        ok: false,
        code: result.code ?? "upstream_error",
        error: result.error ?? "get_grant_detail failed",
      },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    data: result.data ?? null,
    output: result.output,
  });
}
