import { NextResponse } from "next/server";
import { SIGNAL_CATALOGUE } from "@ratesassist/recovery-engine";
import { recoveryStatsForWeb } from "@/lib/clients";

export const runtime = "nodejs";

export async function GET() {
  const stats = recoveryStatsForWeb();
  return NextResponse.json({
    catalogue: SIGNAL_CATALOGUE,
    contributionByCandidate: stats.signalCounts,
  });
}
