/**
 * /api/data — recovery snapshot for the web app.
 *
 * PAYLOAD CHANGE (PERF-007): historically this endpoint shipped the full
 * PROPERTIES, OWNERS and TENEMENTS arrays alongside the recovery
 * mismatches + stats. The recovery page only needs `mismatches` + `stats`
 * + `councils`, so the heavy arrays are now opt-in via
 * `?include=properties,owners,tenements`. Other consumers (e.g. property
 * detail pages) should fetch via dedicated endpoints; if any consumer
 * legitimately needs the bulk data, request the include list explicitly.
 *
 * PERF-001: a single `findMismatches(ctx)` sweep now feeds both the
 * response payload and the stats aggregate (`recoveryStatsFor`). Previously
 * the route ran the sweep, then `recoveryStatsForWeb()` ran it a second
 * time internally.
 */

import { NextResponse } from "next/server";
import { findMismatches } from "@ratesassist/recovery-engine";
import { COUNCILS, OWNERS, PROPERTIES, TENEMENTS } from "@/lib/data";
import { getEvaluationContext, recoveryStatsFor } from "@/lib/clients";

export const runtime = "nodejs";

type IncludeKey = "properties" | "owners" | "tenements";

function parseInclude(param: string | null): ReadonlySet<IncludeKey> {
  if (param === null || param.length === 0) return new Set();
  const allowed: ReadonlySet<IncludeKey> = new Set([
    "properties",
    "owners",
    "tenements",
  ]);
  const result = new Set<IncludeKey>();
  for (const raw of param.split(",")) {
    const v = raw.trim().toLowerCase();
    if ((allowed as ReadonlySet<string>).has(v)) {
      result.add(v as IncludeKey);
    }
  }
  return result;
}

export async function GET(req: Request) {
  const ctx = getEvaluationContext();
  const mismatches = findMismatches(ctx);
  const stats = recoveryStatsFor(mismatches);

  const include = parseInclude(new URL(req.url).searchParams.get("include"));

  return NextResponse.json({
    councils: COUNCILS,
    mismatches,
    stats,
    ...(include.has("properties") ? { properties: PROPERTIES } : {}),
    ...(include.has("owners") ? { owners: OWNERS } : {}),
    ...(include.has("tenements") ? { tenements: TENEMENTS } : {}),
  });
}
