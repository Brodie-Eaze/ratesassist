import { NextResponse } from "next/server";
import { COUNCILS, OWNERS, PROPERTIES, TENEMENTS } from "@/lib/data";
import { findMismatches, recoveryStats } from "@/lib/recovery";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    councils: COUNCILS,
    properties: PROPERTIES,
    owners: OWNERS,
    tenements: TENEMENTS,
    mismatches: findMismatches(),
    stats: recoveryStats(),
  });
}
