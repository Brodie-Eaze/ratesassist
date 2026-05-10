/**
 * @ratesassist/spatial/dmirs — DMIRS WFS probe + seeded fallback.
 *
 * The Department of Mines, Industry Regulation and Safety (DMIRS) publishes
 * WA Mining Tenement layers via SLIP's WFS endpoint. This module probes the
 * service for availability and returns a structured result indicating either
 * `"live"` data (parsed from a real WFS GetFeature response) or `"seeded"`
 * fallback data supplied by the caller.
 *
 * CRITICAL DIFFERENCE FROM LEGACY:
 *   The legacy `apps/web/lib/dmirs.ts` returned `source: "seeded"` even when
 *   the upstream capabilities probe succeeded — but it called the result
 *   "live availability confirmed". That was misleading: a successful probe
 *   does NOT mean we have live feature data, only that the service is
 *   reachable. This implementation reserves `"live"` for actual feature
 *   data and labels everything else honestly.
 *
 * The library does not depend on environment variables at call time, but
 * `DMIRS_WFS_BASE` is read at module load to provide a sensible default
 * matching the legacy behaviour. Every public function exposes a `wfsBase`
 * override so callers can supply their own (per the package design rule
 * that library code must not depend on environment).
 */

import type {
  DmirsErrorCode,
  DmirsFetchResult,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
} from "./types.js";

// ===== Constants =====

/**
 * Default SLIP WFS base URL. Read once at module load from `DMIRS_WFS_BASE`
 * if available; falls back to the well-known SLIP endpoint.
 *
 * `process` may be undefined in some bundling targets — guarded accordingly.
 */
const FALLBACK_DMIRS_WFS_BASE =
  "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Industry_and_Mining/MapServer/WFSServer";

/**
 * SEC-011: DMIRS_WFS_BASE allowlist. Any env-supplied override must point
 * at the official WA SLIP service. Without this gate, an attacker who
 * controls the env (e.g. via a misconfigured PaaS dashboard) could pivot
 * tenement lookups to a hostile origin and serve crafted "mining tenement"
 * payloads back into the recovery audit, fabricating signal evidence.
 *
 * The allowlist is intentionally narrow: only the slip.wa.gov.au public
 * services host. Internal or staging variants must be added explicitly.
 */
export function isAllowedDmirsBase(url: string): boolean {
  return /^https:\/\/services\.slip\.wa\.gov\.au\//i.test(url);
}

const DEFAULT_DMIRS_WFS_BASE: string = (() => {
  let envValue: string | undefined;
  try {
    if (typeof process !== "undefined" && typeof process.env === "object" && process.env !== null) {
      const v = process.env["DMIRS_WFS_BASE"];
      if (typeof v === "string" && v.length > 0) envValue = v;
    }
  } catch {
    // process not available in this runtime — fall through.
  }
  if (envValue !== undefined) {
    if (!isAllowedDmirsBase(envValue)) {
      throw new Error(
        `DMIRS_WFS_BASE refused: '${envValue}' is not on the SLIP allowlist ` +
          `(must start with https://services.slip.wa.gov.au/)`,
      );
    }
    return envValue;
  }
  return FALLBACK_DMIRS_WFS_BASE;
})();

/** Default per-request timeout for the capabilities probe. */
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/** Cache TTL for both live and seeded results. */
const CACHE_TTL_MS = 60 * 60 * 1000;

// ===== Cache =====

type CacheEntry = {
  readonly ts: number;
  readonly features: readonly GeoJsonFeature[];
  readonly source: "live" | "seeded";
};

/**
 * Process-local cache keyed by council code. Cleared on dev reload. As with
 * the SLIP cache, multi-replica deployments should layer on a shared cache.
 */
const _cache = new Map<string, CacheEntry>();

// ===== Options =====

/** Optional knobs on `fetchDmirsTenementsForCouncil`. */
export type FetchDmirsOptions = {
  /** Override the SLIP WFS base URL (per-call override on top of module default). */
  readonly wfsBase?: string;
  /** Timeout for the capabilities probe in milliseconds (default 5000). */
  readonly timeoutMs?: number;
  /** Caller-provided abort signal — fires `code: "timeout"` when triggered. */
  readonly signal?: AbortSignal;
  /** Correlation ID propagated into failure results for log tracing. */
  readonly correlationId?: string;
  /** Injectable fetcher for tests. */
  readonly fetcher?: typeof fetch;
  /**
   * Seeded feature set used when live data is unavailable. The library does
   * NOT pre-bake demo data — callers (such as the web app) inject their own.
   * This keeps the package free of demo content and free of dependencies on
   * other workspace packages' fixtures.
   */
  readonly seededFeatures?: readonly GeoJsonFeature[];
};

// ===== Errors =====

function failure(
  code: DmirsErrorCode,
  error: string,
  correlationId?: string,
): DmirsFetchResult {
  return correlationId === undefined
    ? { ok: false, code, error }
    : { ok: false, code, error, correlationId };
}

// ===== Public API =====

/**
 * Probe the DMIRS WFS endpoint for availability and return tenement features.
 *
 * Behaviour:
 *   1. Validate `councilCode` (non-empty trimmed string).
 *   2. Return the cached entry if one exists and is younger than `CACHE_TTL_MS`.
 *   3. Issue a `GetCapabilities` request to the WFS base.
 *   4. **Honest labelling rule:** because this implementation does NOT yet
 *      parse `GetFeature` responses, even a successful capabilities probe
 *      yields `source: "seeded"` — provided the caller supplied seeded
 *      features. A future change that parses `GetFeature` should set
 *      `source: "live"` only when real features are returned.
 *   5. On probe failure, return seeded features (with a `note`) if available,
 *      otherwise return a structured `ok: false` result.
 *
 * Errors are returned, not thrown.
 *
 * @param councilCode  Tenant identifier (e.g. "TPS"). Used as the cache key.
 * @param opts         See `FetchDmirsOptions`.
 * @returns            Discriminated `DmirsFetchResult`.
 */
export async function fetchDmirsTenementsForCouncil(
  councilCode: string,
  opts: FetchDmirsOptions = {},
): Promise<DmirsFetchResult> {
  const {
    wfsBase = DEFAULT_DMIRS_WFS_BASE,
    timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    signal,
    correlationId,
    fetcher = fetch,
    seededFeatures,
  } = opts;

  const trimmed = councilCode.trim();
  if (trimmed.length === 0) {
    return failure("invalid_input", "council code required", correlationId);
  }

  // Cache hit — preserves source label.
  const cached = _cache.get(trimmed);
  if (cached !== undefined && Date.now() - cached.ts < CACHE_TTL_MS) {
    return {
      ok: true,
      source: cached.source,
      features: cached.features,
      queriedAt: new Date(cached.ts).toISOString(),
    };
  }

  // Compose abort controller.
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
    const res = await fetcher(probeUrl, { signal: ctrl.signal });
    if (res.ok) {
      // Drain the body so we don't leak the connection. We don't parse it —
      // honest labelling means we won't pretend a capabilities response is
      // feature data.
      await res.text();
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

  // Probe-success path: we still don't have feature data, so it's seeded.
  if (probeOk) {
    if (seededFeatures !== undefined) {
      _cache.set(trimmed, { ts: Date.now(), features: seededFeatures, source: "seeded" });
      return {
        ok: true,
        source: "seeded",
        features: seededFeatures,
        queriedAt: new Date().toISOString(),
        note: "DMIRS WFS reachable; live GetFeature parsing not yet implemented — returning caller-provided seeded set.",
      };
    }
    // Probe was reachable but caller did not supply seeded features and we
    // have not implemented GetFeature parsing — there's nothing to return.
    return failure(
      "no_layer_responded",
      "DMIRS WFS reachable but no seeded features supplied and GetFeature parsing not implemented",
      correlationId,
    );
  }

  // Probe-failure path: seeded fallback if available.
  if (seededFeatures !== undefined) {
    _cache.set(trimmed, { ts: Date.now(), features: seededFeatures, source: "seeded" });
    return {
      ok: true,
      source: "seeded",
      features: seededFeatures,
      queriedAt: new Date().toISOString(),
      note: `DMIRS WFS probe failed (${probeError ?? "unknown"}); using caller-provided seeded set.`,
    };
  }

  return failure(
    probeWasTimeout ? "timeout" : "upstream_error",
    probeError ?? "DMIRS WFS probe failed",
    correlationId,
  );
}

/**
 * Parse a WFS `GetFeature` GeoJSON payload. Exposed so callers can wire up
 * their own GetFeature loop once the WFS request shape stabilises; not yet
 * called from `fetchDmirsTenementsForCouncil`.
 *
 * Returns `null` on parse failure so callers can decide whether to fall back
 * to seeded data without us throwing.
 */
export function parseWfsFeatureCollection(payload: unknown): GeoJsonFeatureCollection | null {
  if (typeof payload !== "object" || payload === null) return null;
  const o = payload as { type?: unknown; features?: unknown };
  if (o.type !== "FeatureCollection") return null;
  if (!Array.isArray(o.features)) return null;
  return { type: "FeatureCollection", features: o.features as readonly GeoJsonFeature[] };
}

/** Test-only cache reset. */
export function __resetDmirsCacheForTests(): void {
  _cache.clear();
}
