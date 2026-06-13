/**
 * The end-to-end LIVE compose: bbox-from-parcels → SLIP fetch → map → intersect
 * → group. Exercises every typed failure path (so the caller's DB fallback is
 * provably reachable) plus the happy path. Fetch is injected; the SLIP per-bbox
 * cache is reset between tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  boundingBoxForPoints,
  buildLiveTenementsByAssessment,
} from "../src/liveContext.js";
import { __resetSlipCacheForTests } from "../src/slip.js";
import type { IntersectableParcel } from "../src/intersection.js";

beforeEach(() => __resetSlipCacheForTests());

// GeoJSON [lng,lat] square around a Pilbara centroid (maps to the [lat,lng]
// square the intersection tests use).
const SQUARE_GEOJSON = {
  type: "Polygon",
  coordinates: [[
    [117.78, -22.70],
    [117.80, -22.70],
    [117.80, -22.68],
    [117.78, -22.68],
    [117.78, -22.70],
  ]],
};

function fcWith(geometry: unknown, props: Record<string, unknown>) {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: props, geometry }],
  };
}

function okFetcher(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

function parcel(assessmentNumber: string, lat: number, lng: number): IntersectableParcel {
  return { assessmentNumber, lat, lng };
}

describe("boundingBoxForPoints", () => {
  it("covers the points with a margin and stays non-degenerate for one point", () => {
    const bbox = boundingBoxForPoints([{ lat: -22.69, lng: 117.79 }], 0.02);
    expect(bbox).not.toBeNull();
    const [minLng, minLat, maxLng, maxLat] = bbox!;
    expect(minLng).toBeLessThan(maxLng);
    expect(minLat).toBeLessThan(maxLat);
    expect(minLng).toBeCloseTo(117.77, 5);
    expect(maxLat).toBeCloseTo(-22.67, 5);
  });

  it("returns null when no point has finite coordinates", () => {
    expect(boundingBoxForPoints([{ lat: Number.NaN, lng: 117 }])).toBeNull();
    expect(boundingBoxForPoints([])).toBeNull();
  });
});

describe("buildLiveTenementsByAssessment", () => {
  it("returns no_parcels for an empty parcel set", async () => {
    const r = await buildLiveTenementsByAssessment([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_parcels");
  });

  it("returns bbox_invalid when the parcel envelope exceeds the SLIP area cap", async () => {
    const r = await buildLiveTenementsByAssessment(
      [parcel("A", -20, 115), parcel("B", -30, 125)], // ~100 sq deg
      { fetcher: okFetcher(fcWith(SQUARE_GEOJSON, { tenid: "M1" })) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bbox_invalid");
  });

  it("returns fetch_failed when the live fetch errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const r = await buildLiveTenementsByAssessment([parcel("A", -22.69, 117.79)], { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("fetch_failed");
  });

  it("returns no_matches when live tenements intersect no parcel", async () => {
    // Tenement square is around -22.69/117.79; parcel sits far away → no hit.
    const r = await buildLiveTenementsByAssessment(
      [parcel("FAR", -22.695, 117.795)].map((p) => ({ ...p, lat: -25.0, lng: 120.0 })),
      { fetcher: okFetcher(fcWith(SQUARE_GEOJSON, { tenid: "M  4701569", tenstatus: "LIVE" })) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_matches");
  });

  it("builds the live assessment→tenement map on a real intersection", async () => {
    const r = await buildLiveTenementsByAssessment(
      [parcel("A-100", -22.69, 117.79), parcel("B-200", -22.50, 117.79)],
      { fetcher: okFetcher(fcWith(SQUARE_GEOJSON, { tenid: "M  4701569", tenstatus: "LIVE", holder1: "Pilbara Resources" })) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("live");
      expect(r.tenementCount).toBe(1);
      expect(r.matchedAssessments).toBe(1);
      expect(r.tenementsByAssessment.get("A-100")!.map((t) => t.tenementId)).toEqual(["M  4701569"]);
      expect(r.tenementsByAssessment.has("B-200")).toBe(false);
    }
  });
});
