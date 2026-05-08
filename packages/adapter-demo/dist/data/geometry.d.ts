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
/**
 * Build a square parcel polygon centred on `(lat, lng)` with side `sizeM`.
 *
 * Returned polygon is in Leaflet order (lat, lng) and is closed implicitly
 * (consumers that need explicit closure should append the first vertex).
 */
export declare function parcelSquare(lat: number, lng: number, sizeM?: number): readonly LatLng[];
/**
 * Build a slightly irregular hexagonal polygon approximating a tenement of
 * `hectares` hectares centred on `(lat, lng)`. Used purely for visual
 * differentiation on demo maps; real tenement polygons come from DMIRS.
 */
export declare function tenementHexagon(lat: number, lng: number, hectares: number): readonly LatLng[];
//# sourceMappingURL=geometry.d.ts.map