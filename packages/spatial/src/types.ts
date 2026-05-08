/**
 * @ratesassist/spatial — package-internal types.
 *
 * Domain primitives such as `LatLng`, `LngLat`, `BoundingBox`, and `Tenement`
 * live in `@ratesassist/contract` and MUST be imported from there. This file
 * defines only spatial-layer-specific structures: GeoJSON wire shapes, fetch
 * results, and SLIP layer registry entries.
 */

import type { BoundingBox, LatLng } from "@ratesassist/contract";

/**
 * GeoJSON geometry kinds we accept from SLIP/Landgate ArcGIS REST endpoints.
 *
 * We deliberately enumerate the subset relevant to cadastral/tenement data
 * rather than importing a full GeoJSON typing — this keeps the package
 * dependency-light and pins the contract with upstream services explicitly.
 */
export type GeoJsonGeometry =
  | { readonly type: "Polygon"; readonly coordinates: readonly (readonly (readonly number[])[])[] }
  | { readonly type: "MultiPolygon"; readonly coordinates: readonly (readonly (readonly (readonly number[])[])[])[] }
  | { readonly type: "Point"; readonly coordinates: readonly number[] };

/** A single GeoJSON Feature as returned by ArcGIS `f=geojson` queries. */
export type GeoJsonFeature = {
  readonly type: "Feature";
  readonly id?: string | number;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly geometry: GeoJsonGeometry;
};

/** GeoJSON FeatureCollection wire shape. */
export type GeoJsonFeatureCollection = {
  readonly type: "FeatureCollection";
  readonly features: readonly GeoJsonFeature[];
};

/**
 * Discriminated failure codes for spatial fetches.
 *
 * - `invalid_input`   — caller supplied a bbox/layer the validator rejected
 * - `timeout`         — abort signal fired before any layer responded
 * - `upstream_error`  — every candidate layer returned non-2xx or a payload error
 * - `no_layer_responded` — layer registry exhausted with no usable response
 */
export type SpatialErrorCode =
  | "invalid_input"
  | "timeout"
  | "upstream_error"
  | "no_layer_responded";

/**
 * Result of a SLIP/ArcGIS feature fetch.
 *
 * `source` discriminator is critical for downstream UX — the platform must
 * never display data labelled `"live"` unless it came from a real upstream
 * response. Cached responses are explicitly tagged as `"cache"`.
 */
export type SlipFetchResult =
  | {
      readonly ok: true;
      readonly source: "live" | "cache";
      readonly features: readonly GeoJsonFeature[];
      readonly queriedAt: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly code: SpatialErrorCode;
      readonly correlationId?: string;
    };

/**
 * Discriminated failure codes for DMIRS WFS probes.
 *
 * Same shape as `SpatialErrorCode` but kept separate so the two surfaces can
 * evolve independently (DMIRS WFS has different failure modes than ArcGIS REST).
 */
export type DmirsErrorCode =
  | "invalid_input"
  | "timeout"
  | "upstream_error"
  | "no_layer_responded";

/**
 * Result of a DMIRS tenement fetch.
 *
 * CRITICAL: `"live"` is reserved for real feature data parsed from a WFS
 * GetFeature response. `"seeded"` is the demo-mode fallback returning the
 * pre-canned tenement set; capability-probe success on its own does NOT
 * upgrade a result to `"live"`. This was the labelling bug in the legacy
 * `apps/web/lib/dmirs.ts` we are explicitly fixing.
 */
export type DmirsFetchResult =
  | {
      readonly ok: true;
      readonly source: "live" | "seeded";
      readonly features: readonly GeoJsonFeature[];
      readonly queriedAt: string;
      readonly note?: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly code: DmirsErrorCode;
      readonly correlationId?: string;
    };

/**
 * SLIP layer registry entry. `candidateLayers` is tried in order; the first
 * to return a parseable GeoJSON FeatureCollection wins. This handles the
 * (real) case where SLIP shifts published layer indices between releases.
 */
export type SlipLayerDefinition = {
  readonly serviceUrl: string;
  readonly candidateLayers: readonly number[];
  readonly label: string;
};

/**
 * The exported re-typed bbox alias is kept here for documentation; consumers
 * should prefer importing `BoundingBox` directly from `@ratesassist/contract`.
 */
export type { BoundingBox, LatLng };
