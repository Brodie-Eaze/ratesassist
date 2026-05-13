/**
 * Sutherland-Hodgman polygon clipping + geodesic area / distance helpers.
 *
 * Pure, dependency-free. Inputs are [lng, lat] rings (GeoJSON order).
 * Used by the PropertyMap component to compute the tenement-parcel overlap
 * polygon and label it with its area in hectares and percentage of parcel.
 */

export type Point = [number, number]; // [lng, lat]
export type Ring = Point[];

/** Earth radius in metres (WGS-84 mean). */
const EARTH_RADIUS_M = 6_378_137;

/** Convert degrees to radians. */
function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/**
 * Haversine great-circle distance between two [lng, lat] points, in metres.
 */
export function haversineDistanceM(a: Point, b: Point): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return EARTH_RADIUS_M * c;
}

/**
 * Spherical-excess polygon area in square metres, for a closed lng/lat ring.
 *
 * Uses the L'Huilier-style spherical-cap formula via the standard
 * geographic-area integral. Works well for parcels at any latitude and
 * sub-metre at council-parcel scale.
 *
 * The input ring may be open (first != last) or closed; both work.
 */
export function geodesicAreaM2(ring: Ring): number {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i]!;
    const p2 = ring[(i + 1) % ring.length]!;
    total +=
      toRad(p2[0] - p1[0]) *
      (2 + Math.sin(toRad(p1[1])) + Math.sin(toRad(p2[1])));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

/** Convenience: square metres → hectares. */
export function m2ToHa(m2: number): number {
  return m2 / 10_000;
}

/**
 * Shoelace planar area in "square degrees" — only meaningful for tests / sign
 * checks. For real area in metres² use `geodesicAreaM2`.
 */
export function shoelaceArea(ring: Ring): number {
  if (ring.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

// ---------- Sutherland-Hodgman clip ----------

/** Returns true if point p is on the "inside" half-plane of edge (a → b). */
function inside(p: Point, a: Point, b: Point): boolean {
  // CCW orientation: inside is to the left of the directed edge.
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
}

/**
 * Intersect segment s1-s2 with the (infinite) line a-b.
 * Returns null if the lines are parallel or collinear (denom === 0) — callers
 * must filter these out of the clipped output.
 */
function intersect(s1: Point, s2: Point, a: Point, b: Point): Point | null {
  const x1 = s1[0], y1 = s1[1];
  const x2 = s2[0], y2 = s2[1];
  const x3 = a[0], y3 = a[1];
  const x4 = b[0], y4 = b[1];
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (denom === 0) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

/**
 * Returns true if the ring is convex (all cross-products of consecutive edges
 * share the same sign). Degenerate / collinear-only rings return false.
 */
export function isConvex(ring: Ring): boolean {
  if (ring.length < 3) return false;
  let sign = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[(i + 1) % n]!;
    const [cx, cy] = ring[(i + 2) % n]!;
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (sign !== s) return false;
    }
  }
  return sign !== 0;
}

/** Force a ring into CCW order (positive shoelace signed area). */
function toCcw(ring: Ring): Ring {
  if (ring.length < 3) return ring;
  let signed = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    signed += x1 * y2 - x2 * y1;
  }
  return signed >= 0 ? ring : [...ring].reverse();
}

/**
 * Sutherland-Hodgman clip of `subject` against convex clipper `clip`.
 *
 * If `clip` is not convex this will produce wrong results — for our use case
 * (parcel boundary, typically rectangular or near-convex) it's a clean fit.
 * Both rings should be in CCW order; this function normalises them.
 *
 * Returns the clipped ring (open form — first != last) or [] if no overlap.
 */
export function sutherlandHodgmanClip(subject: Ring, clip: Ring): Ring {
  if (subject.length < 3 || clip.length < 3) return [];
  let output: Ring = toCcw(subject.slice());
  const clipCcw = toCcw(clip.slice());

  for (let i = 0; i < clipCcw.length; i++) {
    if (output.length === 0) return [];
    const a = clipCcw[i]!;
    const b = clipCcw[(i + 1) % clipCcw.length]!;
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const current = input[j]!;
      const prev = input[(j - 1 + input.length) % input.length]!;
      const curIn = inside(current, a, b);
      const prevIn = inside(prev, a, b);
      if (curIn) {
        if (!prevIn) {
          const ix = intersect(prev, current, a, b);
          if (ix) output.push(ix);
        }
        output.push(current);
      } else if (prevIn) {
        const ix = intersect(prev, current, a, b);
        if (ix) output.push(ix);
      }
    }
  }
  return output;
}

/** Axis-aligned bbox of a [lng, lat] ring as a closed rectangular ring. */
function bboxRing(ring: Ring): Ring {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

/**
 * Compute overlap stats for a tenement polygon against a parcel polygon.
 *
 * If the parcel is non-convex, Sutherland-Hodgman would produce wrong results,
 * so we fall back to a bounding-box intersection and label the result as
 * approximate via `method: "bbox_fallback"`.
 *
 * Returns `null` when there is no overlap. Both inputs are [lng, lat] rings.
 */
export function overlapStats(
  tenement: Ring,
  parcel: Ring,
): {
  ring: Ring;
  areaM2: number;
  percentOfParcel: number;
  method: "convex_clip" | "bbox_fallback";
} | null {
  if (parcel.length < 3 || tenement.length < 3) return null;

  const useFallback = !isConvex(parcel);
  if (useFallback) {
    // bbox-of-parcel ∩ bbox-of-tenement, both axis-aligned in [lng, lat] space.
    const pb = bboxRing(parcel);
    const tb = bboxRing(tenement);
    const minX = Math.max(pb[0]![0], tb[0]![0]);
    const minY = Math.max(pb[0]![1], tb[0]![1]);
    const maxX = Math.min(pb[2]![0], tb[2]![0]);
    const maxY = Math.min(pb[2]![1], tb[2]![1]);
    if (minX >= maxX || minY >= maxY) return null;
    const ring: Ring = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];
    const overlapArea = geodesicAreaM2(ring);
    if (overlapArea <= 0) return null;
    const parcelArea = geodesicAreaM2(parcel);
    const pct = parcelArea > 0 ? (overlapArea / parcelArea) * 100 : 0;
    return { ring, areaM2: overlapArea, percentOfParcel: pct, method: "bbox_fallback" };
  }

  const clipped = sutherlandHodgmanClip(tenement, parcel);
  if (clipped.length < 3) return null;
  const overlapArea = geodesicAreaM2(clipped);
  if (overlapArea <= 0) return null;
  const parcelArea = geodesicAreaM2(parcel);
  const pct = parcelArea > 0 ? (overlapArea / parcelArea) * 100 : 0;
  return { ring: clipped, areaM2: overlapArea, percentOfParcel: pct, method: "convex_clip" };
}
