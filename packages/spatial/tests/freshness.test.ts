/**
 * Unit tests for the freshness ETag store.
 *
 * Coverage:
 *   - recordResponseHeaders: stores ETag; ignores missing ETag; stores Last-Modified
 *   - buildConditionalHeaders: returns empty when URL unknown; returns If-None-Match
 *   - getStoredConditionalHeaders: returns stored entry or undefined
 *   - __resetFreshnessStoreForTests: clears the store
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordResponseHeaders,
  buildConditionalHeaders,
  getStoredConditionalHeaders,
  __resetFreshnessStoreForTests,
} from "../src/freshness.js";

const URL_A = "https://example.com/wfs?service=WFS&version=2.0.0&request=GetFeature";
const URL_B = "https://other.com/api/features";

function makeHeaders(pairs: Record<string, string>): Headers {
  return new Headers(pairs);
}

beforeEach(() => {
  __resetFreshnessStoreForTests();
});

describe("buildConditionalHeaders — no prior record", () => {
  it("returns empty object for an unknown URL", () => {
    const h = buildConditionalHeaders(URL_A);
    expect(h).toEqual({});
    expect(Object.keys(h)).toHaveLength(0);
  });
});

describe("recordResponseHeaders + buildConditionalHeaders", () => {
  it("records ETag and returns If-None-Match on next call", () => {
    const headers = makeHeaders({ etag: '"abc123"' });
    recordResponseHeaders(URL_A, headers);

    const cond = buildConditionalHeaders(URL_A);
    expect(cond["If-None-Match"]).toBe('"abc123"');
    expect(Object.keys(cond)).toHaveLength(1);
  });

  it("records ETag + Last-Modified and returns both conditional headers", () => {
    const headers = makeHeaders({
      etag: '"xyz"',
      "last-modified": "Mon, 02 Jun 2025 10:00:00 GMT",
    });
    recordResponseHeaders(URL_A, headers);

    const cond = buildConditionalHeaders(URL_A);
    expect(cond["If-None-Match"]).toBe('"xyz"');
    expect(cond["If-Modified-Since"]).toBe("Mon, 02 Jun 2025 10:00:00 GMT");
    expect(Object.keys(cond)).toHaveLength(2);
  });

  it("is a no-op when response has no ETag header", () => {
    const headers = makeHeaders({ "last-modified": "Mon, 02 Jun 2025 10:00:00 GMT" });
    recordResponseHeaders(URL_A, headers);

    // Nothing was stored — Last-Modified alone is not stored.
    expect(buildConditionalHeaders(URL_A)).toEqual({});
    expect(getStoredConditionalHeaders(URL_A)).toBeUndefined();
  });

  it("overwrites a prior ETag when the same URL returns a new response", () => {
    recordResponseHeaders(URL_A, makeHeaders({ etag: '"first"' }));
    recordResponseHeaders(URL_A, makeHeaders({ etag: '"second"' }));

    const cond = buildConditionalHeaders(URL_A);
    expect(cond["If-None-Match"]).toBe('"second"');
  });

  it("stores ETags per URL independently", () => {
    recordResponseHeaders(URL_A, makeHeaders({ etag: '"a"' }));
    recordResponseHeaders(URL_B, makeHeaders({ etag: '"b"' }));

    expect(buildConditionalHeaders(URL_A)["If-None-Match"]).toBe('"a"');
    expect(buildConditionalHeaders(URL_B)["If-None-Match"]).toBe('"b"');
  });
});

describe("getStoredConditionalHeaders", () => {
  it("returns undefined for unknown URL", () => {
    expect(getStoredConditionalHeaders(URL_A)).toBeUndefined();
  });

  it("returns stored entry after recordResponseHeaders", () => {
    recordResponseHeaders(URL_A, makeHeaders({ etag: '"stored"' }));
    const entry = getStoredConditionalHeaders(URL_A);
    expect(entry).toBeDefined();
    expect(entry?.etag).toBe('"stored"');
  });
});

describe("__resetFreshnessStoreForTests", () => {
  it("clears all stored ETags", () => {
    recordResponseHeaders(URL_A, makeHeaders({ etag: '"a"' }));
    recordResponseHeaders(URL_B, makeHeaders({ etag: '"b"' }));
    __resetFreshnessStoreForTests();

    expect(buildConditionalHeaders(URL_A)).toEqual({});
    expect(buildConditionalHeaders(URL_B)).toEqual({});
  });
});
