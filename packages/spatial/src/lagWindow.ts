/**
 * @ratesassist/spatial/lagWindow — "DMIRS ahead of Landgate" detection.
 *
 * Cross-register join: a tenement is freshly granted on DMIRS (MINEDEX/SLIP
 * Industry_and_Mining/MapServer/3) but the publicly-served WA landuse
 * classification still reflects the pre-mining state (Rural / Vacant /
 * Pastoral / Conservation / etc.). During that lag — empirically multi-week
 * to multi-month — a producing mining lease can sit on a parcel still rated
 * non-mining. This module surfaces every such case as a `LagCandidate`.
 *
 * Public-data realities (verified live 2026-05):
 *   - SLIP_Public_Services/Property_and_Planning/MapServer/2 is "Cadastre
 *     (No Attributes)" — exposes only OBJECTID + view_scale + geometry.
 *     Parcel-level landuse is restricted-tier.
 *   - SLIP_Public_Services/Farming/MapServer/7 — "Generalised agricultural
 *     land use of Western Australia (DPIRD-003)" — is the public layer
 *     that DOES carry a `land_use` field on polygon features and covers
 *     the relevant non-metropolitan WA surface. We use it as the public
 *     proxy for the Landgate landuse classification.
 *
 * Honest source labelling:
 *   - `live` — both DMIRS grants and DPIRD landuse came from real upstream
 *     responses.
 *   - `seeded` — at least one side fell back to the fixture set; the result
 *     note discloses which.
 *   - `cache` — reserved for SLIP per-bbox cache hits passed up by the
 *     underlying fetcher.
 *
 * No silent fallbacks. If the DPIRD landuse fetch fails AND no seeded
 * landuse fallback is configured, the function returns a structured
 * `ok: false` rather than fabricating a lag candidate.
 */

import type { BoundingBox } from "@ratesassist/contract";
import {
  fetchRecentlyGrantedTenements,
  tenementBoundingBox,
  SEEDED_GRANTS,
  type GrantedTenement,
} from "./grants.js";
import type {
  DmirsErrorCode,
  GeoJsonFeature,
  GeoJsonGeometry,
} from "./types.js";

// ===== Constants =====

/** Default lookback window: 90 days catches every council-cycle lag we see. */
const DEFAULT_SINCE_DAYS = 90;

/** Max LagCandidates returned per call. */
const DEFAULT_MAX_CANDIDATES = 200;

/** Per-fetch timeout (ms). */
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * DPIRD landuse layer URL. The single public source-of-truth for parcel-scale
 * landuse classification reachable without restricted-tier credentials.
 * Hardcoded in one place so a layer-shift requires one edit, not a hunt.
 */
export const DPIRD_LANDUSE_LAYER_URL =
  "https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Farming/MapServer/7";

/**
 * Landgate Map Viewer (Locate). Public deep-linkable surface for a parcel
 * search; the SPA accepts a `search=` query that pre-loads the parcel.
 * Verified live 2026-05.
 */
export const LANDGATE_LOCATE_BASE = "https://maps.slip.wa.gov.au/landgate/locate/";

// ===== Landuse classification =====

/**
 * Normalised landuse category enum. This is the dimension that drives the
 * signal: the moment a parcel's category is NOT `mining` / `crown`, a freshly
 * granted mining tenement on it represents a reclassification opportunity.
 */
export type LanduseCategory =
  | "rural"
  | "vacant"
  | "residential"
  | "commercial"
  | "industrial"
  | "mining"
  | "pastoral"
  | "crown"
  | "conservation"
  | "other";

/**
 * Map DPIRD `land_use` enum values → normalised category. The 12 known
 * DPIRD values were sampled live; unknown values fall through to `other`
 * (which DOES still fire the signal — we don't want a typo on the DPIRD
 * side to silently suppress a recovery opportunity).
 */
const DPIRD_LANDUSE_MAP: Readonly<Record<string, LanduseCategory>> = {
  // Pastoral leases — explicit category so we DON'T fire on cattle stations.
  "pastoral - cattle": "pastoral",
  "pastoral - sheep and goats": "pastoral",
  // Conservation / crown land — exclude so we don't false-positive on reserves.
  conservation: "conservation",
  "arid interior": "crown",
  // Productive non-mining classifications — these DO fire (the signal).
  "livestock grazing": "rural",
  dairy: "rural",
  "cropping - cereals and legumes": "rural",
  horticulture: "rural",
  viticulture: "rural",
  "forestry plantations": "rural",
  "perth metropolitan area": "residential",
  "no production": "vacant",
} as const;

export function classifyLanduse(raw: string | null | undefined): LanduseCategory {
  if (typeof raw !== "string" || raw.trim().length === 0) return "other";
  const k = raw.trim().toLowerCase();
  return DPIRD_LANDUSE_MAP[k] ?? "other";
}

// ===== Types =====

export type LandgateParcel = {
  /** Land Parcel ID (Landgate identifier). DPIRD layer has no PIN; left
   * undefined when only the DPIRD proxy is available. */
  readonly pin?: string;
  /** "Lot 42 DP 18337" — undefined when only the DPIRD proxy is available. */
  readonly lotPlan?: string;
  /** Raw landuse code/text from upstream. */
  readonly landuse: string;
  /** Normalised category — what the signal logic keys off. */
  readonly landuseCategory: LanduseCategory;
  /** Polygon area (where known). */
  readonly areaHectares?: number;
  /** Parcel geometry. */
  readonly geometry: GeoJsonGeometry;
  /**
   * Public deep-link URL — opens Landgate Locate centred on the parcel's
   * bounding box. Never undefined: we always derive one from the geometry.
   */
  readonly detailUrl: string;
  /** Where this parcel attribution actually came from. */
  readonly source: "live" | "seeded";
};

export type LagSeverityHint = "high" | "medium" | "low";

export type LagCandidate = {
  /** The DMIRS-granted tenement driving the candidate. */
  readonly tenement: GrantedTenement;
  /** The intersecting parcel whose landuse hasn't caught up. */
  readonly parcel: LandgateParcel;
  /** Days since the DMIRS grant (floor; non-negative). */
  readonly lagDays: number;
  /** Pre-computed before scoring — so the engine doesn't have to re-derive. */
  readonly severityHint: LagSeverityHint;
  /** Human-readable evidence string — copied into the signal hit. */
  readonly reasoning: string;
};

export type LagFetchResult =
  | {
      readonly ok: true;
      readonly source: "live" | "seeded" | "cache";
      readonly candidates: readonly LagCandidate[];
      readonly queriedAt: string;
      readonly note?: string;
    }
  | {
      readonly ok: false;
      readonly code: DmirsErrorCode;
      readonly error: string;
      readonly correlationId?: string;
    };

export type FindLagWindowOptions = {
  /** LGA name filter (case-insensitive substring) — hint only; not enforced
   * upstream since DPIRD polygons don't carry an LGA tag. */
  readonly lgaName?: string;
  /** Optional bbox restriction. Default: Pilbara-centric 0.9 sq deg tile. */
  readonly bbox?: BoundingBox;
  /** Lookback days for grants. Default 90; max 365. */
  readonly sinceDays?: number;
  /** Caller abort signal. */
  readonly signal?: AbortSignal;
  /** Correlation id. */
  readonly correlationId?: string;
  /** Per-call fetch override (tests). */
  readonly fetcher?: typeof fetch;
  /** Inject `now` for deterministic tests. */
  readonly now?: () => number;
  /** Hard cap on returned candidates. */
  readonly maxCandidates?: number;
  /**
   * Optional landuse-side seeded fallback. Each entry is a parcel with raw
   * landuse + geometry that participates in the intersection step when SLIP
   * is unreachable. Without it, a SLIP failure produces a structured error.
   */
  readonly seededParcels?: ReadonlyArray<LandgateParcel>;
  /**
   * Optional grant-side seeded fallback — wired straight into
   * `fetchRecentlyGrantedTenements` so the demo path stays alive when SLIP
   * mining-tenement endpoint is unreachable too.
   */
  readonly seededGrants?: ReadonlyArray<GrantedTenement>;
};

// ===== Geometry helpers =====

/**
 * Cheap bbox-intersection test. Tenement and parcel both have a derivable
 * bbox; if the bboxes don't overlap, the polygons can't either. We don't
 * need full polygon-polygon clipping for the signal — a real PostGIS join
 * replaces this in Phase 2, but for the public-API surface bbox overlap is
 * a strict superset of the true intersection and over-flagging is the safe
 * direction (medium severity is reviewed by officers regardless).
 */
function bboxesOverlap(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

function geometryBbox(
  geom: GeoJsonGeometry,
): readonly [number, number, number, number] | null {
  if (geom.type === "Point") {
    const c = geom.coordinates;
    const lng = c[0];
    const lat = c[1];
    if (typeof lng !== "number" || typeof lat !== "number") return null;
    return [lng, lat, lng, lat];
  }
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  const polys: ReadonlyArray<
    ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
  > =
    geom.type === "Polygon"
      ? ([geom.coordinates] as ReadonlyArray<
          ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
        >)
      : (geom.coordinates as ReadonlyArray<
          ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
        >);
  for (const poly of polys) {
    for (const ring of poly) {
      for (const pt of ring) {
        const lng = pt[0];
        const lat = pt[1];
        if (typeof lng !== "number" || typeof lat !== "number") continue;
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  if (!Number.isFinite(minLng)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

// ===== Landgate deep-link =====

/**
 * Build a public Landgate Locate URL centred on the parcel's bbox. The
 * Locate viewer accepts a `search=` query but, with no PIN/lotplan in the
 * DPIRD layer, the most-honest deep link is a coordinates-anchored map.
 */
export function buildLandgateLocateUrl(geom: GeoJsonGeometry): string {
  const bbox = geometryBbox(geom);
  if (bbox === null) return LANDGATE_LOCATE_BASE;
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;
  // Locate accepts a `?map=` hash but for cross-version safety we use a
  // simple search hint that the SPA will pre-fill.
  return `${LANDGATE_LOCATE_BASE}?search=${cy.toFixed(6)},${cx.toFixed(6)}`;
}

// ===== Severity heuristic =====

/**
 * High: producing M-class lease on residential / rural parcel.
 *   Producing status not on `GrantedTenement` — treat any M-class as a
 *   producing-or-near-producing lease for severity purposes (callers who
 *   have richer state can downgrade).
 * Medium: M-class on rural OR G-class on rural / vacant.
 * Low: anything else (exploration, prospecting, retention) that still
 *   tripped the cadastre-lag join — surfaced for officer review.
 */
export function severityHintFor(
  tenementType: string,
  category: LanduseCategory,
): LagSeverityHint {
  const t = tenementType.toUpperCase();
  if (t === "M" && (category === "residential" || category === "rural")) {
    return "high";
  }
  if (t === "M" && category === "vacant") return "medium";
  if (t === "G" && (category === "rural" || category === "vacant")) return "medium";
  if (t === "L" && (category === "rural" || category === "vacant")) return "medium";
  return "low";
}

// ===== Parcel feature → LandgateParcel =====

function featureToParcel(
  feat: GeoJsonFeature,
  fallbackSource: "live" | "seeded" = "live",
): LandgateParcel | null {
  const props = feat.properties as Record<string, unknown>;
  const raw =
    typeof props["land_use"] === "string"
      ? (props["land_use"] as string)
      : typeof props["LAND_USE"] === "string"
        ? (props["LAND_USE"] as string)
        : undefined;
  if (raw === undefined) return null;
  const category = classifyLanduse(raw);
  const areaSq =
    typeof props["st_area(shape)"] === "number"
      ? (props["st_area(shape)"] as number)
      : undefined;
  return {
    landuse: raw,
    landuseCategory: category,
    ...(areaSq !== undefined
      ? { areaHectares: Math.round(areaSq / 10_000) }
      : {}),
    geometry: feat.geometry,
    detailUrl: buildLandgateLocateUrl(feat.geometry),
    source: fallbackSource,
  };
}

// ===== DPIRD landuse fetch =====

async function fetchDpirdLanduseParcels(
  bbox: BoundingBox,
  opts: {
    readonly signal?: AbortSignal;
    readonly fetcher?: typeof fetch;
    readonly timeoutMs?: number;
  },
): Promise<
  | { readonly ok: true; readonly features: readonly GeoJsonFeature[] }
  | { readonly ok: false; readonly code: DmirsErrorCode; readonly error: string }
> {
  const { signal, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const geometry = encodeURIComponent(
    JSON.stringify({
      xmin: minLng,
      ymin: minLat,
      xmax: maxLng,
      ymax: maxLat,
      spatialReference: { wkid: 4326 },
    }),
  );
  const url =
    `${DPIRD_LANDUSE_LAYER_URL}/query` +
    `?where=1%3D1` +
    `&geometry=${geometry}` +
    `&geometryType=esriGeometryEnvelope` +
    `&inSR=4326&outSR=4326` +
    `&spatialRel=esriSpatialRelIntersects` +
    `&outFields=land_use,st_area(shape)` +
    `&returnGeometry=true` +
    `&f=geojson` +
    `&resultRecordCount=500`;

  if (signal !== undefined && signal.aborted) {
    return { ok: false, code: "timeout", error: "aborted by caller" };
  }
  const ctrl = new AbortController();
  const onCallerAbort = () => ctrl.abort();
  if (signal !== undefined) signal.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: ctrl.signal });
    if (!res.ok) {
      return { ok: false, code: "upstream_error", error: `HTTP ${res.status}` };
    }
    const json: unknown = await res.json();
    if (
      typeof json !== "object" ||
      json === null ||
      (json as { type?: unknown }).type !== "FeatureCollection" ||
      !Array.isArray((json as { features?: unknown }).features)
    ) {
      return { ok: false, code: "upstream_error", error: "non-GeoJSON response" };
    }
    return { ok: true, features: (json as { features: GeoJsonFeature[] }).features };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "fetch failed";
    const wasAbort = e instanceof Error && (e.name === "AbortError" || ctrl.signal.aborted);
    if (wasAbort && signal !== undefined && signal.aborted) {
      return { ok: false, code: "timeout", error: "aborted by caller" };
    }
    return {
      ok: false,
      code: wasAbort ? "timeout" : "upstream_error",
      error: message,
    };
  } finally {
    clearTimeout(timer);
    if (signal !== undefined) signal.removeEventListener("abort", onCallerAbort);
  }
}

// ===== Seeded fallback (offline mode) =====

/**
 * A small, plausible seeded parcel set spanning the WA mining footprint.
 * Used when DPIRD is unreachable AND the caller passed in
 * `seededParcels`; otherwise the fetch surfaces a real error. The seed
 * geometries are deliberately co-located with `SEEDED_GRANTS` so the
 * demo path always returns at least one LagCandidate.
 */
export const SEEDED_LAGWINDOW_PARCELS: ReadonlyArray<LandgateParcel> = [
  {
    landuse: "Livestock grazing",
    landuseCategory: "rural",
    areaHectares: 12_400,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [117.75, -22.72],
          [117.85, -22.72],
          [117.85, -22.66],
          [117.75, -22.66],
          [117.75, -22.72],
        ],
      ],
    },
    detailUrl: buildLandgateLocateUrl({
      type: "Point",
      coordinates: [117.79, -22.69],
    }),
    source: "seeded",
  },
  {
    landuse: "Pastoral - Cattle",
    landuseCategory: "pastoral",
    areaHectares: 41_000,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [116.80, -20.78],
          [116.90, -20.78],
          [116.90, -20.70],
          [116.80, -20.70],
          [116.80, -20.78],
        ],
      ],
    },
    detailUrl: buildLandgateLocateUrl({
      type: "Point",
      coordinates: [116.85, -20.74],
    }),
    source: "seeded",
  },
  {
    landuse: "No production",
    landuseCategory: "vacant",
    areaHectares: 220,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [119.70, -23.38],
          [119.76, -23.38],
          [119.76, -23.33],
          [119.70, -23.33],
          [119.70, -23.38],
        ],
      ],
    },
    detailUrl: buildLandgateLocateUrl({
      type: "Point",
      coordinates: [119.73, -23.355],
    }),
    source: "seeded",
  },
];

// ===== Public API =====

/**
 * Find candidates for the "DMIRS ahead of Landgate" signal.
 *
 *   1. Pull recently-granted live tenements (reuses fetchRecentlyGrantedTenements).
 *   2. Pull DPIRD landuse polygons over the same bbox (the public proxy for
 *      Landgate parcel-scale landuse).
 *   3. Bbox-intersect every (tenement, parcel) pair.
 *   4. Fire when parcel.landuseCategory ∉ {mining, crown, conservation}
 *      AND tenement.type ∈ {M, G, L} AND grant is LIVE (already filtered
 *      by the grants fetcher).
 *   5. Compute lagDays, severityHint, reasoning string.
 *   6. Return source labelling honestly:
 *        live    — both sides live
 *        seeded  — one or both sides fell back to fixtures
 *        cache   — both sides hit the spatial cache
 */
export async function findLagWindowCandidates(
  opts: FindLagWindowOptions = {},
): Promise<LagFetchResult> {
  const {
    bbox,
    sinceDays = DEFAULT_SINCE_DAYS,
    signal,
    correlationId,
    fetcher,
    now = Date.now,
    maxCandidates = DEFAULT_MAX_CANDIDATES,
    seededParcels,
    seededGrants,
  } = opts;

  if (!Number.isFinite(sinceDays) || sinceDays < 1 || sinceDays > 365) {
    return {
      ok: false,
      code: "invalid_input",
      error: "sinceDays must be in 1..365",
      ...(correlationId !== undefined ? { correlationId } : {}),
    };
  }

  const nowMs = now();
  const sinceMs = nowMs - sinceDays * 24 * 60 * 60 * 1000;
  // Default to the Pilbara-centric 0.9 sq deg tile — same as grants.ts.
  const queryBbox: BoundingBox = bbox ?? [117.0, -23.5, 117.9, -22.6];

  // 1. Recently-granted tenements.
  const grantsRes = await fetchRecentlyGrantedTenements({
    sinceMs,
    bbox: queryBbox,
    ...(signal !== undefined ? { signal } : {}),
    ...(fetcher !== undefined ? { fetcher } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
    now,
    // Wire the grant-side seeded fallback so the demo path keeps working.
    ...(seededGrants !== undefined ? { seededFeatures: seededGrants } : {}),
  });
  if (!grantsRes.ok) {
    return {
      ok: false,
      code: grantsRes.code,
      error: `grants fetch failed: ${grantsRes.error}`,
      ...(correlationId !== undefined ? { correlationId } : {}),
    };
  }

  // Filter to M/G/L tenements — exploration/prospecting don't reclassify.
  const ALLOWED_TYPES = new Set(["M", "G", "L"]);
  const grants = grantsRes.grants.filter((g) => ALLOWED_TYPES.has(g.type));

  // 2. DPIRD landuse parcels.
  const parcelsRes = await fetchDpirdLanduseParcels(queryBbox, {
    ...(signal !== undefined ? { signal } : {}),
    ...(fetcher !== undefined ? { fetcher } : {}),
  });

  let parcels: ReadonlyArray<LandgateParcel>;
  let parcelSourceTag: "live" | "seeded";
  let parcelNote: string | undefined;
  if (parcelsRes.ok) {
    parcels = parcelsRes.features
      .map((f) => featureToParcel(f, "live"))
      .filter((p): p is LandgateParcel => p !== null);
    parcelSourceTag = "live";
  } else if (seededParcels !== undefined) {
    parcels = seededParcels;
    parcelSourceTag = "seeded";
    parcelNote = `DPIRD landuse unreachable (${parcelsRes.error}); using seeded parcels.`;
  } else {
    return {
      ok: false,
      code: parcelsRes.code,
      error: `DPIRD landuse fetch failed: ${parcelsRes.error}`,
      ...(correlationId !== undefined ? { correlationId } : {}),
    };
  }

  // 3. Bbox intersect.
  // Pre-compute parcel bboxes once.
  const parcelBboxes = new Map<LandgateParcel, readonly [number, number, number, number]>();
  for (const p of parcels) {
    const bb = geometryBbox(p.geometry);
    if (bb !== null) parcelBboxes.set(p, bb);
  }

  const candidates: LagCandidate[] = [];
  for (const g of grants) {
    const gb = tenementBoundingBox(g.geometry);
    if (gb === null) continue;
    for (const parcel of parcels) {
      const pb = parcelBboxes.get(parcel);
      if (pb === undefined) continue;
      if (!bboxesOverlap(gb, pb)) continue;
      // 4. Signal predicate.
      const cat = parcel.landuseCategory;
      // Suppress on tenures councils can't reclassify under general rates:
      // already-mining, Crown land, conservation reserves, and pastoral
      // leases (separate Pastoral Lands Act tenure surface).
      if (
        cat === "mining" ||
        cat === "crown" ||
        cat === "conservation" ||
        cat === "pastoral"
      ) {
        continue;
      }
      // 5. Compute downstream fields.
      const lagDays = Math.max(
        0,
        Math.floor((nowMs - g.grantDateMs) / (24 * 60 * 60 * 1000)),
      );
      const severityHint = severityHintFor(g.type, cat);
      const reasoning =
        `Tenement ${g.tenementIdDisplay} (${g.typeLabel}) granted ${g.grantDate}` +
        ` intersects parcel classified as "${parcel.landuse}".` +
        ` Cadastre lag: ${lagDays} day${lagDays === 1 ? "" : "s"}.` +
        ` Reclassification window open.`;
      candidates.push({
        tenement: g,
        parcel,
        lagDays,
        severityHint,
        reasoning,
      });
      if (candidates.length >= maxCandidates) break;
    }
    if (candidates.length >= maxCandidates) break;
  }

  // Sort: severity high → low; within severity, fresher grants first.
  const sevRank: Record<LagSeverityHint, number> = { high: 3, medium: 2, low: 1 };
  candidates.sort((a, b) => {
    const s = sevRank[b.severityHint] - sevRank[a.severityHint];
    if (s !== 0) return s;
    return b.tenement.grantDateMs - a.tenement.grantDateMs;
  });

  // 6. Source tag — both must be live for `live`.
  const grantsSourceTag = grantsRes.source;
  let resultSource: "live" | "seeded" | "cache";
  if (grantsSourceTag === "live" && parcelSourceTag === "live") {
    resultSource = "live";
  } else if (grantsSourceTag === "cache" && parcelSourceTag === "live") {
    resultSource = "cache";
  } else {
    resultSource = "seeded";
  }

  const note = [grantsRes.note, parcelNote].filter((s): s is string => !!s).join(" ");
  return {
    ok: true,
    source: resultSource,
    candidates,
    queriedAt: new Date(nowMs).toISOString(),
    ...(note.length > 0 ? { note } : {}),
  };
}
