/**
 * Liveness probe.
 *
 * Always returns 200 with a fixed shape. NO external deps — used by load
 * balancers / orchestrators. If this endpoint can answer, the process is
 * alive. Readiness (dependencies healthy?) lives at /api/ready.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({
    ok: true,
    name: "ratesassist-web",
    ts: new Date().toISOString(),
  });
}
