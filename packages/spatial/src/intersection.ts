/**
 * @ratesassist/spatial/intersection — tenement ↔ parcel spatial intersection.
 *
 * The connect layer between LIVE tenements (from `tenementMapping`) and the
 * council's parcels: which assessment numbers does each tenement sit on? The
 * recovery engine keys mismatches off `tenementsByAssessment`, so a tenement
 * with an empty `intersectsAssessmentNumbers` never fires a signal. This module
 * populates that field from geometry.
 *
 * METHOD (v1, honest): a property is "on" a tenement when the property CENTROID
 * falls inside the tenement POLYGON (ray-casting point-in-polygon). This is the
 * strongest single cheap signal and the precise upgrade of the existing
 * `pointInTenementBbox` fallback (bbox → actual polygon). It is NOT full
 * polygon-polygon overlap: a parcel that clips a tenement corner while its
 * centroid sits outside is missed. That exact case is what a PostGIS
 * `ST_Intersects` join handles in Phase 2 — this is the dependency-free,
 * fully-tested approximation that runs in-process today.
 *
 * LIMITATION: a tenement mapped from POINT geometry has an empty polygon
 * (`tenementMapping` drops points to `[]`), so it can't be tested and is left
 * unchanged. In practice SLIP's `miningTenements` layer returns polygons, so
 * live tenements carry geometry; MINEDEX point-sites are cross-referenced for
 * production status, not used as the intersection geometry.
 *
 * Pure: no network, no I/O. Coordinates are contract `LatLng` = [lat, lng].
 */

import type { LatLng, Tenement } from "@ratesassist/contract";

/**
 * The minimal parcel shape the intersection needs. The full `Property` satisfies
 * it structurally; the context builder can pass its rows directly. `parcel` is
 * accepted for forward-compatibility (Phase-2 polygon-polygon overlap) but the
 * v1 test uses only the centroid.
 */
export type IntersectableParcel = {
  /** Council assessment number — the recovery engine's property key. */
  readonly assessmentNumber: string;
  /** Property centroid latitude. */
  readonly lat: number;
  /** Property centroid longitude. */
  readonly lng: number;
  /** Optional cadastral parcel polygon (reserved for Phase-2 overlap). */
  readonly parcel?: readonly LatLng[];
};

/**
 * Ray-casting point-in-polygon (PNPOLY). Returns true when `point` is strictly
 * inside the `ring`. Behaviour on the boundary is intentionally unspecified
 * (PNPOLY's standard parity edge case) — at council scale a centroid landing
 * exactly on a tenement boundary line is vanishingly rare and not material.
 *
 * `point` and every `ring` vertex are `LatLng` = [lat, lng]. The cast runs
 * along longitude (x = lng, y = lat).
 *
 * @returns false for a degenerate ring (< 3 vertices).
 */
export function pointInPolygon(point: LatLng, ring: readonly LatLng[]): boolean {
  const n = ring.length;
  if (n < 3) return false;
  const y = point[0]; // lat
  const x = point[1]; // lng
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const vi = ring[i]!;
    const vj = ring[j]!;
    const yi = vi[0];
    const xi = vi[1];
    const yj = vj[0];
    const xj = vj[1];
    // Edge straddles the horizontal ray, and the crossing is to the right of x.
    // The (yi > y) !== (yj > y) guard also makes (yj - yi) non-zero here.
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Populate `intersectsAssessmentNumbers` on each tenement from geometry: a
 * parcel is attached when its centroid falls inside the tenement polygon.
 *
 * Honest by construction:
 *  - a tenement with < 3 polygon vertices (point/empty geometry) is returned
 *    UNCHANGED — no fabricated intersections;
 *  - the computed list REPLACES any prior value (the live mapper sets `[]`),
 *    is de-duplicated, and is sorted for deterministic output;
 *  - tenements with no hits are returned as-is (same object identity when the
 *    prior list was already empty), so this is safe to run repeatedly.
 *
 * O(tenements × parcels). At council scale (hundreds of live tenements ×
 * thousands of parcels) this is fine for a per-bbox refresh; the SQL/PostGIS
 * join is the 100k-parcel-wide upgrade, gated on Brodie's load-test review.
 */
export function assignTenementIntersections(
  tenements: readonly Tenement[],
  parcels: readonly IntersectableParcel[],
): readonly Tenement[] {
  return tenements.map((tenement) => {
    if (tenement.polygon.length < 3) return tenement; // no usable geometry
    const hits = new Set<string>();
    for (const parcel of parcels) {
      if (!Number.isFinite(parcel.lat) || !Number.isFinite(parcel.lng)) continue;
      if (pointInPolygon([parcel.lat, parcel.lng], tenement.polygon)) {
        hits.add(parcel.assessmentNumber);
      }
    }
    if (hits.size === 0) {
      // Leave an already-empty list untouched (identity-stable); only rebuild
      // when we'd otherwise be dropping a previously non-empty value.
      return tenement.intersectsAssessmentNumbers.length === 0
        ? tenement
        : { ...tenement, intersectsAssessmentNumbers: [] };
    }
    return { ...tenement, intersectsAssessmentNumbers: [...hits].sort() };
  });
}

/**
 * Invert the intersection into the `assessmentNumber → Tenement[]` map shape the
 * evaluation context consumes (`tenementsByAssessment`). Only tenements with at
 * least one intersecting parcel appear. Call after `assignTenementIntersections`.
 */
export function groupTenementsByAssessment(
  tenements: readonly Tenement[],
): ReadonlyMap<string, readonly Tenement[]> {
  const map = new Map<string, Tenement[]>();
  for (const tenement of tenements) {
    for (const assessmentNumber of tenement.intersectsAssessmentNumbers) {
      const list = map.get(assessmentNumber);
      if (list === undefined) map.set(assessmentNumber, [tenement]);
      else list.push(tenement);
    }
  }
  return map;
}
