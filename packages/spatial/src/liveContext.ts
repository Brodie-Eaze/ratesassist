/**
 * @ratesassist/spatial/liveContext — compose the LIVE tenement → assessment map.
 *
 * The end-to-end live path, one call: fetch DMIRS mining-tenement features for
 * the council's footprint (SLIP ArcGIS REST), map them to typed `Tenement`s,
 * intersect each against the council's parcels, and group into the
 * `assessmentNumber → Tenement[]` map the recovery engine's `EvaluationContext`
 * consumes. Pure orchestration over `tenementMapping` + `intersection` + `slip`.
 *
 * SAFE BY CONSTRUCTION — every failure mode returns `{ ok: false, reason }` so
 * the caller keeps its seeded/DB map; the live path can only ADD signal, never
 * blank the scorecard:
 *   - no parcels / no finite centroids        → reason "no_parcels"
 *   - bbox invalid (too large / out of AU)    → reason "bbox_invalid"   (large
 *     rural LGAs exceed the 1 sq-deg SLIP cap; that's the documented Phase-2
 *     bbox-tiling case, not a crash)
 *   - live fetch failed (network / 5xx)       → reason "fetch_failed"
 *   - fetch ok but ZERO intersecting tenements→ reason "no_matches"     (don't
 *     replace a populated DB map with an empty live one)
 *
 * Semantics when it returns ok: the map is built ENTIRELY from live register
 * data for the queried bbox. The caller decides replace-vs-merge; the intended
 * use (flag `RA_LIVE_TENEMENTS` on, real council coordinates) is REPLACE.
 *
 * No network of its own beyond `fetchLiveTenementsForBbox`; `fetcher` is
 * injectable for tests.
 */

import type { BoundingBox, Tenement } from "@ratesassist/contract";

import { BoundingBoxSchema, type FetchSlipFeaturesOptions } from "./slip.js";
import { fetchLiveTenementsForBbox } from "./tenementMapping.js";
import {
  assignTenementIntersections,
  groupTenementsByAssessment,
  type IntersectableParcel,
} from "./intersection.js";

/** Default padding (degrees) added around the parcel-centroid envelope (~2km). */
const DEFAULT_MARGIN_DEG = 0.02;

/**
 * Axis-aligned bounding box covering a set of points, padded by `marginDeg` on
 * every side. The margin guarantees a non-degenerate box (min < max) even for a
 * single point. Returns null when no point has finite coordinates.
 *
 * Points are `{ lat, lng }`; the result is a contract `BoundingBox`
 * `[minLng, minLat, maxLng, maxLat]`.
 */
export function boundingBoxForPoints(
  points: readonly { readonly lat: number; readonly lng: number }[],
  marginDeg: number = DEFAULT_MARGIN_DEG,
): BoundingBox | null {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null;
  const m = Math.max(0, marginDeg);
  return [minLng - m, minLat - m, maxLng + m, maxLat + m];
}

export type LiveTenementContextResult =
  | {
      readonly ok: true;
      readonly source: "live" | "cache";
      readonly bbox: BoundingBox;
      readonly tenementsByAssessment: ReadonlyMap<string, readonly Tenement[]>;
      /** Total live tenements fetched + mapped (before intersection filtering). */
      readonly tenementCount: number;
      /** Distinct assessment numbers with ≥1 intersecting live tenement. */
      readonly matchedAssessments: number;
    }
  | {
      readonly ok: false;
      readonly reason: "no_parcels" | "bbox_invalid" | "fetch_failed" | "no_matches";
      readonly error?: string;
    };

export type BuildLiveTenementsOptions = {
  /** Injected fetch (tests). Defaults to global fetch inside `fetchSlipFeatures`. */
  readonly fetcher?: typeof fetch;
  /** Degrees padded around the parcel envelope before the SLIP query. */
  readonly marginDeg?: number;
  /** Extra options forwarded to `fetchSlipFeatures` (timeout, cache control…). */
  readonly slipOpts?: Omit<FetchSlipFeaturesOptions, "fetcher">;
};

/**
 * Build the LIVE `assessmentNumber → Tenement[]` map for a set of parcels.
 * Never throws — every failure is a typed `{ ok: false, reason }`.
 */
export async function buildLiveTenementsByAssessment(
  parcels: readonly IntersectableParcel[],
  opts: BuildLiveTenementsOptions = {},
): Promise<LiveTenementContextResult> {
  if (parcels.length === 0) return { ok: false, reason: "no_parcels" };

  const bbox = boundingBoxForPoints(parcels, opts.marginDeg);
  if (bbox === null) return { ok: false, reason: "no_parcels" };

  // The SLIP service rejects oversized / out-of-envelope bboxes; validate here
  // so a too-large rural LGA degrades to DB rather than a fetch error.
  const parsed = BoundingBoxSchema.safeParse(bbox);
  if (!parsed.success) {
    return { ok: false, reason: "bbox_invalid", error: parsed.error.issues[0]?.message };
  }

  const res = await fetchLiveTenementsForBbox(bbox, {
    ...(opts.slipOpts ?? {}),
    ...(opts.fetcher ? { fetcher: opts.fetcher } : {}),
  });
  if (!res.ok) return { ok: false, reason: "fetch_failed", error: res.error };

  const assigned = assignTenementIntersections(res.tenements, parcels);
  const tenementsByAssessment = groupTenementsByAssessment(assigned);
  if (tenementsByAssessment.size === 0) return { ok: false, reason: "no_matches" };

  return {
    ok: true,
    source: res.source,
    bbox,
    tenementsByAssessment,
    tenementCount: res.tenements.length,
    matchedAssessments: tenementsByAssessment.size,
  };
}
