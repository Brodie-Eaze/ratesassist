/**
 * GET /api/recovery/lag-window — DMIRS-ahead-of-Landgate lag candidates.
 *
 * Wraps the `list_lag_window_candidates` MCP tool so the recovery dashboard
 * can pull the headline cross-register signal without going through the LLM.
 * Honest source labelling is preserved end-to-end.
 *
 * Query params:
 *   ?sinceDays=90                 (1–365, default 90)
 *   ?minSeverity=high|medium|low  (default medium)
 *   ?lgaName=Karratha             (optional substring hint)
 *   ?limit=N                      (1–200, default 50)
 *   ?offset=M                     (>=0, default 0)
 */

import { NextRequest, NextResponse } from "next/server";
import { runTool } from "@/lib/tools";
import { fail, resolveRouteSession } from "@/lib/api-helpers";
import { COUNCILS } from "@/lib/data";
import { getClientIp, rateLimitComposite, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SEVERITY = new Set(["high", "medium", "low"]);

export async function GET(req: NextRequest) {
  const session = await resolveRouteSession(req);
  if (session === null) return fail("unauthorized", "Authentication required.");

  const ip = getClientIp(req);
  const rl = rateLimitComposite({ scope: "lag-window", ip, tenantId: session.tenantId, max: 20 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } }
    );
  }

  const { searchParams } = req.nextUrl;
  const sinceDaysRaw = searchParams.get("sinceDays");
  const sinceDays = sinceDaysRaw === null ? 90 : Number(sinceDaysRaw);
  const minSeverityRaw = (searchParams.get("minSeverity") ?? "medium").toLowerCase();
  const lgaName = searchParams.get("lgaName") ?? undefined;
  const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") ?? "50")));
  const offset = Math.max(0, Number(searchParams.get("offset") ?? "0"));

  if (!Number.isFinite(sinceDays) || sinceDays < 1 || sinceDays > 365) {
    return NextResponse.json(
      { ok: false, code: "invalid_input", error: "sinceDays must be 1..365" },
      { status: 400 },
    );
  }
  if (!VALID_SEVERITY.has(minSeverityRaw)) {
    return NextResponse.json(
      { ok: false, code: "invalid_input", error: "minSeverity must be high|medium|low" },
      { status: 400 },
    );
  }

  // B1: tenant-scope what can be scoped. The lag-window dataset is statewide
  // public data (DMIRS grants × cadastre — same class as the grants export),
  // so there is no per-tenant row filter; instead we (a) default the LGA
  // hint to the caller's own council when none was supplied, and (b)
  // attribute the dispatch to the session so the audit trail records WHO
  // pulled the cross-register view.
  const sessionCouncil = COUNCILS.find((c) => c.code === session.tenantId);
  const effectiveLgaName =
    lgaName ??
    (session.roles.includes("platform_admin") ? undefined : sessionCouncil?.name);

  const input: Record<string, unknown> = {
    sinceDays,
    minSeverity: minSeverityRaw,
  };
  if (effectiveLgaName !== undefined) input.lgaName = effectiveLgaName;

  const result = await runTool("list_lag_window_candidates", input, undefined, {
    tenantId: session.tenantId,
    actorId: session.userId,
    actorKind: "user",
    ip,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: result.code ?? "upstream_error",
        error: result.error ?? "list_lag_window_candidates failed",
      },
      { status: 502 },
    );
  }

  const data = result.data as
    | {
        candidates: unknown[];
        source: string;
        queriedAt: string;
        sinceDays: number;
        minSeverity: string;
        note?: string;
      }
    | null;
  const allCandidates = Array.isArray(data?.candidates) ? data!.candidates : [];
  const page = allCandidates.slice(offset, offset + limit);

  return NextResponse.json({
    ok: true,
    data: {
      candidates: page,
      source: data?.source ?? "seeded",
      queriedAt: data?.queriedAt,
      sinceDays: data?.sinceDays ?? sinceDays,
      minSeverity: data?.minSeverity ?? minSeverityRaw,
      ...(data?.note !== undefined ? { note: data.note } : {}),
    },
    pagination: {
      total: allCandidates.length,
      limit,
      offset,
    },
    output: result.output,
  });
}
