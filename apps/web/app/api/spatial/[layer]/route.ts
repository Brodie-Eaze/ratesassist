import { NextRequest, NextResponse } from "next/server";
import {
  fetchSlipFeatures,
  type SlipLayerKey,
} from "@ratesassist/spatial";
import type { BoundingBox } from "@ratesassist/contract";
// A6-NEW-01: this route previously carried its OWN getClientIp that trusted
// x-forwarded-for unconditionally — an attacker could rotate the header to
// dodge the limiter (XFF spoofing). The shared helper only trusts XFF behind
// a known proxy (VERCEL=1 / RA_TRUSTED_PROXY=1), and the shared limiter
// keys per (scope, ip) in the common bucket map.
import { getClientIp, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: readonly SlipLayerKey[] = ["miningTenements", "cadastre"];

const RATE_LIMIT_MAX = 120;

// Allow-list of fields per layer that the UI (MapInner.tsx) actually consumes.
// Anything else is stripped before returning to the client to reduce surface
// area and avoid leaking attribute fields ArcGIS may add upstream.
const ALLOWED_FIELDS: Record<SlipLayerKey, readonly string[]> = {
  miningTenements: [
    "fmt_tenid", "tenid", "TENID", "TENEMENT_ID",
    "tenstatus", "STATUS", "status",
    "type", "TYPE",
    "holder1", "HOLDER", "holder",
    "addr1",
    "commodity", "COMMODITY",
    "legal_area", "unit_of_me",
    "grantdate", "enddate",
    "survstatus",
    "gid",
  ],
  // MINEDEX (DMIRS-001) mine/site points — operating/production status is the
  // edge field. TODO(MINEDEX): confirm exact field names against the live layer
  // schema; unlisted fields are simply stripped (safe — strip-by-default).
  minedexSites: [
    "short_name", "SHORT_NAME", "name", "NAME", "site_name", "SITE_NAME",
    "status", "STATUS", "oper_status", "OPER_STATUS", "operational_status",
    "commodity", "COMMODITY", "target_commodity", "primary_commodity",
    "mineral_field", "MINERAL_FIELD",
    "gid", "OBJECTID",
  ],
  cadastre: [
    "polygon_number", "POLY_ID", "gid", "OBJECTID",
    "lotplan", "LOTPLAN",
    "st_area(the_geom)",
    "assessment", "address",
  ],
};

function stripProps(features: unknown, layerKey: SlipLayerKey): unknown {
  if (!Array.isArray(features)) return features;
  const allowed = new Set(ALLOWED_FIELDS[layerKey]);
  return features.map((f) => {
    if (!f || typeof f !== "object") return f;
    const feat = f as { properties?: Record<string, unknown>; [k: string]: unknown };
    if (!feat.properties || typeof feat.properties !== "object") return feat;
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(feat.properties)) {
      if (allowed.has(k)) filtered[k] = v;
    }
    return { ...feat, properties: filtered };
  });
}

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
  const ip = getClientIp(req);
  const rl = rateLimit(`spatial|${ip}`, RATE_LIMIT_MAX);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } },
    );
  }

  const { layer } = await ctx.params;
  if (!ALLOWED.includes(layer as SlipLayerKey)) {
    return NextResponse.json({ ok: false, error: "unknown layer" }, { status: 400 });
  }
  const layerKey = layer as SlipLayerKey;

  const bboxRaw = req.nextUrl.searchParams.get("bbox");
  if (!bboxRaw) {
    return NextResponse.json({ ok: false, error: "bbox required" }, { status: 400 });
  }
  const parts = bboxRaw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json(
      { ok: false, error: "bbox must be minLng,minLat,maxLng,maxLat" },
      { status: 400 },
    );
  }
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  const bbox: BoundingBox = [minLng, minLat, maxLng, maxLat] as const;

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);

  const result = await fetchSlipFeatures(layerKey, bbox, {
    maxFeatures: Math.min(500, Math.max(10, limit)),
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }

  // Strip outFields down to the explicit allow-list per layer.
  const filtered = {
    ...result,
    features: stripProps(result.features, layerKey),
  };

  return NextResponse.json(filtered, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=300",
    },
  });
}
