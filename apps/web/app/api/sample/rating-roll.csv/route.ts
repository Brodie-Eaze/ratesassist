/**
 * GET /api/sample/rating-roll.csv — built-in 30-row sample rating roll.
 *
 * Served verbatim from `scripts/sample-rating-roll.csv`. Used by the
 * onboarding wizard's "Download sample" affordance so a council clerk can
 * always grab a reference file in the expected shape.
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  // Resolve relative to the monorepo root regardless of where Next.js boots.
  const candidates = [
    join(process.cwd(), "scripts", "sample-rating-roll.csv"),
    join(process.cwd(), "..", "..", "scripts", "sample-rating-roll.csv"),
  ];
  let body: string | undefined;
  for (const p of candidates) {
    try {
      body = await readFile(p, "utf8");
      break;
    } catch {
      // try next candidate
    }
  }
  if (body === undefined) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: "sample CSV not found" },
      { status: 404 },
    );
  }
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="sample-rating-roll.csv"',
      "cache-control": "no-store",
    },
  });
}
