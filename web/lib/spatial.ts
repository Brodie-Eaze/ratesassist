/** Leaflet order: [lat, lng]. Used by react-leaflet positions, polygon rings, etc. */
export type LatLng = [lat: number, lng: number];
/** GeoJSON order: [lng, lat]. Used by GeoJSON geometries, ArcGIS bbox params, etc. */
export type LngLat = [lng: number, lat: number];

// Real spatial data fetching — DMIRS mining tenements + Landgate cadastre.
//
// Uses SLIP (Shared Land Information Platform) public ArcGIS REST endpoints
// which expose `f=geojson` query for vector boundary data. CORS-restricted
// in browsers, so all requests go through our /api/spatial/* proxy.
//
// Strategy:
//   1. Try live SLIP query with short timeout (5s)
//   2. On failure, return null — caller falls back to seeded polygons
//   3. Cache live responses for 1h per bbox+layer
//
// SLIP service tree (public REST):
//   https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/...

export type GeoJSONFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
};

export type GeoJSONFeature = {
  type: "Feature";
  id?: string | number;
  properties: Record<string, unknown>;
  geometry: GeoJSONGeometry;
};

export type GeoJSONGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "Point"; coordinates: number[] };

export type SpatialFetchResult =
  | { ok: true; source: "live" | "cache"; features: GeoJSONFeature[]; queriedAt: string }
  | { ok: false; error: string };

// Layer registry — SLIP-hosted ArcGIS MapServers we know about.
// IDs are best-effort and tested at runtime; the proxy will probe for the
// correct layer index if the published one shifts.
// Verified against the live SLIP REST endpoint (layer indices come from
// the service capabilities at /MapServer?f=json):
//   Industry_and_Mining/MapServer/3 = "Mining Tenements (DMIRS-003)"
//   Property_and_Planning/MapServer/2 = "Cadastre (No Attributes) (LGATE-001)"
//   Boundaries/MapServer/* — LGA, Suburbs, etc. (probed dynamically when used)
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
};

// In-memory bbox cache (server-side; cleared on dev reload)
type CacheEntry = { ts: number; features: GeoJSONFeature[] };
const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function cacheKey(layerKey: string, bbox: number[]): string {
  return `${layerKey}|${bbox.map((n) => n.toFixed(4)).join(",")}`;
}

/**
 * Fetch GeoJSON polygons from a SLIP ArcGIS REST endpoint within a bbox.
 * bbox: [minLng, minLat, maxLng, maxLat]
 */
export async function fetchSlipFeatures(
  layerKey: keyof typeof SLIP_LAYERS,
  bbox: number[],
  opts: { maxFeatures?: number; timeoutMs?: number } = {},
): Promise<SpatialFetchResult> {
  const { maxFeatures = 200, timeoutMs = 6_000 } = opts;
  const layer = SLIP_LAYERS[layerKey];
  if (!layer) return { ok: false, error: "unknown layer" };

  const key = cacheKey(layerKey, bbox);
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return {
      ok: true,
      source: "cache",
      features: cached.features,
      queriedAt: new Date(cached.ts).toISOString(),
    };
  }

  const [minLng, minLat, maxLng, maxLat] = bbox;
  // ArcGIS REST query bbox geometry uses xmin,ymin,xmax,ymax
  const geometry = encodeURIComponent(
    JSON.stringify({
      xmin: minLng,
      ymin: minLat,
      xmax: maxLng,
      ymax: maxLat,
      spatialReference: { wkid: 4326 },
    }),
  );

  // Probe candidate layer IDs — first responding one wins
  for (const layerId of layer.candidateLayers) {
    const url =
      `${layer.serviceUrl}/${layerId}/query` +
      `?where=1%3D1` +
      `&geometry=${geometry}` +
      `&geometryType=esriGeometryEnvelope` +
      `&inSR=4326&outSR=4326` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&outFields=*` +
      `&returnGeometry=true` +
      `&f=geojson` +
      `&resultRecordCount=${maxFeatures}`;

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const json = (await res.json()) as
        | GeoJSONFeatureCollection
        | { error?: { message?: string } };
      if ("error" in json && json.error) continue;
      const fc = json as GeoJSONFeatureCollection;
      if (!fc.features) continue;
      _cache.set(key, { ts: Date.now(), features: fc.features });
      return {
        ok: true,
        source: "live",
        features: fc.features,
        queriedAt: new Date().toISOString(),
      };
    } catch {
      continue;
    }
  }

  return { ok: false, error: "no SLIP layer responded within timeout" };
}

/**
 * Generate a circular buffer polygon around a centroid for selected-tenement
 * "1km buffer ring" visualisation.
 *
 * Returns vertices in **Leaflet order** (`[lat, lng]`), suitable for direct
 * use as `positions` on a react-leaflet `<Polygon>`. NOT GeoJSON order.
 */
export function bufferPolygon(
  lat: number,
  lng: number,
  radiusMetres: number,
  vertices: number = 64,
): LatLng[] {
  const earthRadius = 6_378_137;
  const ring: LatLng[] = [];
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i < vertices; i++) {
    const bearing = (i / vertices) * 2 * Math.PI;
    const dx = Math.sin(bearing) * radiusMetres;
    const dy = Math.cos(bearing) * radiusMetres;
    const dLat = (dy / earthRadius) * (180 / Math.PI);
    const dLng = ((dx / earthRadius) * (180 / Math.PI)) / Math.cos(latRad);
    ring.push([lat + dLat, lng + dLng]);
  }
  ring.push(ring[0]); // close
  return ring;
}
