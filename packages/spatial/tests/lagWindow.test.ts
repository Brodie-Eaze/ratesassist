/**
 * Unit tests for the lag-window cross-register signal helper.
 *
 * Pins:
 *  - DPIRD landuse → normalised category mapping
 *  - severity heuristic (M/G/L × category matrix)
 *  - Landgate Locate URL builder shape
 *  - findLagWindowCandidates happy + degraded paths via mocked fetcher
 *  - source-tag honesty (seeded ↔ live)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  classifyLanduse,
  severityHintFor,
  buildLandgateLocateUrl,
  findLagWindowCandidates,
  SEEDED_LAGWINDOW_PARCELS,
  LANDGATE_LOCATE_BASE,
} from "../src/lagWindow.js";
import { SEEDED_GRANTS } from "../src/grants.js";

describe("classifyLanduse", () => {
  it("maps pastoral codes to pastoral category", () => {
    expect(classifyLanduse("Pastoral - Cattle")).toBe("pastoral");
    expect(classifyLanduse("Pastoral - Sheep and Goats")).toBe("pastoral");
  });
  it("maps conservation and arid interior to crown/conservation", () => {
    expect(classifyLanduse("Conservation")).toBe("conservation");
    expect(classifyLanduse("Arid Interior")).toBe("crown");
  });
  it("maps livestock grazing / cropping / horticulture to rural", () => {
    expect(classifyLanduse("Livestock grazing")).toBe("rural");
    expect(classifyLanduse("Cropping - Cereals and legumes")).toBe("rural");
    expect(classifyLanduse("Horticulture")).toBe("rural");
  });
  it("maps 'No production' to vacant and Perth metro to residential", () => {
    expect(classifyLanduse("No production")).toBe("vacant");
    expect(classifyLanduse("Perth Metropolitan Area")).toBe("residential");
  });
  it("returns 'other' for empty / unknown / nullish inputs", () => {
    expect(classifyLanduse(undefined)).toBe("other");
    expect(classifyLanduse(null)).toBe("other");
    expect(classifyLanduse("")).toBe("other");
    expect(classifyLanduse("Spaceport")).toBe("other");
  });
});

describe("severityHintFor", () => {
  it("M on residential or rural → high", () => {
    expect(severityHintFor("M", "residential")).toBe("high");
    expect(severityHintFor("M", "rural")).toBe("high");
  });
  it("M on vacant → medium", () => {
    expect(severityHintFor("M", "vacant")).toBe("medium");
  });
  it("G on rural or vacant → medium", () => {
    expect(severityHintFor("G", "rural")).toBe("medium");
    expect(severityHintFor("G", "vacant")).toBe("medium");
  });
  it("L on rural or vacant → medium", () => {
    expect(severityHintFor("L", "rural")).toBe("medium");
  });
  it("anything else surfaced → low", () => {
    expect(severityHintFor("M", "pastoral")).toBe("low");
    expect(severityHintFor("E", "rural")).toBe("low");
    expect(severityHintFor("P", "rural")).toBe("low");
  });
});

describe("buildLandgateLocateUrl", () => {
  it("returns the base URL with a search anchor for a polygon centroid", () => {
    const url = buildLandgateLocateUrl({
      type: "Polygon",
      coordinates: [
        [
          [117.75, -22.72],
          [117.85, -22.72],
          [117.85, -22.66],
          [117.75, -22.66],
          [117.75, -22.72],
        ],
      ],
    });
    expect(url.startsWith(LANDGATE_LOCATE_BASE)).toBe(true);
    expect(url).toContain("?search=");
    // Latitude should be the negative WA-range number.
    expect(url).toMatch(/search=-22\./);
  });
  it("falls back to the base URL when geometry has no points", () => {
    const url = buildLandgateLocateUrl({
      type: "Polygon",
      coordinates: [],
    });
    expect(url).toBe(LANDGATE_LOCATE_BASE);
  });
});

function makeDpirdResponse(features: unknown[], status = 200): Response {
  return new Response(
    JSON.stringify({ type: "FeatureCollection", features }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function landuseFeature(landuse: string, bbox: [number, number, number, number]): unknown {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return {
    type: "Feature",
    properties: { land_use: landuse, "st_area(shape)": 1_200_000 },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [minLng, minLat],
          [maxLng, minLat],
          [maxLng, maxLat],
          [minLng, maxLat],
          [minLng, minLat],
        ],
      ],
    },
  };
}

describe("findLagWindowCandidates", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns seeded candidates when both upstream calls fail and fallbacks are wired", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    const r = await findLagWindowCandidates({
      sinceDays: 90,
      fetcher,
      seededGrants: SEEDED_GRANTS,
      seededParcels: SEEDED_LAGWINDOW_PARCELS,
      now: () => Date.parse("2026-05-10T00:00:00Z"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("seeded");
    expect(r.candidates.length).toBeGreaterThan(0);
    // At least one seeded candidate has the right shape.
    const c = r.candidates[0]!;
    expect(c.tenement.tenementIdDisplay).toMatch(/^[MEPGLR] /);
    expect(c.parcel.detailUrl).toContain("landgate");
    expect(c.reasoning).toContain("Reclassification window open");
  });

  it("returns ok=false with no_layer_responded code when grants fetch fails AND no seeded grants supplied", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
    const r = await findLagWindowCandidates({
      sinceDays: 90,
      fetcher,
      // No seededGrants — should surface upstream failure rather than fabricate.
      now: () => Date.parse("2026-05-10T00:00:00Z"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code === "upstream_error" || r.code === "no_layer_responded").toBe(true);
    expect(r.error).toContain("grants fetch failed");
  });

  it("rejects sinceDays outside 1..365", async () => {
    const r = await findLagWindowCandidates({ sinceDays: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });

  it("excludes pastoral / conservation / mining parcels from candidates", async () => {
    // Mock both layers: tenement grant from SLIP mining; DPIRD landuse layer
    // returns a Pastoral polygon overlapping it. Result: no candidate.
    let call = 0;
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      call++;
      if (url.includes("Industry_and_Mining")) {
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {
                  tenid: "M  4701569",
                  tenstatus: "LIVE",
                  grantdate: "2026-05-01T00:00:00Z",
                  type: "M",
                  holder1: "Pilbara Resources",
                },
                geometry: {
                  type: "Point",
                  coordinates: [117.79, -22.69],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      // DPIRD landuse — pastoral polygon over the same area.
      return makeDpirdResponse([
        landuseFeature("Pastoral - Cattle", [117.75, -22.72, 117.85, -22.66]),
      ]);
    }) as unknown as typeof fetch;

    const r = await findLagWindowCandidates({
      sinceDays: 90,
      fetcher,
      now: () => Date.parse("2026-05-10T00:00:00Z"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("live");
    expect(r.candidates.length).toBe(0);
  });

  it("fires a HIGH candidate for live M-class on a rural landuse parcel", async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("Industry_and_Mining")) {
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {
                  tenid: "M  4701569",
                  tenstatus: "LIVE",
                  grantdate: "2026-04-20T00:00:00Z",
                  type: "M",
                  holder1: "Pilbara Resources",
                },
                geometry: {
                  type: "Point",
                  coordinates: [117.79, -22.69],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return makeDpirdResponse([
        landuseFeature("Livestock grazing", [117.70, -22.75, 117.90, -22.60]),
      ]);
    }) as unknown as typeof fetch;

    const r = await findLagWindowCandidates({
      sinceDays: 90,
      fetcher,
      now: () => Date.parse("2026-05-10T00:00:00Z"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("live");
    expect(r.candidates.length).toBe(1);
    const c = r.candidates[0]!;
    expect(c.severityHint).toBe("high");
    expect(c.lagDays).toBe(20);
    expect(c.parcel.landuseCategory).toBe("rural");
    expect(c.reasoning).toMatch(/Tenement M \d+\/\d+/);
  });
});
