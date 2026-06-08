/**
 * @ratesassist/spatial/freshness — shared HTTP ETag / If-Modified-Since store.
 *
 * Provides a process-local cache of HTTP conditional-GET headers captured from
 * upstream responses. All spatial adapters (slip.ts, dmirs.ts, sarig.ts) share
 * this store so conditional headers survive between calls within the same
 * server process.
 *
 * Why ETag/If-None-Match and not just shorter TTLs?
 *   Short TTLs waste bandwidth: a 200 OK from SLIP or SARIG re-sends tens of
 *   kilobytes of GeoJSON that hasn't changed. A 304 NOT MODIFIED is a single
 *   HTTP exchange at ~1 KB. ETag + conditional GET gives us "check for
 *   freshness on every poll, download only when data actually changes."
 *
 * Production note:
 *   This store is process-local. Multi-replica deployments (ECS, Kubernetes)
 *   should layer a shared cache (Redis/DynamoDB) on top using the same
 *   semantics — each replica still benefits in the interim because most poll
 *   intervals are measured in hours, not seconds.
 *
 * Usage in an adapter:
 *   1. `buildConditionalHeaders(url)` → spread into `RequestInit.headers`
 *   2. On `response.status === 304` → use locally cached data, extend TTL
 *   3. On `response.status === 200` → parse, then call `recordResponseHeaders(url, res.headers)`
 */

// ===== Types =====

export interface StoredConditionalHeaders {
  /** The ETag value received from the server (e.g. `"abc123"` or `W/"abc"`). */
  readonly etag: string;
  /**
   * The `Last-Modified` header from the server, if present.
   * Used as a secondary hint for servers that support `If-Modified-Since` but
   * not ETags. Stored alongside the ETag so both headers are sent together.
   */
  readonly lastModified?: string;
}

// ===== Store =====

/**
 * Process-local ETag store, keyed by the exact request URL.
 *
 * Map entries are never evicted — the store grows to the number of distinct
 * URLs fetched per process lifetime, which is bounded by the static set of
 * upstream service URLs the adapters use (O(10)). No eviction logic needed.
 */
const _etagStore = new Map<string, StoredConditionalHeaders>();

// ===== Public API =====

/**
 * Record the `ETag` (and optionally `Last-Modified`) from a successful
 * upstream response.
 *
 * Call this after every `200 OK` response that delivered real data. If the
 * response has no `ETag` header this is a no-op — `Last-Modified` alone is
 * not stored (ETags are the authoritative signal; `Last-Modified` is stored
 * only as a complement).
 *
 * @param url      The exact request URL (including all query parameters).
 * @param headers  The response `Headers` object.
 */
export function recordResponseHeaders(url: string, headers: Headers): void {
  const etag = headers.get("etag");
  if (!etag) return; // no ETag → nothing to store
  const lastModified = headers.get("last-modified") ?? undefined;
  _etagStore.set(url, {
    etag,
    ...(lastModified !== undefined ? { lastModified } : {}),
  });
}

/**
 * Build the conditional request headers for a URL.
 *
 * Returns `{ "If-None-Match": etag }` (and optionally `"If-Modified-Since"`)
 * if a prior response for this URL stored them. Returns `{}` if no prior fetch
 * has been recorded, so callers can spread the result unconditionally:
 *
 * ```ts
 * const res = await fetcher(url, {
 *   signal,
 *   headers: buildConditionalHeaders(url),
 * });
 * ```
 *
 * @param url  The exact request URL to look up.
 * @returns    A `HeadersInit`-compatible object (may be empty).
 */
export function buildConditionalHeaders(url: string): Record<string, string> {
  const stored = _etagStore.get(url);
  if (!stored) return {};
  const h: Record<string, string> = { "If-None-Match": stored.etag };
  if (stored.lastModified) h["If-Modified-Since"] = stored.lastModified;
  return h;
}

/**
 * Return the stored conditional headers for a URL — useful for diagnostic
 * endpoints (e.g. a `/connections` status page) and for tests.
 *
 * @returns `undefined` if no prior successful fetch has been recorded.
 */
export function getStoredConditionalHeaders(
  url: string,
): StoredConditionalHeaders | undefined {
  return _etagStore.get(url);
}

/**
 * Test-only reset. Clears the entire ETag store so tests begin with a clean
 * slate. Not exported from the package barrel — import directly from
 * `./freshness` when needed in test files.
 */
export function __resetFreshnessStoreForTests(): void {
  _etagStore.clear();
}
