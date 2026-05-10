/**
 * @ratesassist/identity/abn — ATO ABN Lookup integration.
 *
 * Public ABR web API:
 *   https://abr.business.gov.au/json/AbnDetails.aspx?abn=...&guid=...
 *
 * Free for production use, but the live endpoint requires a registered GUID
 * (per https://abr.business.gov.au/Tools/WebServices). Without a GUID, the
 * library returns honest mock data marked `source: "mock"` — only when the
 * caller explicitly opts into mock mode by NOT supplying a GUID.
 *
 * CRITICAL DIFFERENCE FROM LEGACY:
 *   The legacy `apps/web/lib/abn.ts` silently fell back to mock data when a
 *   live call failed despite a configured GUID. That conflated "no GUID"
 *   with "live call failed" — both returned `source: "mock"`. This library
 *   distinguishes:
 *     - GUID configured + live call succeeded            → `source: "ato"`
 *     - GUID configured + cached prior live result       → `source: "cache"`
 *     - GUID configured + live call failed                → `ok: false`
 *     - GUID NOT configured                               → `source: "mock"`
 *   The strict mode (`{ strict: true }`) refuses to return mock under any
 *   circumstance — pilot environments use this so that "no GUID configured"
 *   surfaces as a configuration error rather than as silently-degraded data.
 */

import { z } from "zod";

// ===== Constants =====

/** Default ABR JSON web-service base URL. */
const DEFAULT_ABN_LOOKUP_BASE = "https://abr.business.gov.au/json";

/** Default per-attempt timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** Single retry on retriable upstream codes. */
const MAX_RETRIES = 1;

/** Back-off between attempts (milliseconds). */
const RETRY_BACKOFF_MS = 1_500;

/** HTTP status codes considered retriable. */
const RETRIABLE_STATUS_CODES = new Set<number>([429, 503, 504]);

/**
 * Cache TTL for live ABN responses. ABN status changes are rare, so 24h is
 * a good balance between freshness and cost — well within ABR's published
 * change cadence.
 *
 * NOTE (Phase 2): this cache is process-local. Multi-replica deployments
 * MUST migrate to Redis to share state and to bound the per-process memory
 * footprint. The shape (`{ ts: number, value: AbnLookupResult }`) is small
 * enough to lift-and-shift directly; the caller surface stays unchanged.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** ABR's "ABN not found" status string. */
const ABR_STATUS_NOT_FOUND = "0000000003";

// ===== Result types =====

/** Possible failure codes returned by `lookupAbn`. */
export type AbnErrorCode =
  | "invalid_input"
  | "not_found"
  | "timeout"
  | "upstream_error"
  | "unconfigured";

/**
 * Discriminated lookup result.
 *
 * `source` distinguishes:
 *   - `"ato"`   — live response from the ABR JSON endpoint
 *   - `"cache"` — a previously-live response served from the in-memory cache
 *   - `"mock"`  — pre-seeded demo data; only returned when no GUID is
 *                 configured AND the caller did not pass `{ strict: true }`
 */
export type AbnLookupResult =
  | {
      readonly ok: true;
      readonly source: "ato" | "cache" | "mock";
      readonly abn: string;
      readonly entityName: string;
      readonly entityType?: string;
      readonly status: "Active" | "Cancelled" | "Suspended" | "Unknown";
      readonly gstRegistered: boolean;
      readonly gstRegisteredFrom?: string;
      readonly address?: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly code: AbnErrorCode;
      readonly correlationId?: string;
    };

// ===== Mock data =====

/**
 * Pre-seeded demo entries. Useful for offline development and demo flows
 * where there is genuinely no GUID configured. Each entry is explicitly
 * labelled `source: "mock"` at the call site.
 */
const MOCK_ENTRIES: Readonly<Record<string, Omit<Extract<AbnLookupResult, { ok: true }>, "source">>> =
  Object.freeze({
    "32614882110": {
      ok: true,
      abn: "32 614 882 110",
      entityName: "Pilbara Iron Holdings Pty Ltd",
      entityType: "Australian Private Company",
      status: "Active",
      gstRegistered: true,
      gstRegisteredFrom: "2014-08-19",
      address: "Level 12, 100 St Georges Terrace, Perth WA 6000",
    },
    "44990221005": {
      ok: true,
      abn: "44 990 221 005",
      entityName: "Karratha Exploration Pty Ltd",
      entityType: "Australian Private Company",
      status: "Active",
      gstRegistered: true,
      gstRegisteredFrom: "2022-11-14",
      address: "PO Box 5511, Karratha WA 6714",
    },
    "18552117884": {
      ok: true,
      abn: "18 552 117 884",
      entityName: "Goldfields Resources Ltd",
      entityType: "Australian Public Company",
      status: "Active",
      gstRegistered: true,
      gstRegisteredFrom: "2009-06-22",
      address: "Level 5, 50 Kings Park Road, West Perth WA 6005",
    },
  });

// ===== Validation =====

/** ABN as 11 digits, after whitespace and hyphen normalisation. */
const AbnSchema = z.string().regex(/^\d{11}$/, "ABN must be 11 digits");

/**
 * Loose schema for the ABR JSON response. ABR returns more fields than we
 * model; we narrow only what we use, and `passthrough` lets extra fields
 * sail past unparsed.
 */
const AbrResponseSchema = z
  .object({
    Abn: z.string().optional(),
    AbnStatus: z.string().optional(),
    EntityName: z.string().optional(),
    EntityTypeName: z.string().optional(),
    Gst: z.string().optional(),
    GstFromDate: z.string().optional(),
    AddressState: z.string().optional(),
    AddressPostcode: z.string().optional(),
  })
  .passthrough();

// ===== Cache =====

type CacheEntry = {
  readonly ts: number;
  readonly value: Extract<AbnLookupResult, { ok: true }>;
};

const _cache = new Map<string, CacheEntry>();

// ===== Helpers =====

/** Strip whitespace and hyphens from an ABN. */
function normaliseAbn(abn: string): string {
  return abn.replace(/\s+/g, "").replace(/-/g, "");
}

/** Format an 11-digit ABN as "NN NNN NNN NNN". */
function formatAbn(clean: string): string {
  return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4");
}

/**
 * Map ABR's `AbnStatus` field to our four-state union. ABR returns either a
 * status code (e.g. `"0000000003"`) or a human-readable string ("Active");
 * we accept both.
 */
function mapStatus(raw: string | undefined): "Active" | "Cancelled" | "Suspended" | "Unknown" {
  if (raw === undefined) return "Unknown";
  if (raw === "Active") return "Active";
  if (raw === "Cancelled") return "Cancelled";
  if (raw === "Suspended") return "Suspended";
  return "Unknown";
}

/** Sleep for `ms` milliseconds, respecting an optional abort signal. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      if (signal !== undefined) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    if (signal !== undefined) signal.addEventListener("abort", onAbort, { once: true });
  });
}

function failure(code: AbnErrorCode, error: string, correlationId?: string): AbnLookupResult {
  return correlationId === undefined
    ? { ok: false, code, error }
    : { ok: false, code, error, correlationId };
}

// ===== Configuration =====

/**
 * Configuration for an ABN client. Library code does NOT read environment
 * variables; the consuming app reads `process.env` and constructs config.
 */
export type AbnClientConfig = {
  /** ABR endpoint base URL. Defaults to the public production endpoint. */
  readonly baseUrl?: string;
  /**
   * Registered ABR GUID. When omitted (or empty), live lookups are not
   * attempted and mock results are returned for known ABNs (unless `strict`).
   */
  readonly guid?: string;
  /**
   * Strict-live mode. When `true`, the client never returns mock data — even
   * if no GUID is configured. Useful for pilot environments where mock data
   * would be a correctness hazard. With `strict: true` and no GUID, every
   * lookup returns `{ ok: false, code: "unconfigured" }`.
   */
  readonly strict?: boolean;
  /** Default per-attempt timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Injectable fetcher for tests. */
  readonly fetcher?: typeof fetch;
};

/** Per-call overrides on top of `AbnClientConfig`. */
export type LookupAbnOptions = {
  readonly signal?: AbortSignal;
  readonly correlationId?: string;
};

/** Public client surface returned by `createAbnClient`. */
export type AbnClient = {
  /** Look up an ABN. Returns a discriminated result; never throws. */
  readonly lookupAbn: (abn: string, opts?: LookupAbnOptions) => Promise<AbnLookupResult>;
  /** Test-only cache reset. */
  readonly __resetCacheForTests: () => void;
};

// ===== Client factory =====

/**
 * Construct an ABN client bound to a configuration. Prefer this over the
 * legacy module-level `lookupAbn` because it makes the GUID dependency
 * explicit and lets you supply a test fetcher.
 */
export function createAbnClient(config: AbnClientConfig = {}): AbnClient {
  const baseUrl = config.baseUrl ?? DEFAULT_ABN_LOOKUP_BASE;
  const guid = config.guid ?? "";
  const strict = config.strict ?? false;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetcher: typeof fetch = config.fetcher ?? fetch;

  /** Single fetch attempt against the ABR endpoint. */
  async function attemptLive(
    clean: string,
    signal: AbortSignal | undefined,
    correlationId: string | undefined,
  ): Promise<{ kind: "ok"; value: AbnLookupResult } | { kind: "retry"; status: number; message: string } | { kind: "fail"; result: AbnLookupResult }> {
    const url = `${baseUrl}/AbnDetails.aspx?abn=${clean}&guid=${encodeURIComponent(guid)}`;

    const ctrl = new AbortController();
    const onCallerAbort = () => ctrl.abort();
    if (signal !== undefined) {
      if (signal.aborted) {
        return { kind: "fail", result: failure("timeout", "aborted by caller", correlationId) };
      }
      signal.addEventListener("abort", onCallerAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetcher(url, { signal: ctrl.signal });
      if (RETRIABLE_STATUS_CODES.has(res.status)) {
        return { kind: "retry", status: res.status, message: `HTTP ${res.status}` };
      }
      if (!res.ok) {
        return { kind: "fail", result: failure("upstream_error", `HTTP ${res.status}`, correlationId) };
      }
      const text = await res.text();
      // ABR returns JSONP-ish wrapper ("callback({...});") that we strip.
      const stripped = text.replace(/^callback\(/, "").replace(/\);?\s*$/, "");
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch (parseErr: unknown) {
        const detail = parseErr instanceof Error ? parseErr.message : String(parseErr);
        return {
          kind: "fail",
          result: failure("upstream_error", `invalid JSON from ABR: ${detail}`, correlationId),
        };
      }
      const validated = AbrResponseSchema.safeParse(parsed);
      if (!validated.success) {
        return { kind: "fail", result: failure("upstream_error", "unexpected ABR shape", correlationId) };
      }
      const json = validated.data;

      if (json.AbnStatus === ABR_STATUS_NOT_FOUND) {
        return { kind: "fail", result: failure("not_found", "ABN not found", correlationId) };
      }

      const formatted = formatAbn(clean);
      const value: Extract<AbnLookupResult, { ok: true }> = {
        ok: true,
        source: "ato",
        abn: formatted,
        entityName: json.EntityName ?? "Unknown",
        ...(json.EntityTypeName !== undefined ? { entityType: json.EntityTypeName } : {}),
        status: mapStatus(json.AbnStatus),
        gstRegistered: typeof json.Gst === "string" && json.Gst.length > 0,
        ...(json.GstFromDate !== undefined ? { gstRegisteredFrom: json.GstFromDate } : {}),
        ...(json.AddressPostcode !== undefined
          ? { address: `${json.AddressState ?? ""} ${json.AddressPostcode}`.trim() }
          : {}),
      };
      _cache.set(clean, { ts: Date.now(), value });
      return { kind: "ok", value };
    } catch (e: unknown) {
      const wasAbort = e instanceof Error && (e.name === "AbortError" || ctrl.signal.aborted);
      if (wasAbort && signal?.aborted === true) {
        return { kind: "fail", result: failure("timeout", "aborted by caller", correlationId) };
      }
      const message = e instanceof Error ? e.message : "fetch failed";
      return {
        kind: "fail",
        result: failure(wasAbort ? "timeout" : "upstream_error", message, correlationId),
      };
    } finally {
      clearTimeout(timer);
      if (signal !== undefined) signal.removeEventListener("abort", onCallerAbort);
    }
  }

  async function lookupAbn(abn: string, opts: LookupAbnOptions = {}): Promise<AbnLookupResult> {
    const { signal, correlationId } = opts;
    const clean = normaliseAbn(abn);
    const validated = AbnSchema.safeParse(clean);
    if (!validated.success) {
      return failure(
        "invalid_input",
        validated.error.issues[0]?.message ?? "invalid ABN",
        correlationId,
      );
    }

    // Cache hit (live results only — mock results are not cached).
    const cached = _cache.get(clean);
    if (cached !== undefined && Date.now() - cached.ts < CACHE_TTL_MS) {
      return { ...cached.value, source: "cache" };
    }

    if (guid.length > 0) {
      // GUID configured — attempt live with one bounded retry.
      let lastFailure: AbnLookupResult | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const outcome = await attemptLive(clean, signal, correlationId);
        if (outcome.kind === "ok") return outcome.value;
        if (outcome.kind === "fail") return outcome.result;
        // Retry case.
        lastFailure = failure("upstream_error", outcome.message, correlationId);
        if (attempt < MAX_RETRIES) {
          try {
            await sleep(RETRY_BACKOFF_MS, signal);
          } catch {
            return failure("timeout", "aborted by caller", correlationId);
          }
        }
      }
      return lastFailure ?? failure("upstream_error", "ABR retries exhausted", correlationId);
    }

    // No GUID configured.
    if (strict) {
      return failure(
        "unconfigured",
        "ABN_LOOKUP_GUID not configured and strict mode is enabled",
        correlationId,
      );
    }

    const mock = MOCK_ENTRIES[clean];
    if (mock !== undefined) {
      return { ...mock, source: "mock" };
    }
    // No GUID, not in mock fixtures — returning a synthetic "Unknown" mock
    // would be a silent lie that fires false-positive cancelled/suspended
    // signals downstream. Refuse explicitly.
    return failure(
      "unconfigured",
      "ABN lookup unconfigured (no GUID and ABN not in mock fixtures)",
      correlationId,
    );
  }

  return {
    lookupAbn,
    __resetCacheForTests: () => _cache.clear(),
  };
}

/**
 * Convenience: known mock ABNs (read-only). Useful for documentation and
 * demo wiring; do NOT mutate this map at runtime.
 */
export const KNOWN_MOCK_ABNS: readonly string[] = Object.freeze(Object.keys(MOCK_ENTRIES));
