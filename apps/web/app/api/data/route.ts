import { NextResponse } from "next/server";
import { findMismatches } from "@ratesassist/recovery-engine";
import { COUNCILS, OWNERS, PROPERTIES, TENEMENTS } from "@/lib/data";
import { getEvaluationContext, recoveryStatsForWeb } from "@/lib/clients";

export const runtime = "nodejs";

export async function GET() {
  const ctx = getEvaluationContext();
  return NextResponse.json({
    councils: COUNCILS,
    properties: PROPERTIES,
    owners: OWNERS,
    tenements: TENEMENTS,
    mismatches: findMismatches(ctx),
    stats: recoveryStatsForWeb(),
  });
}
