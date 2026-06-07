/**
 * GET /api/imagery/sentinel-freshness
 *
 * Returns the acquisition date and cloud-cover percentage of the most recent
 * Sentinel-2 scene over Western Australia, sourced from the Esri Living Atlas
 * Sentinel-2 ImageServer.
 *
 * This endpoint is used by the map toolbar's imagery-currency badge to display
 * a REAL acquisition date ("Acquired yesterday · 10m · 0.4% cloud") rather
 * than the static "~14-day cadence" fallback label.
 *
 * Implementation:
 *   1. Query the Esri ImageServer `/query` endpoint, filtered to the WA bbox,
 *      ordered by `acquisitionDate DESC`, `resultRecordCount=1`.
 *   2. Cache the response process-locally for 1 hour (Esri updates daily, so
 *      sub-hour polling is wasteful). Cache-Control headers let CDN/browser
 *      also cache for 1 hour.
 *   3. On any upstream failure, return 502 with an `error` field — callers
 *      fall back to the static label gracefully (no hard failure path).
 *
 * No auth required — imagery freshness is not PII. No tenant scope applies.
 *
 * Response shape (200):
 *   { ok: true, data: { acquiredAt: string; daysAgo: number; cloudCoverPercent: number | null } }
 *
 * Error shape (502):
 *   { ok: false, code: "upstream_error", message: string }
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ===== Constants =====

const ESRI_QUERY_URL =
  "https://sentinel.arcgis.com/arcgis/rest/services/Sentinel2/ImageServer/query";

// WA bounding box in ESRI Envelope format (GeoJSON / WGS-84 order).
// Covers mainland WA, Kimberley, and the Great Australian Bight coastline.
const WA_BBOX_GEOM = JSON.stringify({
  xmin: 112.9,
  ymin: -35.2,
  xmax: 129.0,
  ymax: -13.7,
  spatialReference: { wkid: 4326 },
});

const TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ===== Types =====

interface FreshnessData {
  /** ISO-8601 timestamp of the most recent scene's acquisition. */
  readonly acquiredAt: string;
  /** Days between acquisition and now (floor). */
  readonly daysAgo: number;
  /** Cloud-cover percentage (0–100), or null if the field was absent. */
  readonly cloudCoverPercent: number | null;
}

/**
 * Esri returns field names lower-cased in the JSON response even when the
 * service defines them in camelCase. Accept both spellings.
 */
interface EsriAttributes {
  acquisitiondate?: number;
  acquisitionDate?: number;
  cloudcover?: number;
  cloudCover?: number;
}

interface EsriQueryResponse {
  features?: Array<{ attributes: EsriAttributes }>;
  error?: { code: number; message: string };
}

// ===== Process-local cache =====

let _cache: { readonly data: FreshnessData; readonly ts: number } | null = null;

// ===== Handler =====

export async function GET(_req: NextRequest): Promise<NextResponse> {
  // Serve from process-local cache when still fresh.
  if (_cache !== null && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(
      { ok: true, data: _cache.data },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=300" } },
    );
  }

  const params = new URLSearchParams({
    where: "1=1",
    outFields: "acquisitionDate,cloudCover",
    orderByFields: "acquisitionDate DESC",
    resultRecordCount: "1",
    geometry: WA_BBOX_GEOM,
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    f: "json",
  });

  try {
    const res = await fetch(`${ESRI_QUERY_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, code: "upstream_error", message: `Esri HTTP ${res.status}` },
        { status: 502 },
      );
    }

    const body = (await res.json()) as EsriQueryResponse;

    if (body.error) {
      return NextResponse.json(
        {
          ok: false,
          code: "upstream_error",
          message: `Esri error ${body.error.code}: ${body.error.message}`,
        },
        { status: 502 },
      );
    }

    const attrs = body.features?.[0]?.attributes;
    if (!attrs) {
      return NextResponse.json(
        { ok: false, code: "upstream_error", message: "no features returned" },
        { status: 502 },
      );
    }

    // Accept both camelCase and lowercase field name variants.
    const tsMs = attrs.acquisitiondate ?? attrs.acquisitionDate ?? null;
    const cc = attrs.cloudcover ?? attrs.cloudCover ?? null;

    if (tsMs === null) {
      return NextResponse.json(
        { ok: false, code: "upstream_error", message: "acquisitionDate field missing" },
        { status: 502 },
      );
    }

    const acquiredAt = new Date(tsMs).toISOString();
    const daysAgo = Math.floor((Date.now() - tsMs) / (1_000 * 60 * 60 * 24));
    // cc is a fraction (0.0035 = 0.35%) — round to 1 decimal place.
    const cloudCoverPercent = cc !== null ? Math.round(cc * 100 * 10) / 10 : null;

    const data: FreshnessData = { acquiredAt, daysAgo, cloudCoverPercent };
    _cache = { data, ts: Date.now() };

    return NextResponse.json(
      { ok: true, data },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=300" } },
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "fetch failed";
    return NextResponse.json(
      { ok: false, code: "upstream_error", message },
      { status: 502 },
    );
  }
}
