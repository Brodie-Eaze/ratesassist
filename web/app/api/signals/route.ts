import { NextResponse } from "next/server";
import { SIGNAL_CATALOGUE, recoveryStats } from "@/lib/recovery";

export const runtime = "nodejs";

export async function GET() {
  const stats = recoveryStats();
  return NextResponse.json({
    catalogue: SIGNAL_CATALOGUE,
    contributionByCandidate: stats.signalCounts,
  });
}
