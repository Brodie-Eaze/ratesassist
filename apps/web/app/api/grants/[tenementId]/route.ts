/**
 * GET /api/grants/[tenementId] — single-grant briefing.
 *
 * Path param is the percent-encoded raw tenid (e.g. `M%20%204701569`).
 * Wraps the `get_grant_detail` MCP tool so the /alerts/[tenementId] page
 * can fetch the joined record without going through the LLM.
 */

import { NextRequest, NextResponse } from "next/server";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ tenementId: string }> },
) {
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

  const result = await runTool("get_grant_detail", { tenementId, sinceDays });

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
