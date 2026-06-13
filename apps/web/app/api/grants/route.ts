/**
 * GET /api/grants — recently-granted live mining tenements feed.
 *
 * Wraps the `list_recent_grants` MCP tool so the dashboard page can pull
 * grants without going through the LLM. Honest source labelling is
 * preserved: clients see `source: "live" | "seeded"` and any explanatory
 * note that the spatial layer attached.
 *
 * Query params:
 *   ?sinceDays=30       (1–365)
 *   ?lgaName=Karratha   (optional substring filter; applied client-side
 *                        in this route since the seeded fixture has no
 *                        LGA tagging — see grants.ts for the rationale)
 *   ?types=M,G,L        (optional CSV allow-list)
 */

import { NextRequest, NextResponse } from "next/server";
import { runTool } from "@/lib/tools";
import { fail, resolveRouteSession } from "@/lib/api-helpers";
import { getClientIp, rateLimitComposite, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await resolveRouteSession(req);
  if (session === null) return fail("unauthorized", "Authentication required.");

  const ip = getClientIp(req);
  const rl = rateLimitComposite({ scope: "grants", ip, tenantId: session.tenantId, max: 30 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } }
    );
  }

  const { searchParams } = req.nextUrl;
  const sinceDaysRaw = searchParams.get("sinceDays");
  const sinceDays = sinceDaysRaw === null ? 30 : Number(sinceDaysRaw);
  const lgaName = searchParams.get("lgaName") ?? undefined;
  const typesParam = searchParams.get("types");
  const types =
    typesParam === null
      ? undefined
      : typesParam.split(",").map((s) => s.trim()).filter((s) => s.length > 0);

  if (!Number.isFinite(sinceDays) || sinceDays < 1 || sinceDays > 365) {
    return NextResponse.json(
      { ok: false, code: "invalid_input", error: "sinceDays must be 1..365" },
      { status: 400 },
    );
  }

  const input: Record<string, unknown> = { sinceDays };
  if (types !== undefined && types.length > 0) input.types = types;
  if (lgaName !== undefined) input.lgaName = lgaName;

  const result = await runTool("list_recent_grants", input);

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: result.code ?? "upstream_error",
        error: result.error ?? "list_recent_grants failed",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: result.data ?? null,
    output: result.output,
  });
}
