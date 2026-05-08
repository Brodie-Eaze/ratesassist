import { NextRequest, NextResponse } from "next/server";
import { fetchSlipFeatures, SLIP_LAYERS } from "@/lib/spatial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: Array<keyof typeof SLIP_LAYERS> = [
  "miningTenements",
  "cadastre",
];

/**
 * Spatial proxy: fetch live GeoJSON polygons from SLIP ArcGIS REST.
 *
 * GET /api/spatial/miningTenements?bbox=minLng,minLat,maxLng,maxLat
 * GET /api/spatial/cadastre?bbox=...
 *
 * Returns FeatureCollection-ish: { ok, source, features, queriedAt }
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ layer: string }> },
) {
  const { layer } = await ctx.params;
  if (!ALLOWED.includes(layer as keyof typeof SLIP_LAYERS)) {
    return NextResponse.json({ ok: false, error: "unknown layer" }, { status: 400 });
  }

  const bboxRaw = req.nextUrl.searchParams.get("bbox");
  if (!bboxRaw) {
    return NextResponse.json({ ok: false, error: "bbox required" }, { status: 400 });
  }
  const parts = bboxRaw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !isFinite(n))) {
    return NextResponse.json(
      { ok: false, error: "bbox must be minLng,minLat,maxLng,maxLat" },
      { status: 400 },
    );
  }

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);

  const result = await fetchSlipFeatures(layer as keyof typeof SLIP_LAYERS, parts, {
    maxFeatures: Math.min(500, Math.max(10, limit)),
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=300",
    },
  });
}
