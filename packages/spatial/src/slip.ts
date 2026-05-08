/**
 * @ratesassist/spatial/slip — Landgate SLIP / DMIRS ArcGIS REST integration.
 *
 * SLIP (Shared Land Information Platform) exposes WA cadastral and mining
 * tenement boundary data via public ArcGIS MapServer endpoints. We hit the
 * `query?f=geojson` surface, narrow by an envelope geometry, and return
 * GeoJSON features.
 *
 * Service tree (public REST):
 *   https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/
 *
 * Layer indices verified against the live service capabilities:
 *   - `Industry_and_Mining/MapServer/3` — Mining Tenements (DMIRS-003)
 *   - `Property_and_Planning/MapServer/2` — Cadastre (No Attributes) (LGATE-001)
 *
 * CORS: SLIP endpoints are CORS-restricted in browsers, so production callers
 * route through a server-side proxy. The fetcher itself is environment-agnostic.
 */

import { z } from "zod";
import type { BoundingBox } from "@ratesassist/contract";
import type {
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  SlipFetchResult,
  SlipLayerDefinition,
  SpatialErrorCode,
} from "./types.js";

// ===== Constants =====

/** Default per-query feature cap. Plenty for a council-scale map view. */
const DEFAULT_MAX_FEATURES = 200;

/** Default per-layer fetch timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 6_000;

/** Cache TTL — one hour matches SLIP's typical update cadence. */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Decimal places used when normalising bbox coordinates for the cache key. */
const CACHE_KEY_DECIMALS = 4;

/**
 * Australia mainland + offshore territories WGS-84 envelope. Used to reject
 * obviously-out-of-area bbox requests at the package boundary so we don't
 * burn SLIP quota on (e.g.) cache-enumeration probes from the public web.
 */
const AU_BBOX_BOUNDS = {
  minLng: 110,
  maxLng: 156,
  minLat: -45,
  maxLat: -9,
} as const;

/**
 * Maximum bbox area in square degrees. Caps the surface a single query can
 * touch — equivalent to roughly a 100 km square at WA latitudes — to prevent
 * scraping the entire state via one over-broad request.
 */
const MAX_BBOX_AREA_SQ_DEG = 1.0;

/** ArcGIS spatial-reference WKID for WGS-84 lon/lat. */
const WGS84_WKID = 4326;

// ===== Layer registry =====

/**
 * Layer registry. Each entry exposes a candidate-layers array; the fetcher
 * tries them in order so callers survive a published-index shift on the SLIP
 * side without code changes.
 */
export const SLIP_LAYERS = {
  miningTenements: {
    serviceUrl:
      "https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer",
    candidateLayers: [3, 0],
    label: "DMIRS Mining Tenements",
  },
  cadastre: {
    serviceUrl:
      "https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Property_and_Planning/MapServer",
    candidateLayers: [2],
    label: "Landgate Cadastre (no attributes)",
  },
} as const satisfies Readonly<Record<string, SlipLayerDefinition>>;

/** Type-safe layer key — drives autocomplete on `fetchSlipFeatures` callers. */
export type SlipLayerKey = keyof typeof SLIP_LAYERS;

// ===== Validation =====

/**
 * Zod schema for a `BoundingBox`. Enforces:
 *   - Tuple shape `[minLng, minLat, maxLng, maxLat]`
 *   - All four coordinates finite
 *   - Coordinates inside the Australia envelope
 *   - `min < max` on both axes
 *   - Area below `MAX_BBOX_AREA_SQ_DEG`
 *
 * Exported so other packages can re-validate bboxes at their own boundaries.
 */
export const BoundingBoxSchema = z
  .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
  .refine(
    ([minLng, minLat, maxLng, maxLat]) =>
      minLng < maxLng && minLat < maxLat,
    { message: "bbox: min coordinates must be strictly less than max" },
  )
  .refine(
    ([minLng, minLat, maxLng, maxLat]) =>
      minLng >= AU_BBOX_BOUNDS.minLng &&
      maxLng <= AU_BBOX_BOUNDS.maxLng &&
      minLat >= AU_BBOX_BOUNDS.minLat &&
      maxLat <= AU_BBOX_BOUNDS.maxLat,
    { message: "bbox: coordinates outside Australia envelope" },
  )
  .refine(
    ([minLng, minLat, maxLng, maxLat]) =>
      (maxLng - minLng) * (maxLat - minLat) <= MAX_BBOX_AREA_SQ_DEG,
    { message: `bbox: area exceeds ${MAX_BBOX_AREA_SQ_DEG} sq deg cap` },
  );

// ===== Cache =====

type CacheEntry = { readonly ts: number; readonly features: readonly GeoJsonFeature[] };

/**
 * In-memory cache. Process-local; cleared on dev reload. Production deployments
 * with multiple replicas should layer a shared cache (e.g. Redis) on top via
 * the `cache` injection point on `createSlipClient` if/when added.
 */
const _cache = new Map<string, CacheEntry>();

/**
 * Build a cache key from a layer key and a bbox, rounding bbox coordinates to
 * `CACHE_KEY_DECIMALS` decimals. Rounding prevents an attacker from enumerating
 * the cache by varying the bbox at sub-metre resolution.
 */
function cacheKey(layerKey: string, bbox: BoundingBox): string {
  const rounded = bbox.map((n) => n.toFixed(CACHE_KEY_DECIMALS)).join(",");
  return `${layerKey}|${rounded}`;
}

// ===== Fetch options =====

/** Optional knobs on `fetchSlipFeatures`. */
export type FetchSlipFeaturesOptions = {
  /** Hard upper bound on returned features (default 200). */
  readonly maxFeatures?: number;
  /** Per-layer timeout in milliseconds (default 6000). */
  readonly timeoutMs?: number;
  /**
   * Caller-provided abort signal. When the signal fires, the in-flight fetch
   * is cancelled and the function returns a `code: "timeout"` failure. This
   * lets the UI cancel stale fetches when the user pans/zooms quickly,
   * eliminating the stale-result race the legacy code suffered.
   */
  readonly signal?: AbortSignal;
  /** Correlation ID propagated into failure results for log tracing. */
  readonly correlationId?: string;
  /**
   * Injectable fetcher for tests. Defaults to the global `fetch`. Anything
   * `Response`-shaped will do — only `ok`, `status`, `json()`, and `text()`
   * are read.
   */
  readonly fetcher?: typeof fetch;
};

// ===== Errors =====

/**
 * Construct a structured failure result. Keeps the shape consistent with the
 * `SlipFetchResult` discriminator and avoids leaking response payloads.
 */
function failure(
  code: SpatialErrorCode,
  error: string,
  correlationId?: string,
): SlipFetchResult {
  return correlationId === undefined
    ? { ok: false, code, error }
    : { ok: false, code, error, correlationId };
}

// ===== Public API =====

/**
 * Fetch GeoJSON features from a SLIP/ArcGIS REST layer within a bounding box.
 *
 * Behaviour:
 *   1. Validate the bbox against the Australia envelope and area cap.
 *   2. Return the cached entry if one exists and is younger than `CACHE_TTL_MS`.
 *   3. Try each candidate layer index in turn with `timeoutMs` per attempt;
 *      the first to return a parseable FeatureCollection wins.
 *   4. On exhaustion, return a structured failure — never throw.
 *
 * Errors are returned, not thrown. Network errors, timeouts, and ArcGIS
 * payload errors all map onto the `SpatialErrorCode` discriminant.
 *
 * @param layerKey   Registered layer identifier from `SLIP_LAYERS`.
 * @param bbox       `[minLng, minLat, maxLng, maxLat]` (GeoJSON / WFS order).
 * @param opts       See `FetchSlipFeaturesOptions`.
 * @returns          Discriminated `SlipFetchResult`.
 */
export async function fetchSlipFeatures(
  layerKey: SlipLayerKey,
  bbox: BoundingBox,
  opts: FetchSlipFeaturesOptions = {},
): Promise<SlipFetchResult> {
  const {
    maxFeatures = DEFAULT_MAX_FEATURES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    correlationId,
    fetcher = fetch,
  } = opts;

  // 1. Validate the bbox.
  const parsed = BoundingBoxSchema.safeParse(bbox);
  if (!parsed.success) {
    return failure("invalid_input", parsed.error.issues[0]?.message ?? "invalid bbox", correlationId);
  }

  const layer = SLIP_LAYERS[layerKey];
  // SAFETY: `layerKey` is constrained to `keyof typeof SLIP_LAYERS`, so the
  // lookup is total — but `noUncheckedIndexedAccess` widens the result.
  if (layer === undefined) {
    return failure("invalid_input", `unknown layer: ${String(layerKey)}`, correlationId);
  }

  // 2. Cache lookup.
  const key = cacheKey(layerKey, bbox);
  const cached = _cache.get(key);
  if (cached !== undefined && Date.now() - cached.ts < CACHE_TTL_MS) {
    return {
      ok: true,
      source: "cache",
      features: cached.features,
      queriedAt: new Date(cached.ts).toISOString(),
    };
  }

  // 3. Build the ArcGIS query URL once; only the layer index varies per attempt.
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const geometry = encodeURIComponent(
    JSON.stringify({
      xmin: minLng,
      ymin: minLat,
      xmax: maxLng,
      ymax: maxLat,
      spatialReference: { wkid: WGS84_WKID },
    }),
  );

  let lastError: { code: "timeout" | "upstream_error"; message: string } | null = null;

  for (const layerId of layer.candidateLayers) {
    const url =
      `${layer.serviceUrl}/${layerId}/query` +
      `?where=1%3D1` +
      `&geometry=${geometry}` +
      `&geometryType=esriGeometryEnvelope` +
      `&inSR=${WGS84_WKID}&outSR=${WGS84_WKID}` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&outFields=*` +
      `&returnGeometry=true` +
      `&f=geojson` +
      `&resultRecordCount=${maxFeatures}`;

    // Per-attempt abort controller composed with the caller-provided signal.
    const ctrl = new AbortController();
    const onCallerAbort = () => ctrl.abort();
    if (signal !== undefined) {
      if (signal.aborted) {
        return failure("timeout", "aborted by caller", correlationId);
      }
      signal.addEventListener("abort", onCallerAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetcher(url, { signal: ctrl.signal });
      if (!res.ok) {
        lastError = { code: "upstream_error", message: `HTTP ${res.status}` };
        continue;
      }
      const json: unknown = await res.json();
      if (!isFeatureCollection(json)) {
        // ArcGIS surfaces upstream errors as `{ error: { code, message, ... } }`
        // payloads with HTTP 200, which would otherwise flatten to an opaque
        // "non-GeoJSON response". Surface the embedded code/message so the
        // caller can see what SLIP actually said (rate limit, auth, etc.).
        let detail = "non-GeoJSON response";
        if (
          typeof json === "object" &&
          json !== null &&
          "error" in json &&
          typeof (json as { error: unknown }).error === "object" &&
          (json as { error: unknown }).error !== null
        ) {
          const errObj = (json as { error: Record<string, unknown> }).error;
          const code = typeof errObj.code === "number" || typeof errObj.code === "string"
            ? String(errObj.code)
            : undefined;
          const message = typeof errObj.message === "string" ? errObj.message : undefined;
          if (code !== undefined && message !== undefined) {
            detail = `ArcGIS error ${code}: ${message}`;
          } else if (message !== undefined) {
            detail = `ArcGIS error: ${message}`;
          } else if (code !== undefined) {
            detail = `ArcGIS error ${code}`;
          }
        }
        lastError = { code: "upstream_error", message: detail };
        continue;
      }
      _cache.set(key, { ts: Date.now(), features: json.features });
      return {
        ok: true,
        source: "live",
        features: json.features,
        queriedAt: new Date().toISOString(),
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "fetch failed";
      // Distinguish caller-cancelled abort vs internal timeout.
      const wasAbort = e instanceof Error && (e.name === "AbortError" || ctrl.signal.aborted);
      if (wasAbort && signal?.aborted === true) {
        clearTimeout(timer);
        if (signal !== undefined) signal.removeEventListener("abort", onCallerAbort);
        return failure("timeout", "aborted by caller", correlationId);
      }
      lastError = { code: wasAbort ? "timeout" : "upstream_error", message };
      continue;
    } finally {
      clearTimeout(timer);
      if (signal !== undefined) signal.removeEventListener("abort", onCallerAbort);
    }
  }

  if (lastError !== null) {
    return failure(lastError.code, lastError.message, correlationId);
  }
  return failure("no_layer_responded", "no SLIP layer responded", correlationId);
}

// ===== Type guards =====

/**
 * Narrow an `unknown` JSON value to a GeoJSON FeatureCollection. Strict enough
 * to keep us safe; loose enough that we don't reject features SLIP varies
 * between releases (extra properties are allowed).
 */
function isFeatureCollection(v: unknown): v is GeoJsonFeatureCollection {
  if (typeof v !== "object" || v === null) return false;
  const o = v as { type?: unknown; features?: unknown };
  if (o.type !== "FeatureCollection") return false;
  if (!Array.isArray(o.features)) return false;
  return o.features.every(isFeature);
}

/** Type guard for a single GeoJSON Feature with a known geometry kind. */
function isFeature(v: unknown): v is GeoJsonFeature {
  if (typeof v !== "object" || v === null) return false;
  const o = v as { type?: unknown; geometry?: unknown; properties?: unknown };
  if (o.type !== "Feature") return false;
  if (typeof o.geometry !== "object" || o.geometry === null) return false;
  const g = o.geometry as { type?: unknown };
  if (g.type !== "Polygon" && g.type !== "MultiPolygon" && g.type !== "Point") {
    return false;
  }
  // properties can be null per the GeoJSON spec; we tolerate either.
  if (o.properties !== null && (typeof o.properties !== "object" || Array.isArray(o.properties))) {
    return false;
  }
  return true;
}

/**
 * Test-only cache reset. Not exported from the package barrel — import directly
 * from `./slip` if you need it. Kept here rather than in a separate test helper
 * file so the cache encapsulation stays in one place.
 */
export function __resetSlipCacheForTests(): void {
  _cache.clear();
}
