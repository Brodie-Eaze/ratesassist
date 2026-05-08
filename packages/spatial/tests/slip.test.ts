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
