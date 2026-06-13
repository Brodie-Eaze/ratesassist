/**
 * @ratesassist/spatial/qld — QLD QSpatial mining tenure WFS probe + seeded fallback.
 *
 * Queensland's Department of Resources publishes mining and exploration tenure
 * via the QSpatial ArcGIS Server at spatial-gis.information.qld.gov.au. The
 * same MapServer endpoint exposes both a WMS (wired in basemaps.ts, E2) and a
 * WFS `/WFSServer` suffix, identical in protocol to the WA DMIRS SLIP pattern.
 *
 * Licencing: Queensland Open Data licence (open, attribution required). No
 * per-layer permission check needed — unlike NSW MinView, QLD tenure layers
 * are published under the blanket open-data licence.
 *
 * Jurisdiction: QLD has ~8,000 active tenements (EPM / ML / MDL / MC / PC),
 * concentrated in the Bowen Basin (coal), Mt Isa (minerals), Cape York
 * (bauxite/minerals), and the Surat Basin (petroleum). Extending
 * mining-tenement mis-classification detection to QLD is the same play as WA
 * (DMIRS) and SA (SARIG) — any parcel inside an active tenement boundary that
 * is NOT rated as Mining has a potential recovery signal.
 *
 * Honest labelling (identical rule to dmirs + sarig):
 *   A successful GetCapabilities probe proves the service is REACHABLE — it is
 *   not feature data. `source: "live"` is RESERVED for parsed GetFeature results
 *   (not yet implemented). Everything else is `"seeded"`.
 *
 * Environment variable: `QLD_TENURE_WFS_BASE` may override the default
 * endpoint within the allowlist. Any value outside the QSpatial host is
 * rejected at module load (same SEC-011 threat model as DMIRS).
 */

import type {
  DmirsErrorCode,
  DmirsFetchResult,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
} from "./types.js";
import {
  buildConditionalHeaders,
  recordResponseHeaders,
} from "./freshness.js";

// The fetch-result + error shapes are jurisdiction-neutral; reuse the DMIRS
// types rather than duplicating them (historical name, generic structure).
export type QldFetchResult = DmirsFetchResult;
export type QldErrorCode = DmirsErrorCode;

// ===== Constants =====

/**
 * Default QLD QSpatial mining tenure WFS base URL.
 * The `/WFSServer` suffix on the ArcGIS MapServer produces an OGC WFS 2.0
 * endpoint identical in protocol to the WA DMIRS SLIP adapter.
 */
const FALLBACK_QLD_TENURE_WFS_BASE =
  "https://spatial-gis.information.qld.gov.au/arcgis/services/Economy/MinesPermitsCurrent/MapServer/WFSServer";

/**
 * Allowlist for any `QLD_TENURE_WFS_BASE` env override — must be the official
 * QSpatial host. Same threat model as DMIRS SEC-011: an env-controlled origin
 * could serve crafted "tenement" payloads into the recovery audit, fabricating
 * signal evidence.
 */
export function isAllowedQldBase(url: string): boolean {
  return /^https:\/\/spatial-gis\.information\.qld\.gov\.au\//i.test(url);
}

const DEFAULT_QLD_TENURE_WFS_BASE: string = (() => {
  let envValue: string | undefined;
  try {
    if (typeof process !== "undefined" && typeof process.env === "object" && process.env !== null) {
      const v = process.env["QLD_TENURE_WFS_BASE"];
      if (typeof v === "string" && v.length > 0) envValue = v;
    }
  } catch {
    // process not available in this runtime — fall through.
  }
  if (envValue !== undefined) {
    if (!isAllowedQldBase(envValue)) {
      throw new Error(
        `QLD_TENURE_WFS_BASE refused: '${envValue}' is not on the QSpatial allowlist ` +
          `(must start with https://spatial-gis.information.qld.gov.au/)`,
      );
    }
    return envValue;
  }
  return FALLBACK_QLD_TENURE_WFS_BASE;
})();

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ===== Cache =====

type CacheEntry = {
  readonly ts: number;
  readonly features: readonly GeoJsonFeature[];
  readonly source: "live" | "seeded";
};

const _cache = new Map<string, CacheEntry>();

// ===== Options =====

export type FetchQldOptions = {
  /** Override the QSpatial WFS base URL (per-call override on top of module default). */
  readonly wfsBase?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly correlationId?: string;
  readonly fetcher?: typeof fetch;
  /**
   * Seeded feature set used when live data is unavailable.
   * Caller-injected; this package bakes in no demo data.
   */
  readonly seededFeatures?: readonly GeoJsonFeature[];
};

function failure(
  code: QldErrorCode,
  error: string,
  correlationId?: string,
): QldFetchResult {
  return correlationId === undefined
    ? { ok: false, code, error }
    : { ok: false, code, error, correlationId };
}

// ===== Public API =====

/**
 * Probe the QLD QSpatial mining-tenure WFS and return tenement features for a
 * region (cache-keyed by `regionKey`, e.g. a council code or LGA name).
 *
 * Behaviour mirrors `fetchSarigTenementsForRegion` and
 * `fetchDmirsTenementsForCouncil`: cache → GetCapabilities probe → honest
 * `"seeded"` labelling (GetFeature parsing not yet implemented) → structured
 * fallback. Errors are returned, not thrown.
 *
 * @param regionKey  Arbitrary region identifier for cache keying. Typical values:
 *   a QLD LGA name or council code (e.g. "ISAAC", "TOWNSVILLE-REGIONAL").
 * @param opts       Optional overrides — fetcher, timeout, seeded fallback, etc.
 */
export async function fetchQldTenementsForRegion(
  regionKey: string,
  opts: FetchQldOptions = {},
): Promise<QldFetchResult> {
  const {
    wfsBase = DEFAULT_QLD_TENURE_WFS_BASE,
    timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    signal,
    correlationId,
    fetcher = fetch,
    seededFeatures,
  } = opts;

  const trimmed = regionKey.trim();
  if (trimmed.length === 0) {
    return failure("invalid_input", "region key required", correlationId);
  }

  const cached = _cache.get(trimmed);
  if (cached !== undefined && Date.now() - cached.ts < CACHE_TTL_MS) {
    return {
      ok: true,
      source: cached.source,
      features: cached.features,
      queriedAt: new Date(cached.ts).toISOString(),
    };
  }

  const ctrl = new AbortController();
  const onCallerAbort = () => ctrl.abort();
  if (signal !== undefined) {
    if (signal.aborted) {
      return failure("timeout", "aborted by caller", correlationId);
    }
    signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const probeUrl = `${wfsBase}?service=WFS&version=2.0.0&request=GetCapabilities`;
  let probeOk = false;
  let probeError: string | null = null;
  let probeWasTimeout = false;

  try {
    const res = await fetcher(probeUrl, {
      signal: ctrl.signal,
      // Conditional GET: If-None-Match / If-Modified-Since on the capabilities
      // URL. A 304 means capabilities haven't changed; probe is still valid.
      headers: buildConditionalHeaders(probeUrl),
    });
    if (res.status === 304) {
      // Server confirms capabilities unchanged — probe passed without body.
      probeOk = true;
    } else if (res.ok) {
      await res.text(); // drain; we don't parse capabilities as feature data
      recordResponseHeaders(probeUrl, res.headers);
      probeOk = true;
    } else {
      probeError = `HTTP ${res.status}`;
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "fetch failed";
    probeWasTimeout =
      e instanceof Error && (e.name === "AbortError" || ctrl.signal.aborted);
    probeError = message;
    if (probeWasTimeout && signal?.aborted === true) {
      clearTimeout(timer);
      signal.removeEventListener("abort", onCallerAbort);
      return failure("timeout", "aborted by caller", correlationId);
    }
  } finally {
    clearTimeout(timer);
    if (signal !== undefined) signal.removeEventListener("abort", onCallerAbort);
  }

  if (probeOk) {
    if (seededFeatures !== undefined) {
      _cache.set(trimmed, { ts: Date.now(), features: seededFeatures, source: "seeded" });
      return {
        ok: true,
        source: "seeded",
        features: seededFeatures,
        queriedAt: new Date().toISOString(),
        note: "QLD QSpatial WFS reachable; live GetFeature parsing not yet implemented — returning caller-provided seeded set.",
      };
    }
    return failure(
      "no_layer_responded",
      "QLD QSpatial WFS reachable but no seeded features supplied and GetFeature parsing not implemented",
      correlationId,
    );
  }

  if (seededFeatures !== undefined) {
    _cache.set(trimmed, { ts: Date.now(), features: seededFeatures, source: "seeded" });
    return {
      ok: true,
      source: "seeded",
      features: seededFeatures,
      queriedAt: new Date().toISOString(),
      note: `QLD QSpatial WFS probe failed (${probeError ?? "unknown"}); using caller-provided seeded set.`,
    };
  }

  return failure(
    probeWasTimeout ? "timeout" : "upstream_error",
    probeError ?? "QLD QSpatial WFS probe failed",
    correlationId,
  );
}

/**
 * Parse a WFS GetFeature GeoJSON payload (shared shape with DMIRS/SARIG).
 * Returns null on parse failure. Used when GetFeature parsing is later
 * implemented — the function is exposed now so callers can wire it in advance.
 */
export function parseQldFeatureCollection(payload: unknown): GeoJsonFeatureCollection | null {
  if (typeof payload !== "object" || payload === null) return null;
  const o = payload as { type?: unknown; features?: unknown };
  if (o.type !== "FeatureCollection") return null;
  if (!Array.isArray(o.features)) return null;
  return { type: "FeatureCollection", features: o.features as readonly GeoJsonFeature[] };
}

/** Test-only cache reset. */
export function __resetQldCacheForTests(): void {
  _cache.clear();
}
