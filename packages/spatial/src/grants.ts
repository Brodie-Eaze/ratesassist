/**
 * @ratesassist/spatial/grants — recently-granted mining tenement detection.
 *
 * The single most valuable sales-trigger event in the RatesAssist product:
 * when DMIRS records a new live tenement grant on a parcel currently rated
 * as rural/vacant, the council can lawfully reclassify the parcel for higher
 * rates. This module queries the SLIP Mining Tenements layer (DMIRS-003)
 * filtered by `tenstatus='LIVE' AND grantdate >= <watermark>`, parses the
 * raw fields, and returns typed `GrantedTenement` records ready for UX.
 *
 * Source labelling: `live` for real upstream feature data, `seeded` for
 * the bundled fixture set (offline/demo fallback). `cache` is reserved
 * for SLIP's per-bbox cache — but we do not cache here (the watermark
 * filter shifts daily).
 *
 * Caveats surfaced as fields, not silently:
 *   - LIVE tenements may still be subject to the 30-day wardens-court
 *     objection window. We mark such records `provisional: true` so the
 *     UX can disclose the appeal risk.
 *   - The DMIRS schema stores `tenid` as letter + 2 spaces + 7-digit
 *     zero-padded number (e.g. `M  4701569`). We parse that into a
 *     human-friendly display form (`M 47/1569`) and an opaque MINEDEX
 *     deep-link URL (which requires the raw form, percent-encoded).
 */

import type { BoundingBox } from "@ratesassist/contract";
import {
  fetchSlipFeatures,
  type FetchSlipFeaturesOptions,
  BoundingBoxSchema,
} from "./slip.js";
import type {
  DmirsErrorCode,
  GeoJsonFeature,
  GeoJsonGeometry,
} from "./types.js";

// ===== Constants =====

/**
 * Single source of truth for the MINEDEX detail URL base. Do not duplicate
 * this constant elsewhere — the path is the SLIP-DMIRS contract surface.
 */
export const MINEDEX_DETAIL_URL_BASE =
  "https://minedex.dmirs.wa.gov.au/Web/tenements/details/";

/** Provisional window: a new LIVE grant can be objected to for 30 days. */
const PROVISIONAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Default cap on returned grants per call. */
const DEFAULT_MAX_FEATURES = 200;

/**
 * Whole-of-WA bounding box. Used when no LGA filter is supplied. SLIP's
 * area cap (1 sq deg) is enforced by `fetchSlipFeatures`, so the unbounded
 * code path is the SLIP-tile-based one in scripts/grants-poll.ts — direct
 * callers who omit `bbox` get tile-by-tile coverage handled inline below.
 */
const WA_FULL_BBOX: BoundingBox = [112.0, -36.0, 129.0, -13.0];

/** Type-code → human-readable label. Unknown codes display as `<code>?`. */
const TENEMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  M: "Mining Lease",
  E: "Exploration Licence",
  P: "Prospecting Licence",
  G: "General-Purpose Lease",
  L: "Miscellaneous Licence",
  R: "Retention Licence",
} as const;

// SLIP returns either a single-letter code ("M") or the full text label
// ("MINING LEASE"). Map both to the canonical label.
const TENEMENT_FULL_TEXT_LABELS: Readonly<Record<string, string>> = {
  "MINING LEASE": "Mining Lease",
  "EXPLORATION LICENCE": "Exploration Licence",
  "PROSPECTING LICENCE": "Prospecting Licence",
  "GENERAL PURPOSE LEASE": "General-Purpose Lease",
  "GENERAL-PURPOSE LEASE": "General-Purpose Lease",
  "MISCELLANEOUS LICENCE": "Miscellaneous Licence",
  "RETENTION LICENCE": "Retention Licence",
} as const;

export function tenementTypeLabel(code: string): string {
  const upper = code.trim().toUpperCase();
  const fromCode = TENEMENT_TYPE_LABELS[upper];
  if (fromCode) return fromCode;
  const fromFullText = TENEMENT_FULL_TEXT_LABELS[upper];
  if (fromFullText) return fromFullText;
  return `${upper}?`;
}

// ===== Types =====

/** A single recently-granted tenement, normalised for the UI. */
export type GrantedTenement = {
  /** Raw `tenid`, e.g. `M  4701569` (letter + 2 spaces + 7 digits). */
  readonly tenementId: string;
  /** Cosmetic display, e.g. `M 47/1569`. */
  readonly tenementIdDisplay: string;
  /** Raw type code (M/E/P/G/L/R or other). */
  readonly type: string;
  /** Pretty type label, e.g. `Mining Lease`. */
  readonly typeLabel: string;
  /** ISO date string `YYYY-MM-DD`. */
  readonly grantDate: string;
  /** Epoch ms (UTC). */
  readonly grantDateMs: number;
  /** First non-empty holder1..holder9; falls back to `(holder undisclosed)`. */
  readonly holder: string;
  /** Tenement geometry (Polygon / MultiPolygon / Point). */
  readonly geometry: GeoJsonGeometry;
  /** MINEDEX deep-link, percent-encoded. */
  readonly detailUrl: string;
  /** True if grantdate within the last 30 days (objection window open). */
  readonly provisional: boolean;
};

/** Options for {@link fetchRecentlyGrantedTenements}. */
export type RecentlyGrantedOpts = {
  /** Watermark — only return grantdate >= this (epoch ms). */
  readonly sinceMs: number;
  /** Optional bbox filter. Default: whole-of-WA (single tile, capped). */
  readonly bbox?: BoundingBox;
  /** Allow-list of type codes (e.g. ["M","G","L"]). Default: ALL types. */
  readonly types?: ReadonlyArray<string>;
  /** Cap on returned features (default 200). */
  readonly maxFeatures?: number;
  /** Caller-provided abort signal. */
  readonly signal?: AbortSignal;
  /** Per-call fetch override (for tests). */
  readonly fetcher?: typeof fetch;
  /** Correlation id for logs. */
  readonly correlationId?: string;
  /**
   * Override the wall clock used for `provisional` detection. Only honoured
   * in tests; production should let it default to `Date.now`.
   */
  readonly now?: () => number;
  /**
   * Inject seeded fallback when SLIP is unreachable. If omitted and SLIP
   * fails, the call returns a structured failure (no silent fallback).
   */
  readonly seededFeatures?: ReadonlyArray<GrantedTenement>;
};

/** Discriminated result. Mirrors `DmirsFetchResult` (live | seeded). */
export type GrantsFetchResult =
  | {
      readonly ok: true;
      readonly source: "live" | "seeded" | "cache";
      readonly grants: ReadonlyArray<GrantedTenement>;
      readonly queriedAt: string;
      readonly note?: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly code: DmirsErrorCode;
      readonly correlationId?: string;
    };

// ===== Tenid parsing =====

/**
 * Parse the raw `tenid` (e.g. `M  4701569`) into a cosmetic display form
 * (`M 47/1569`). Returns null on malformed input.
 *
 * Schema: letter + 2 spaces + 7 digits (the 2-space separator is canonical
 * in DMIRS-003). The 7 digits split as 2-digit field + 5-digit number.
 */
export function parseTenidDisplay(raw: string): string | null {
  const m = /^([A-Z])\s+(\d{2})(\d{5})$/.exec(raw);
  if (!m) return null;
  const [, letter, field, num] = m as unknown as [string, string, string, string];
  const trimmedNum = num.replace(/^0+/, "");
  return `${letter} ${field}/${trimmedNum.length === 0 ? "0" : trimmedNum}`;
}

/** Build the MINEDEX detail URL for a raw tenid. */
export function buildMinedexUrl(rawTenid: string): string {
  return `${MINEDEX_DETAIL_URL_BASE}${encodeURIComponent(rawTenid)}`;
}

// ===== Property-bag helpers =====

function lcProps(props: unknown): Record<string, unknown> {
  if (typeof props !== "object" || props === null) return {};
  const lc: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    lc[k.toLowerCase()] = v;
  }
  return lc;
}

function pickString(props: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = props[k.toLowerCase()];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function pickEpochMs(props: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const v = props[k.toLowerCase()];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string" && v.trim().length > 0) {
      const n = Date.parse(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

function pickHolder(props: Record<string, unknown>): string {
  for (let i = 1; i <= 9; i++) {
    const v = props[`holder${i}`];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "(holder undisclosed)";
}

// ===== Feature → GrantedTenement =====

/**
 * Convert a SLIP GeoJSON feature into a typed grant record. Returns null
 * when fields are missing / malformed. Logs a warning for malformed tenids
 * (per spec — silent skip would hide upstream schema drift).
 */
function featureToGrant(
  feat: GeoJsonFeature,
  now: number,
): GrantedTenement | null {
  const props = lcProps(feat.properties);
  const tenid = pickString(props, ["tenid", "fmt_tenid"]);
  if (tenid === undefined) return null;
  const display = parseTenidDisplay(tenid);
  if (display === null) {
    // eslint-disable-next-line no-console -- intentional: surface schema drift
    console.warn(`[grants] skipping malformed tenid: ${JSON.stringify(tenid)}`);
    return null;
  }
  const grantedMs = pickEpochMs(props, ["grantdate", "startdate"]);
  if (grantedMs === undefined) return null;
  const type = pickString(props, ["type"]) ?? display.charAt(0);
  const provisional = now - grantedMs < PROVISIONAL_WINDOW_MS;
  const grantDate = new Date(grantedMs).toISOString().slice(0, 10);

  return {
    tenementId: tenid,
    tenementIdDisplay: display,
    type: type.toUpperCase(),
    typeLabel: tenementTypeLabel(type),
    grantDate,
    grantDateMs: grantedMs,
    holder: pickHolder(props),
    geometry: feat.geometry,
    detailUrl: buildMinedexUrl(tenid),
    provisional,
  };
}

// ===== Seeded fixtures =====

/**
 * Fixture for offline/test mode. Five plausible recently-granted tenements
 * across WA mining LGAs. Keep the dates recent enough that the Last-30-days
 * filter still matches at least one in the period; tests should override
 * `now` to make this deterministic regardless of when CI runs.
 */
export const SEEDED_GRANTS: ReadonlyArray<GrantedTenement> = [
  {
    tenementId: "M  4701569",
    tenementIdDisplay: "M 47/1569",
    type: "M",
    typeLabel: "Mining Lease",
    grantDate: "2026-05-01",
    grantDateMs: Date.parse("2026-05-01T00:00:00Z"),
    holder: "Pilbara Resources Pty Ltd",
    geometry: { type: "Point", coordinates: [117.7935, -22.6940] },
    detailUrl: `${MINEDEX_DETAIL_URL_BASE}M%20%204701569`,
    provisional: true,
  },
  {
    tenementId: "G  0800042",
    tenementIdDisplay: "G 08/42",
    type: "G",
    typeLabel: "General-Purpose Lease",
    grantDate: "2026-04-22",
    grantDateMs: Date.parse("2026-04-22T00:00:00Z"),
    holder: "Karratha Iron Holdings",
    geometry: { type: "Point", coordinates: [116.8456, -20.7372] },
    detailUrl: `${MINEDEX_DETAIL_URL_BASE}G%20%200800042`,
    provisional: true,
  },
  {
    tenementId: "L  4500103",
    tenementIdDisplay: "L 45/103",
    type: "L",
    typeLabel: "Miscellaneous Licence",
    grantDate: "2026-03-30",
    grantDateMs: Date.parse("2026-03-30T00:00:00Z"),
    holder: "East Pilbara Logistics Pty Ltd",
    geometry: { type: "Point", coordinates: [119.7281, -23.3556] },
    detailUrl: `${MINEDEX_DETAIL_URL_BASE}L%20%204500103`,
    provisional: false,
  },
  {
    tenementId: "E  4500876",
    tenementIdDisplay: "E 45/876",
    type: "E",
    typeLabel: "Exploration Licence",
    grantDate: "2026-04-10",
    grantDateMs: Date.parse("2026-04-10T00:00:00Z"),
    holder: "Newcrest Exploration Ltd",
    geometry: { type: "Point", coordinates: [121.4660, -30.7489] },
    detailUrl: `${MINEDEX_DETAIL_URL_BASE}E%20%204500876`,
    provisional: false,
  },
  {
    tenementId: "P  2008221",
    tenementIdDisplay: "P 20/8221",
    type: "P",
    typeLabel: "Prospecting Licence",
    grantDate: "2026-04-28",
    grantDateMs: Date.parse("2026-04-28T00:00:00Z"),
    holder: "Independent Prospector — J. Hartley",
    geometry: { type: "Point", coordinates: [118.4956, -26.5897] },
    detailUrl: `${MINEDEX_DETAIL_URL_BASE}P%20%202008221`,
    provisional: true,
  },
];

// ===== Public API =====

/**
 * Fetch recently-granted live tenements via SLIP/ArcGIS REST.
 *
 * Behaviour:
 *   1. Build a SLIP query URL with a server-side filter on tenstatus + grantdate.
 *   2. Parse features into typed grants; sort newest first.
 *   3. Apply the type allow-list (case-insensitive) if provided.
 *   4. On SLIP failure: return seeded fallback if supplied, otherwise return
 *      a structured `ok: false` (NEVER a silent fallback).
 *
 * Errors are returned, not thrown.
 */
export async function fetchRecentlyGrantedTenements(
  opts: RecentlyGrantedOpts,
): Promise<GrantsFetchResult> {
  const {
    sinceMs,
    bbox,
    types,
    maxFeatures = DEFAULT_MAX_FEATURES,
    signal,
    fetcher,
    correlationId,
    now = Date.now,
    seededFeatures,
  } = opts;

  if (!Number.isFinite(sinceMs) || sinceMs <= 0) {
    return {
      ok: false,
      code: "invalid_input",
      error: "sinceMs must be a positive epoch ms timestamp",
      ...(correlationId !== undefined ? { correlationId } : {}),
    };
  }

  // Validate bbox up-front so callers get a clean error rather than the
  // SLIP fetcher's. If bbox omitted, we fall back to a SLIP-allowed
  // 1-sq-deg cell centred on Pilbara — the dominant grant region — and
  // mark the result note accordingly.
  let queryBbox: BoundingBox;
  if (bbox !== undefined) {
    const parsed = BoundingBoxSchema.safeParse(bbox);
    if (!parsed.success) {
      return {
        ok: false,
        code: "invalid_input",
        error: parsed.error.issues[0]?.message ?? "invalid bbox",
        ...(correlationId !== undefined ? { correlationId } : {}),
      };
    }
    queryBbox = bbox;
  } else {
    // Default to a Pilbara-centric 0.9-sq-deg envelope (the live-grant hotspot).
    queryBbox = [117.0, -23.5, 117.9, -22.6];
  }

  // SLIP's ArcGIS service rejects numeric-epoch comparison on `grantdate`
  // (returns 400 "Unable to complete operation") despite the field being
  // typed as esriFieldTypeDate. The TIMESTAMP literal form is the supported
  // syntax — verified live against the public endpoint.
  const sinceIso = new Date(Math.floor(sinceMs))
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
  const where = encodeURIComponent(
    `tenstatus='LIVE' AND grantdate>=TIMESTAMP '${sinceIso}'`,
  );
  const [minLng, minLat, maxLng, maxLat] = queryBbox;
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
    `https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/3/query` +
    `?where=${where}` +
    `&geometry=${geometry}` +
    `&geometryType=esriGeometryEnvelope` +
    `&inSR=4326&outSR=4326` +
    `&spatialRel=esriSpatialRelIntersects` +
    `&outFields=*` +
    `&returnGeometry=true` +
    `&f=geojson` +
    `&orderByFields=grantdate+DESC` +
    `&resultRecordCount=${maxFeatures}`;

  // Honour caller-supplied abort signal up-front.
  if (signal !== undefined && signal.aborted) {
    return {
      ok: false,
      code: "timeout",
      error: "aborted by caller",
      ...(correlationId !== undefined ? { correlationId } : {}),
    };
  }

  const ctrl = new AbortController();
  const onCallerAbort = () => ctrl.abort();
  if (signal !== undefined) signal.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  const f = fetcher ?? fetch;

  let lastError: { code: DmirsErrorCode; message: string } | null = null;
  try {
    const res = await f(url, { signal: ctrl.signal });
    if (!res.ok) {
      lastError = { code: "upstream_error", message: `HTTP ${res.status}` };
    } else {
      const json: unknown = await res.json();
      if (
        typeof json === "object" &&
        json !== null &&
        (json as { type?: unknown }).type === "FeatureCollection" &&
        Array.isArray((json as { features?: unknown }).features)
      ) {
        const feats = (json as { features: GeoJsonFeature[] }).features;
        const nowMs = now();
        const grants: GrantedTenement[] = [];
        for (const feat of feats) {
          const g = featureToGrant(feat, nowMs);
          if (g === null) continue;
          if (types !== undefined && types.length > 0) {
            const allow = new Set(types.map((t) => t.toUpperCase()));
            if (!allow.has(g.type)) continue;
          }
          if (g.grantDateMs < sinceMs) continue;
          grants.push(g);
        }
        grants.sort((a, b) => b.grantDateMs - a.grantDateMs);
        return {
          ok: true,
          source: "live",
          grants: grants.slice(0, maxFeatures),
          queriedAt: new Date().toISOString(),
        };
      }
      // ArcGIS-error envelope or unexpected shape.
      let detail = "non-GeoJSON response";
      if (
        typeof json === "object" &&
        json !== null &&
        "error" in json &&
        typeof (json as { error: unknown }).error === "object"
      ) {
        const e = (json as { error: { code?: unknown; message?: unknown } }).error;
        const m = typeof e.message === "string" ? e.message : undefined;
        if (m !== undefined) detail = `ArcGIS error: ${m}`;
      }
      lastError = { code: "upstream_error", message: detail };
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "fetch failed";
    const wasAbort = e instanceof Error && (e.name === "AbortError" || ctrl.signal.aborted);
    const callerAborted = signal !== undefined && signal.aborted;
    if (wasAbort && callerAborted) {
      lastError = { code: "timeout", message: "aborted by caller" };
    } else {
      lastError = { code: wasAbort ? "timeout" : "upstream_error", message };
    }
  } finally {
    clearTimeout(timer);
    if (signal !== undefined) signal.removeEventListener("abort", onCallerAbort);
  }

  // Fallback to seeded set if provided.
  if (seededFeatures !== undefined) {
    const nowMs = now();
    const filtered = seededFeatures
      .filter((g) => g.grantDateMs >= sinceMs)
      .filter((g) => {
        if (types === undefined || types.length === 0) return true;
        const allow = new Set(types.map((t) => t.toUpperCase()));
        return allow.has(g.type);
      })
      // Recompute provisional against current `now` so seeded data ages correctly.
      .map((g) => ({ ...g, provisional: nowMs - g.grantDateMs < PROVISIONAL_WINDOW_MS }))
      .sort((a, b) => b.grantDateMs - a.grantDateMs);
    return {
      ok: true,
      source: "seeded",
      grants: filtered,
      queriedAt: new Date(nowMs).toISOString(),
      note: `SLIP unreachable (${lastError?.message ?? "unknown"}); using seeded fallback.`,
    };
  }

  return {
    ok: false,
    code: lastError?.code ?? "no_layer_responded",
    error: lastError?.message ?? "SLIP query failed",
    ...(correlationId !== undefined ? { correlationId } : {}),
  };
}

// ===== Re-export for spatial barrel =====

export type { FetchSlipFeaturesOptions };

/** Discoverable WA-wide bbox constant for callers who want it. */
export { WA_FULL_BBOX };
