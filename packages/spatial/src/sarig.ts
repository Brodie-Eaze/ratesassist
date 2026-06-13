/**
 * @ratesassist/spatial/sarig — SA SARIG mineral-tenements WFS probe + seeded fallback.
 *
 * South Australia's Resources Information Gateway (SARIG) publishes the
 * `mineral_tenements` layer (all current + historic tenements under the Mining
 * Act 1971) via a GeoServer WFS/WMS, licensed **CC BY 3.0 AU**. This is the SA
 * sibling of {@link ./dmirs} (WA DMIRS): same contract, same honest labelling,
 * so SA mining-tenement mis-classification detection works exactly like WA's.
 *
 * Honest labelling (identical rule to dmirs): a successful GetCapabilities probe
 * only proves the service is REACHABLE — it is not feature data. We reserve
 * `source: "live"` for parsed GetFeature results (not yet implemented) and label
 * everything else `"seeded"`. Library code never depends on env at call time;
 * `SARIG_WFS_BASE` is read at module load only to set the default, gated by an
 * allowlist (mirrors DMIRS SEC-011) so a hostile env can't pivot tenement
 * lookups to a crafted origin and fabricate recovery evidence.
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
// types rather than cloning them (historical name, generic structure).
export type SarigFetchResult = DmirsFetchResult;
export type SarigErrorCode = DmirsErrorCode;

// ===== Constants =====

/** Default SARIG mineral-tenements WFS base (GeoServer). */
const FALLBACK_SARIG_WFS_BASE =
  "https://services.sarig.sa.gov.au/vector/mineral_tenements/wfs";

/**
 * Allowlist for any `SARIG_WFS_BASE` override — must be the official SARIG
 * services host. Same threat model as DMIRS SEC-011: an env-controlled origin
 * could otherwise serve fabricated "tenement" payloads into the recovery audit.
 */
export function isAllowedSarigBase(url: string): boolean {
  return /^https:\/\/services\.sarig\.sa\.gov\.au\//i.test(url);
}

const DEFAULT_SARIG_WFS_BASE: string = (() => {
  let envValue: string | undefined;
  try {
    if (typeof process !== "undefined" && typeof process.env === "object" && process.env !== null) {
      const v = process.env["SARIG_WFS_BASE"];
      if (typeof v === "string" && v.length > 0) envValue = v;
    }
  } catch {
    // process not available in this runtime — fall through.
  }
  if (envValue !== undefined) {
    if (!isAllowedSarigBase(envValue)) {
      throw new Error(
        `SARIG_WFS_BASE refused: '${envValue}' is not on the SARIG allowlist ` +
          `(must start with https://services.sarig.sa.gov.au/)`,
      );
    }
    return envValue;
  }
  return FALLBACK_SARIG_WFS_BASE;
})();

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60 * 60 * 1000;

// ===== Cache =====

type CacheEntry = {
  readonly ts: number;
  readonly features: readonly GeoJsonFeature[];
  readonly source: "live" | "seeded";
};

const _cache = new Map<string, CacheEntry>();

// ===== Options =====

export type FetchSarigOptions = {
  /** Override the SARIG WFS base URL (per-call override on top of module default). */
  readonly wfsBase?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly correlationId?: string;
  readonly fetcher?: typeof fetch;
  /** Seeded feature set used when live data is unavailable (caller-injected; the package bakes in no demo data). */
  readonly seededFeatures?: readonly GeoJsonFeature[];
};

function failure(
  code: SarigErrorCode,
  error: string,
  correlationId?: string,
): SarigFetchResult {
  return correlationId === undefined
    ? { ok: false, code, error }
    : { ok: false, code, error, correlationId };
}

// ===== Public API =====

/**
 * Probe the SARIG mineral-tenements WFS and return tenement features for a
 * region (cache-keyed by `regionKey`, e.g. a council code). Behaviour mirrors
 * {@link fetchDmirsTenementsForCouncil}: cache → GetCapabilities probe → honest
 * `"seeded"` labelling (GetFeature parsing not yet implemented) → structured
 * fallback. Errors are returned, not thrown.
 */
export async function fetchSarigTenementsForRegion(
  regionKey: string,
  opts: FetchSarigOptions = {},
): Promise<SarigFetchResult> {
  const {
    wfsBase = DEFAULT_SARIG_WFS_BASE,
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
    probeWasTimeout = e instanceof Error && (e.name === "AbortError" || ctrl.signal.aborted);
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
        note: "SARIG WFS reachable; live GetFeature parsing not yet implemented — returning caller-provided seeded set.",
      };
    }
    return failure(
      "no_layer_responded",
      "SARIG WFS reachable but no seeded features supplied and GetFeature parsing not implemented",
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
      note: `SARIG WFS probe failed (${probeError ?? "unknown"}); using caller-provided seeded set.`,
    };
  }

  return failure(
    probeWasTimeout ? "timeout" : "upstream_error",
    probeError ?? "SARIG WFS probe failed",
    correlationId,
  );
}

/** Parse a WFS GetFeature GeoJSON payload (shared shape with DMIRS). Returns null on parse failure. */
export function parseSarigFeatureCollection(payload: unknown): GeoJsonFeatureCollection | null {
  if (typeof payload !== "object" || payload === null) return null;
  const o = payload as { type?: unknown; features?: unknown };
  if (o.type !== "FeatureCollection") return null;
  if (!Array.isArray(o.features)) return null;
  return { type: "FeatureCollection", features: o.features as readonly GeoJsonFeature[] };
}

/** Test-only cache reset. */
export function __resetSarigCacheForTests(): void {
  _cache.clear();
}
