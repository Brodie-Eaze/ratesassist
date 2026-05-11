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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SEVERITY = new Set(["high", "medium", "low"]);

export async function GET(req: NextRequest) {
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

  const input: Record<string, unknown> = {
    sinceDays,
    minSeverity: minSeverityRaw,
  };
  if (lgaName !== undefined) input.lgaName = lgaName;

  const result = await runTool("list_lag_window_candidates", input);
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
