/**
 * Characterization tests for fetchDpirdLanduseForParcel.
 *
 * Pin live-path happy case, seeded fallback (default + opt-out), bbox
 * validation, malformed-response handling, abort behaviour, and the
 * transient-error retry policy.
 *
 * Every test uses an injected `fetcher` — we never reach the network.
 */

import { describe, it, expect, vi } from "vitest";
import {
  fetchDpirdLanduseForParcel,
  DPIRD_LANDUSE_LAYER_URL,
  DPIRD_SEED_ENTRIES,
} from "../src/dpird.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Realistic ESRI feature collection — the shape `f=geojson` returns from
 * the DPIRD-003 endpoint. Property keys match the live layer.
 */
function featureCollection(landuse: string) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          land_use: landuse,
          "st_area(shape)": 4_200_000,
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [117.78, -22.70],
              [117.80, -22.70],
              [117.80, -22.68],
              [117.78, -22.68],
              [117.78, -22.70],
            ],
          ],
        },
      },
    ],
  };
}

describe("fetchDpirdLanduseForParcel — happy path", () => {
  it("live: returns landuse and source: 'live' on a parseable response", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(featureCollection("Livestock grazing")));

    const r = await fetchDpirdLanduseForParcel({
      lat: -22.694,
      lng: 117.793,
      fetcher,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("live");
    expect(r.landuseCode).toBe("Livestock grazing");
    expect(r.landuseDescription).toBe("livestock grazing");
    expect(r.geometry.type).toBe("Polygon");
    expect(r.queriedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("hits the DPIRD_LANDUSE_LAYER_URL with f=geojson", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse(featureCollection("Pastoral - Cattle")));

    await fetchDpirdLanduseForParcel({
      lat: -23.354,
      lng: 119.738,
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const calledWith = (fetcher.mock.calls[0]?.[0] ?? "") as string;
    expect(calledWith).toContain(DPIRD_LANDUSE_LAYER_URL);
    expect(calledWith).toContain("f=geojson");
    expect(calledWith).toContain("land_use");
  });
});

describe("fetchDpirdLanduseForParcel — validation", () => {
  it("rejects non-finite lat/lng", async () => {
    const fetcher = vi.fn();
    const r = await fetchDpirdLanduseForParcel({
      lat: Number.NaN,
      lng: 117.793,
      fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects coordinates outside the Australia envelope", async () => {
    const fetcher = vi.fn();
    // Paris — clearly not WA.
    const r = await fetchDpirdLanduseForParcel({
      lat: 48.8566,
      lng: 2.3522,
      fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects bufferDeg outside (0, 1]", async () => {
    const fetcher = vi.fn();
    const r = await fetchDpirdLanduseForParcel({
      lat: -22.694,
      lng: 117.793,
      bufferDeg: 0,
      fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("fetchDpirdLanduseForParcel — abort & timeouts", () => {
  it("pre-aborted signal returns timeout without fetching", async () => {
    const fetcher = vi.fn();
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await fetchDpirdLanduseForParcel({
      lat: -22.694,
      lng: 117.793,
      signal: ctrl.signal,
      fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("timeout");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("fetchDpirdLanduseForParcel — malformed upstream", () => {
  it("non-FeatureCollection JSON → upstream_error (no seeded fallback when point far from seeds)", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ type: "NotAFC" }));
    // Point near Hobart (Tasmania) — far from any seed; AU envelope still ok.
    const r = await fetchDpirdLanduseForParcel({
      lat: -42.88,
      lng: 147.32,
      fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("upstream_error");
      expect(r.error).toBe("non-GeoJSON response");
    }
  });

  it("empty features array → upstream_error (no DPIRD feature)", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ type: "FeatureCollection", features: [] }));
    // Hobart again so the seeded fallback can't mask the upstream failure.
    const r = await fetchDpirdLanduseForParcel({
      lat: -42.88,
      lng: 147.32,
      fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("upstream_error");
      expect(r.error).toContain("no DPIRD feature");
    }
  });

  it("malformed JSON near a seed point falls back to seeded with disclosure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: 500, message: "boom" } }));
    // Tom Price — colocated with a seed.
    const r = await fetchDpirdLanduseForParcel({
      lat: -22.694,
      lng: 117.793,
      fetcher,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("seeded");
    expect(r.note).toBeDefined();
    expect((r.note ?? "").length).toBeGreaterThan(10);
  });

  it("allowSeededFallback: false near a seed point still returns the upstream error", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: 500, message: "boom" } }));
    const r = await fetchDpirdLanduseForParcel({
      lat: -22.694,
      lng: 117.793,
      fetcher,
      allowSeededFallback: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("upstream_error");
  });
});

describe("fetchDpirdLanduseForParcel — retry policy", () => {
  it("retries on 503 then succeeds on the next attempt", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(featureCollection("No production")));

    const r = await fetchDpirdLanduseForParcel({
      lat: -30.749,
      lng: 121.466,
      fetcher,
      maxRetries: 2,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("live");
    expect(r.landuseCode).toBe("No production");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 400 (non-transient)", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("bad", { status: 400 }));

    // Hobart so seeded fallback can't hide the failure.
    const r = await fetchDpirdLanduseForParcel({
      lat: -42.88,
      lng: 147.32,
      fetcher,
      maxRetries: 2,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("upstream_error");
      expect(r.error).toBe("HTTP 400");
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("fetchDpirdLanduseForParcel — seeded fixtures", () => {
  it("ships 5 seed entries spanning the WA mining footprint", () => {
    expect(DPIRD_SEED_ENTRIES.length).toBe(5);
    for (const entry of DPIRD_SEED_ENTRIES) {
      expect(entry.landuseCode.length).toBeGreaterThan(2);
      // Lat in WA range.
      expect(entry.center[0]).toBeLessThanOrEqual(-9);
      expect(entry.center[0]).toBeGreaterThanOrEqual(-35);
      // Lng in WA range.
      expect(entry.center[1]).toBeGreaterThanOrEqual(112);
      expect(entry.center[1]).toBeLessThanOrEqual(130);
      expect(entry.geometry.type).toBe("Polygon");
    }
  });
});
