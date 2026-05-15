/**
 * @ratesassist/spatial/dpird — DPIRD generalised agricultural landuse fetch.
 *
 * The Department of Primary Industries and Regional Development (DPIRD)
 * publishes the "Generalised agricultural land use of Western Australia
 * (DPIRD-003)" layer via SLIP's public ArcGIS REST service. The recovery
 * engine reads this layer as the public proxy for parcel-scale landuse
 * classification — the missing puzzle piece for the cadastre-lag signal
 * when Landgate's restricted-tier `LANDS_HOLDINGS` cannot be reached.
 *
 * Layer:
 *   SLIP_Public_Services/Farming/MapServer/7 — DPIRD-003 landuse polygons.
 *
 * Polygons carry a `land_use` text field (lowercased values like
 * `livestock grazing`, `pastoral - cattle`, `no production`, etc.). The
 * lagWindow module classifies these into the canonical
 * `LanduseCategory` union; this module is the thin live-fetch layer
 * those classifiers stack on.
 *
 * Honest source labelling
 * -----------------------
 *   `live`   — parsed FeatureCollection from an actual upstream response.
 *   `seeded` — every fixture entry has `source: "seeded"`; the public
 *              entrypoint switches over to the seed set when the live
 *              endpoint is unreachable AND the caller did not opt out.
 *   `cache`  — reserved for future SLIP-cache integration.
 *
 * No silent fallbacks. If DPIRD returns a malformed payload and the
 * caller passes `allowSeededFallback: false` the function returns a
 * structured `ok: false` rather than seeded data. The default behaviour
 * IS to fall back to seeded data — but the result is tagged `"seeded"`
 * and a `note` discloses what went wrong upstream.
 */

import type { LatLng } from "@ratesassist/contract";
import type {
  DmirsErrorCode,
  GeoJsonFeature,
  GeoJsonGeometry,
} from "./types.js";
// The DPIRD-003 layer URL is canonical in lagWindow.ts (which has the
// downstream landuse classifier). Re-use it so a SLIP-side index shift
// is a one-edit change.
import { DPIRD_LANDUSE_LAYER_URL } from "./lagWindow.js";

// ===== Constants =====

/** Re-export so callers of this module don't have to reach into
 *  lagWindow for the URL. */
export { DPIRD_LANDUSE_LAYER_URL } from "./lagWindow.js";

/** ArcGIS WGS-84 spatial-reference WKID. */
const WGS84_WKID = 4326;

/** Per-attempt fetch timeout. */
const DEFAULT_TIMEOUT_MS = 6_000;

/** Number of automatic retries on transient upstream errors (503/504). */
const DEFAULT_MAX_RETRIES = 2;

/** Default lat/lng buffer (in degrees) when building a point query bbox. */
const DEFAULT_POINT_BUFFER_DEG = 0.01; // roughly 1.1 km — covers a typical parcel

/**
 * Australia mainland envelope, inclusive of the WA offshore mining zones
 * that DPIRD-003 covers. Anything outside this is rejected at the API
 * boundary — DPIRD has no data for points outside WA and burning quota
 * on a bad lat/lng helps nobody.
 */
const AU_BBOX_BOUNDS = {
  minLng: 110,
  maxLng: 156,
  minLat: -45,
  maxLat: -9,
} as const;

// ===== Public types =====

/**
 * A DPIRD-classified landuse hit at a single point. The fetcher returns
 * the polygon containing the point (or the nearest one when the point
 * sits on a boundary), plus the raw `land_use` text and the source tag.
 */
export type DpirdLanduseResult = {
  readonly ok: true;
  /** Raw `land_use` text from DPIRD (e.g. `"Livestock grazing"`). */
  readonly landuseCode: string;
  /**
   * Lower-cased description for human display — same as `landuseCode`
   * but normalised so the UI can format it without re-normalising.
   */
  readonly landuseDescription: string;
  /** Polygon geometry of the matched DPIRD-003 feature. */
  readonly geometry: GeoJsonGeometry;
  /** Where this attribution came from. */
  readonly source: "live" | "seeded" | "cache";
  /** Optional honest disclosure when `source !== "live"`. */
  readonly note?: string;
  /** ISO-8601 query timestamp. */
  readonly queriedAt: string;
};

/** Failure result; identical discriminator to other spatial modules. */
export type DpirdLanduseFailure = {
  readonly ok: false;
  readonly code: DmirsErrorCode;
  readonly error: string;
  readonly correlationId?: string;
};

export type FetchDpirdLanduseOpts = {
  /** WGS-84 latitude. */
  readonly lat: number;
  /** WGS-84 longitude. */
  readonly lng: number;
  /** Caller abort signal. */
  readonly signal?: AbortSignal;
  /** Injectable fetcher (tests). */
  readonly fetcher?: typeof fetch;
  /** Per-attempt timeout (default 6000). */
  readonly timeoutMs?: number;
  /** Retry budget on 503/504 (default 2). */
  readonly maxRetries?: number;
  /** Caller correlation id for log tracing. */
  readonly correlationId?: string;
  /**
   * When DPIRD is unreachable AND a seeded match exists, return the seed
   * tagged `"seeded"` (default `true`). Setting `false` forces a
   * structured failure instead.
   */
  readonly allowSeededFallback?: boolean;
  /** Buffer (degrees) for the bbox built around the point (default 0.01). */
  readonly bufferDeg?: number;
};

// ===== Seeded fallback (offline mode) =====

/**
 * Five mock entries spanning the WA mining footprint — co-located with
 * the lagWindow seed parcels and the major pilot-council towns. Used
 * when DPIRD is unreachable AND the caller has not opted out of the
 * seeded path.
 *
 * Each entry has a small polygon centred on a known town/site and a
 * plausible `land_use` text the real DPIRD-003 layer would carry.
 */
type SeedEntry = {
  readonly landuseCode: string;
  /** Centre as `[lat, lng]` — matches the contract `LatLng` tuple. */
  readonly center: LatLng;
  readonly geometry: GeoJsonGeometry;
};

const SEED_BUFFER_DEG = 0.05; // approx 5.5km — covers the surrounding parcels.

function seedPolygon(center: LatLng, buffer = SEED_BUFFER_DEG): GeoJsonGeometry {
  const [lat, lng] = center;
  return {
    type: "Polygon",
    coordinates: [
      [
        [lng - buffer, lat - buffer],
        [lng + buffer, lat - buffer],
        [lng + buffer, lat + buffer],
        [lng - buffer, lat + buffer],
        [lng - buffer, lat - buffer],
      ],
    ],
  };
}

/**
 * Exported for tests + the lagWindow module's optional seededParcels
 * wiring. The order matters only for documentation — the lookup is
 * first-match-on-bbox.
 */
export const DPIRD_SEED_ENTRIES: readonly SeedEntry[] = [
  {
    // Tom Price (Shire of Ashburton) — Pilbara mining belt; livestock grazing
    // dominates the surrounding non-tenement landuse.
    landuseCode: "Livestock grazing",
    center: [-22.694, 117.793],
    geometry: seedPolygon([-22.694, 117.793]),
  },
  {
    // Karratha (Shire of Roebourne, adjacent to ESH) — coastal mixed use;
    // DPIRD-003 carries this region as low-intensity perennial vegetation.
    landuseCode: "Native vegetation",
    center: [-20.737, 116.846],
    geometry: seedPolygon([-20.737, 116.846]),
  },
  {
    // Newman (Shire of East Pilbara) — surrounding tenement-adjacent land
    // classified as pastoral cattle.
    landuseCode: "Pastoral - Cattle",
    center: [-23.354, 119.738],
    geometry: seedPolygon([-23.354, 119.738]),
  },
  {
    // Kalgoorlie-Boulder (Goldfields) — DPIRD-003 carries the
    // surrounding non-mining surface as "no production" / arid interior.
    landuseCode: "No production",
    center: [-30.749, 121.466],
    geometry: seedPolygon([-30.749, 121.466]),
  },
  {
    // Meekatharra (Shire of Meekatharra) — Murchison; pastoral sheep+goats
    // dominates the non-mining UV surface.
    landuseCode: "Pastoral - Sheep and Goats",
    center: [-26.594, 118.495],
    geometry: seedPolygon([-26.594, 118.495]),
  },
];

// ===== Validation =====

function isFinitePair(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function withinAuEnvelope(lat: number, lng: number): boolean {
  return (
    lng >= AU_BBOX_BOUNDS.minLng &&
    lng <= AU_BBOX_BOUNDS.maxLng &&
    lat >= AU_BBOX_BOUNDS.minLat &&
    lat <= AU_BBOX_BOUNDS.maxLat
  );
}

// ===== Result construction =====

function failure(
  code: DmirsErrorCode,
  error: string,
  correlationId?: string,
): DpirdLanduseFailure {
  return correlationId === undefined
    ? { ok: false, code, error }
    : { ok: false, code, error, correlationId };
}

function isFeatureCollection(v: unknown): v is { features: GeoJsonFeature[] } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as { type?: unknown; features?: unknown };
  if (o.type !== "FeatureCollection") return false;
  return Array.isArray(o.features);
}

function pickFirstClassifiedFeature(
  features: readonly GeoJsonFeature[],
): GeoJsonFeature | undefined {
  for (const f of features) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const raw =
      typeof props["land_use"] === "string"
        ? (props["land_use"] as string)
        : typeof props["LAND_USE"] === "string"
          ? (props["LAND_USE"] as string)
          : undefined;
    if (typeof raw === "string" && raw.trim().length > 0) return f;
  }
  return undefined;
}

function findSeedFor(lat: number, lng: number): SeedEntry | undefined {
  // Nearest-neighbour on great-circle is overkill — flat-Earth distance is
  // fine inside the WA envelope at this resolution.
  let best: { entry: SeedEntry; d2: number } | undefined;
  for (const entry of DPIRD_SEED_ENTRIES) {
    const [eLat, eLng] = entry.center;
    const dLat = eLat - lat;
    const dLng = eLng - lng;
    const d2 = dLat * dLat + dLng * dLng;
    if (best === undefined || d2 < best.d2) {
      best = { entry, d2 };
    }
  }
  // Cap the seed match to within ~3 degrees (~330 km) so a query in
  // Tasmania doesn't pick up a Pilbara seed.
  if (best !== undefined && best.d2 <= 9) return best.entry;
  return undefined;
}

// ===== Public API =====

/**
 * Fetch a DPIRD-003 landuse classification for a single point.
 *
 * Behaviour:
 *   1. Validate lat/lng inside the Australia envelope.
 *   2. Build a small bbox around the point and query the ArcGIS REST
 *      endpoint with `f=geojson`.
 *   3. Retry up to `maxRetries` times on 503/504; respect AbortSignal.
 *   4. Return the first feature carrying a non-empty `land_use` text.
 *   5. On exhaustion: if `allowSeededFallback` (default true) AND a
 *      seed entry sits within ~3° of the requested point, return it
 *      tagged `"seeded"` with a disclosure note; otherwise return a
 *      structured failure.
 *
 * @param opts See `FetchDpirdLanduseOpts`.
 */
export async function fetchDpirdLanduseForParcel(
  opts: FetchDpirdLanduseOpts,
): Promise<DpirdLanduseResult | DpirdLanduseFailure> {
  const {
    lat,
    lng,
    signal,
    fetcher = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    correlationId,
    allowSeededFallback = true,
    bufferDeg = DEFAULT_POINT_BUFFER_DEG,
  } = opts;

  // 1. Validate.
  if (!isFinitePair(lat, lng)) {
    return failure("invalid_input", "lat/lng must be finite numbers", correlationId);
  }
  if (!withinAuEnvelope(lat, lng)) {
    return failure(
      "invalid_input",
      "lat/lng outside Australia envelope",
      correlationId,
    );
  }
  if (!Number.isFinite(bufferDeg) || bufferDeg <= 0 || bufferDeg > 1) {
    return failure(
      "invalid_input",
      "bufferDeg must be in (0, 1]",
      correlationId,
    );
  }

  // Pre-aborted signal: bail without any fetch.
  if (signal !== undefined && signal.aborted) {
    return failure("timeout", "aborted by caller", correlationId);
  }

  // 2. Build the query URL.
  const minLng = lng - bufferDeg;
  const maxLng = lng + bufferDeg;
  const minLat = lat - bufferDeg;
  const maxLat = lat + bufferDeg;
  const geometry = encodeURIComponent(
    JSON.stringify({
      xmin: minLng,
      ymin: minLat,
      xmax: maxLng,
      ymax: maxLat,
      spatialReference: { wkid: WGS84_WKID },
    }),
  );
  const url =
    `${DPIRD_LANDUSE_LAYER_URL}/query` +
    `?where=1%3D1` +
    `&geometry=${geometry}` +
    `&geometryType=esriGeometryEnvelope` +
    `&inSR=${WGS84_WKID}&outSR=${WGS84_WKID}` +
    `&spatialRel=esriSpatialRelIntersects` +
    `&outFields=land_use` +
    `&returnGeometry=true` +
    `&f=geojson` +
    `&resultRecordCount=10`;

  let lastError = "no attempt made";
  let lastCode: DmirsErrorCode = "upstream_error";

  // 3. Retry loop with per-attempt timeout.
  const attempts = Math.max(1, Math.min(maxRetries + 1, 5));
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal !== undefined && signal.aborted) {
      return failure("timeout", "aborted by caller", correlationId);
    }
    const ctrl = new AbortController();
    const onCallerAbort = () => ctrl.abort();
    if (signal !== undefined) {
      signal.addEventListener("abort", onCallerAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetcher(url, { signal: ctrl.signal });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        lastCode = "upstream_error";
        // Retry on transient upstream failures only.
        const transient = res.status === 503 || res.status === 504 || res.status === 502;
        if (!transient || attempt + 1 >= attempts) {
          break;
        }
        continue;
      }
      const json: unknown = await res.json();
      if (!isFeatureCollection(json)) {
        lastError = "non-GeoJSON response";
        lastCode = "upstream_error";
        break;
      }
      const matched = pickFirstClassifiedFeature(json.features);
      if (matched === undefined) {
        lastError = "no DPIRD feature at point";
        lastCode = "upstream_error";
        break;
      }
      const props = matched.properties as Record<string, unknown>;
      const raw =
        typeof props["land_use"] === "string"
          ? (props["land_use"] as string)
          : (props["LAND_USE"] as string);
      return {
        ok: true,
        landuseCode: raw,
        landuseDescription: raw.toLowerCase(),
        geometry: matched.geometry,
        source: "live",
        queriedAt: new Date().toISOString(),
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "fetch failed";
      const wasAbort =
        e instanceof Error && (e.name === "AbortError" || ctrl.signal.aborted);
      if (wasAbort && signal?.aborted === true) {
        return failure("timeout", "aborted by caller", correlationId);
      }
      lastError = message;
      lastCode = wasAbort ? "timeout" : "upstream_error";
      // Don't retry timeouts — caller already controls them via signal.
      if (lastCode === "timeout" || attempt + 1 >= attempts) break;
    } finally {
      clearTimeout(timer);
      if (signal !== undefined) signal.removeEventListener("abort", onCallerAbort);
    }
  }

  // 4. Live fetch exhausted. Optionally fall back to a seeded entry.
  if (allowSeededFallback) {
    const seed = findSeedFor(lat, lng);
    if (seed !== undefined) {
      const [seedLat, seedLng] = seed.center;
      return {
        ok: true,
        landuseCode: seed.landuseCode,
        landuseDescription: seed.landuseCode.toLowerCase(),
        geometry: seed.geometry,
        source: "seeded",
        note: `DPIRD landuse unreachable (${lastError}); returned seed entry centred on (${seedLat}, ${seedLng}).`,
        queriedAt: new Date().toISOString(),
      };
    }
  }

  return failure(lastCode, lastError, correlationId);
}
