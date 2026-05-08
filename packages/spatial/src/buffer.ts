/**
 * @ratesassist/spatial/buffer — circular-buffer polygon helper.
 *
 * Used to draw a "selected tenement / 1 km buffer" ring on the map. The
 * function is pure and synchronous; it does not call out to any service.
 */

import type { LatLng } from "@ratesassist/contract";

/**
 * WGS-84 equatorial radius in metres — the spheroid radius used to convert
 * metric offsets into degrees of latitude/longitude. Sufficient precision
 * for sub-kilometre rings displayed on a Leaflet map.
 */
const EARTH_RADIUS_METRES = 6_378_137;

/** Default vertex count for the buffer ring — 64 vertices renders smoothly at typical zooms. */
const DEFAULT_BUFFER_VERTICES = 64;

/** Minimum legal vertex count for a closed polygon ring. */
const MIN_BUFFER_VERTICES = 8;

/** Upper bound to stop callers accidentally creating thousand-point polygons. */
const MAX_BUFFER_VERTICES = 512;

/**
 * Generate a circular buffer polygon around a centroid.
 *
 * The returned vertices are in **Leaflet `[lat, lng]` order** so they can be
 * passed directly as `positions` on a react-leaflet `<Polygon>`. They are NOT
 * in GeoJSON `[lng, lat]` order — do not feed the result back into a GeoJSON
 * geometry without flipping coordinates.
 *
 * The first vertex is repeated at the end to close the ring (per Leaflet and
 * GeoJSON conventions for visual polygons).
 *
 * @param lat            Centroid latitude (decimal degrees).
 * @param lng            Centroid longitude (decimal degrees).
 * @param radiusMetres   Buffer radius in metres. Must be positive and finite.
 * @param vertices       Number of vertices on the ring (default 64). Clamped
 *                       to `[MIN_BUFFER_VERTICES, MAX_BUFFER_VERTICES]`.
 * @returns Closed ring of `LatLng` vertices.
 * @throws RangeError if `lat`, `lng`, or `radiusMetres` are non-finite or
 *         `radiusMetres <= 0`.
 */
export function bufferPolygon(
  lat: number,
  lng: number,
  radiusMetres: number,
  vertices: number = DEFAULT_BUFFER_VERTICES,
): LatLng[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new RangeError("bufferPolygon: lat and lng must be finite numbers");
  }
  if (!Number.isFinite(radiusMetres) || radiusMetres <= 0) {
    throw new RangeError("bufferPolygon: radiusMetres must be a positive finite number");
  }

  const safeVertices = Math.max(
    MIN_BUFFER_VERTICES,
    Math.min(MAX_BUFFER_VERTICES, Math.floor(vertices)),
  );

  const ring: LatLng[] = [];
  const latRad = (lat * Math.PI) / 180;
  const cosLatRad = Math.cos(latRad);

  for (let i = 0; i < safeVertices; i++) {
    const bearing = (i / safeVertices) * 2 * Math.PI;
    const dx = Math.sin(bearing) * radiusMetres;
    const dy = Math.cos(bearing) * radiusMetres;
    const dLat = (dy / EARTH_RADIUS_METRES) * (180 / Math.PI);
    const dLng = ((dx / EARTH_RADIUS_METRES) * (180 / Math.PI)) / cosLatRad;
    ring.push([lat + dLat, lng + dLng] as const);
  }

  // Close the ring by repeating the first vertex.
  const first = ring[0];
  if (first === undefined) {
    // SAFETY: `safeVertices >= MIN_BUFFER_VERTICES (8)`, so the loop above
    // always pushes at least one vertex. This branch is unreachable but is
    // kept to satisfy `noUncheckedIndexedAccess`.
    throw new Error("bufferPolygon: ring construction produced no vertices");
  }
  ring.push(first);
  return ring;
}
