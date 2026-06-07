/**
 * Characterization tests for fetchSlipFeatures.
 *
 * Pin bbox validation, ArcGIS-error-envelope surfacing, abort behaviour,
 * and rounded-cache-key normalisation.
 */

import { describe, it, expect, vi } from "vitest";
import {
  fetchSlipFeatures,
  __resetSlipCacheForTests,
} from "../src/slip.js";
import {
  getStoredConditionalHeaders,
  __resetFreshnessStoreForTests,
} from "../src/freshness.js";
import type { BoundingBox } from "@ratesassist/contract";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const validBbox: BoundingBox = [116.8, -20.8, 116.9, -20.7];

describe("fetchSlipFeatures — bbox validation", () => {
  it("rejects out-of-Australia bbox", async () => {
    __resetSlipCacheForTests();
    const r = await fetchSlipFeatures(
      "miningTenements",
      [-10, 50, -9, 51],
      { fetcher: vi.fn() },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
  });

  it("rejects bbox larger than 1.0 sq deg", async () => {
    __resetSlipCacheForTests();
    const huge: BoundingBox = [115, -22, 117.5, -20];
    const r = await fetchSlipFeatures("miningTenements", huge, {
      fetcher: vi.fn(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
  });

  it("rejects min >= max", async () => {
    __resetSlipCacheForTests();
    const r = await fetchSlipFeatures(
      "miningTenements",
      [117, -20, 116, -21],
      { fetcher: vi.fn() },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
  });
});

describe("fetchSlipFeatures — abort signal", () => {
  it("pre-aborted signal returns timeout without fetching", async () => {
    __resetSlipCacheForTests();
    const fetcher = vi.fn();
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await fetchSlipFeatures("miningTenements", validBbox, {
      fetcher,
      signal: ctrl.signal,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("timeout");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("fetchSlipFeatures — ArcGIS error envelope", () => {
  it("HTTP 200 with {error:{code,message}} → upstream_error with detail", async () => {
    __resetSlipCacheForTests();
    const fetcher = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ error: { code: 400, message: "bad" } }),
      );

    const r = await fetchSlipFeatures("miningTenements", validBbox, {
      fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("upstream_error");
      expect(r.error).toContain("ArcGIS error 400: bad");
    }
  });

  it("non-2xx HTTP returns upstream_error", async () => {
    __resetSlipCacheForTests();
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response("nope", { status: 500 }));
    const r = await fetchSlipFeatures("miningTenements", validBbox, {
      fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("upstream_error");
  });
});

describe("fetchSlipFeatures — cache + key normalisation", () => {
  it("rounded key normalisation: bbox differing only at 6th decimal hits cache", async () => {
    __resetSlipCacheForTests();
    const features = [
      {
        type: "Feature" as const,
        properties: { id: 1 },
        geometry: { type: "Polygon" as const, coordinates: [[[0, 0]]] },
      },
    ];
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({ type: "FeatureCollection", features }),
    );

    const a: BoundingBox = [116.80001, -20.80001, 116.90001, -20.70001];
    const b: BoundingBox = [116.80002, -20.80002, 116.90002, -20.70002];

    const r1 = await fetchSlipFeatures("miningTenements", a, { fetcher });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.source).toBe("live");

    const r2 = await fetchSlipFeatures("miningTenements", b, { fetcher });
    expect(r2.ok).toBe(true);
    // Cache key rounds to 4 decimals, so both bboxes share a key.
    if (r2.ok) expect(r2.source).toBe("cache");

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

// ===== ETag / conditional GET =====

const featureStub = [
  {
    type: "Feature" as const,
    properties: { id: 99 },
    geometry: { type: "Polygon" as const, coordinates: [[[0, 0]]] },
  },
];

// Always returns a fresh Response to avoid "body already consumed" issues when
// the same mock is called multiple times.
function makeFeatureResponse(etag?: string): Response {
  return new Response(
    JSON.stringify({ type: "FeatureCollection", features: featureStub }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        ...(etag ? { etag } : {}),
      },
    },
  );
}

const CACHE_TTL_PLUS_ONE_MS = 60 * 60 * 1000 + 1;

describe("fetchSlipFeatures — ETag / conditional GET", () => {
  it("records an ETag from the first live fetch", async () => {
    __resetSlipCacheForTests();
    __resetFreshnessStoreForTests();

    // Each call gets a fresh Response via mockImplementation.
    const fetcher = vi.fn().mockImplementation(async () =>
      makeFeatureResponse('"etag-v1"'),
    );

    const r = await fetchSlipFeatures("miningTenements", validBbox, { fetcher });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toBe("live");

    // ETag should be stored for the URL that was called.
    expect(fetcher).toHaveBeenCalledTimes(1);
    const callUrl = fetcher.mock.calls[0]?.[0] as string;
    const stored = getStoredConditionalHeaders(callUrl);
    expect(stored).toBeDefined();
    expect(stored?.etag).toBe('"etag-v1"');
  });

  it("sends If-None-Match on stale-cache refresh and returns cache on 304", async () => {
    __resetSlipCacheForTests();
    __resetFreshnessStoreForTests();
    vi.useFakeTimers();

    try {
      // fetcher: on first call (no If-None-Match) return 200+ETag; on
      // subsequent calls (with If-None-Match) return 304.
      const fetcher = vi.fn().mockImplementation(
        async (_url: string, init?: { headers?: Record<string, string> }) => {
          if (init?.headers?.["If-None-Match"]) {
            return new Response(null, { status: 304 });
          }
          return makeFeatureResponse('"etag-v2"');
        },
      );

      // First fetch — populates cache + ETag store.
      const r1 = await fetchSlipFeatures("miningTenements", validBbox, { fetcher });
      expect(r1.ok).toBe(true);
      if (r1.ok) expect(r1.source).toBe("live");
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Advance fake time past the 1-hour TTL so the cache entry is stale.
      vi.advanceTimersByTime(CACHE_TTL_PLUS_ONE_MS);

      // Second fetch: stale cache + ETag stored → conditional GET fires.
      const r2 = await fetchSlipFeatures("miningTenements", validBbox, { fetcher });

      // Exactly 2 fetcher calls: first live, second conditional GET (304).
      expect(fetcher).toHaveBeenCalledTimes(2);
      const secondCallInit = fetcher.mock.calls[1]?.[1] as { headers?: Record<string, string> };
      expect(secondCallInit?.headers?.["If-None-Match"]).toBe('"etag-v2"');

      // 304 → result is "cache" with original features (no re-parse).
      expect(r2.ok).toBe(true);
      if (r2.ok) {
        expect(r2.source).toBe("cache");
        expect(r2.features).toEqual(featureStub);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls through to full candidate-layer loop when no ETag was stored", async () => {
    __resetSlipCacheForTests();
    __resetFreshnessStoreForTests();
    vi.useFakeTimers();

    try {
      // Fresh Response on every call, no ETag header — freshness store stays empty.
      const fetcher = vi.fn().mockImplementation(async () =>
        makeFeatureResponse(/* no etag */),
      );

      const r1 = await fetchSlipFeatures("miningTenements", validBbox, { fetcher });
      expect(r1.ok).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Advance time past the TTL to make the cache stale.
      vi.advanceTimersByTime(CACHE_TTL_PLUS_ONE_MS);

      // Second fetch: stale cache, but no ETag → no conditional GET → normal loop.
      const r2 = await fetchSlipFeatures("miningTenements", validBbox, { fetcher });
      expect(r2.ok).toBe(true);

      // Two live fetches — no extra conditional-GET call.
      expect(fetcher).toHaveBeenCalledTimes(2);
      // The second call should NOT carry If-None-Match.
      const secondCallInit = fetcher.mock.calls[1]?.[1] as { headers?: Record<string, string> };
      expect(secondCallInit?.headers?.["If-None-Match"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
