/**
 * Geometry helpers for the synthetic dataset.
 *
 * Real adapters source parcel and tenement polygons from authoritative
 * cadastral / mining-register feeds (Landgate SLIP, DMIRS WFS). The demo
 * adapter synthesises plausible polygons around a centroid so the web app's
 * map components have something to render. The shapes are intentionally
 * coarse — they are NOT to be relied on for spatial intersection in tests.
 */

import type { LatLng } from "@ratesassist/contract";

/** Metres per degree of latitude (WGS-84, sphere approximation). */
const METRES_PER_DEGREE_LAT = 111_111;

/** Default parcel side length in metres for synthesised cadastral squares. */
const DEFAULT_PARCEL_SIDE_M = 50;

/** Square metres in one hectare. */
const SQUARE_METRES_PER_HECTARE = 10_000;

/**
 * Build a square parcel polygon centred on `(lat, lng)` with side `sizeM`.
 *
 * Returned polygon is in Leaflet order (lat, lng) and is closed implicitly
 * (consumers that need explicit closure should append the first vertex).
 */
export function parcelSquare(
  lat: number,
  lng: number,
  sizeM: number = DEFAULT_PARCEL_SIDE_M,
): readonly LatLng[] {
  const dLat = sizeM / METRES_PER_DEGREE_LAT;
  const dLng = sizeM / (METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return [
    [lat - dLat, lng - dLng],
    [lat - dLat, lng + dLng],
    [lat + dLat, lng + dLng],
    [lat + dLat, lng - dLng],
  ] as const;
}

/**
 * Build a slightly irregular hexagonal polygon approximating a tenement of
 * `hectares` hectares centred on `(lat, lng)`. Used purely for visual
 * differentiation on demo maps; real tenement polygons come from DMIRS.
 */
export function tenementHexagon(
  lat: number,
  lng: number,
  hectares: number,
): readonly LatLng[] {
  const sideM = Math.sqrt(hectares * SQUARE_METRES_PER_HECTARE);
  const dLat = sideM / 2 / METRES_PER_DEGREE_LAT;
  const dLng =
    sideM / 2 / (METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return [
    [lat - dLat, lng - dLng * 0.7],
    [lat - dLat * 0.7, lng + dLng * 0.9],
    [lat + dLat * 0.4, lng + dLng],
    [lat + dLat, lng + dLng * 0.5],
    [lat + dLat * 0.6, lng - dLng * 0.8],
    [lat - dLat * 0.3, lng - dLng],
  ] as const;
}
