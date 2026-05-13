import { describe, it, expect } from "vitest";
import {
  sutherlandHodgmanClip,
  shoelaceArea,
  geodesicAreaM2,
  haversineDistanceM,
  overlapStats,
  m2ToHa,
  type Ring,
} from "../lib/polygonClip";

const square = (cx: number, cy: number, half: number): Ring => [
  [cx - half, cy - half],
  [cx + half, cy - half],
  [cx + half, cy + half],
  [cx - half, cy + half],
];

describe("polygonClip — Sutherland-Hodgman", () => {
  it("returns the subject when the subject is fully inside the clipper", () => {
    const subj = square(0, 0, 1);
    const clip = square(0, 0, 5);
    const out = sutherlandHodgmanClip(subj, clip);
    expect(out.length).toBe(4);
    expect(shoelaceArea(out)).toBeCloseTo(4, 6); // 2x2 square
  });

  it("returns [] when the subject is fully outside the clipper", () => {
    const subj = square(100, 100, 1);
    const clip = square(0, 0, 1);
    const out = sutherlandHodgmanClip(subj, clip);
    // Sutherland-Hodgman may emit degenerate output; treat anything < 3 verts as no-overlap.
    expect(out.length).toBeLessThan(3);
  });

  it("computes a half-overlap rectangle correctly", () => {
    // subject is a 2x2 square at (0,0): x in [-1,1], y in [-1,1]
    // clipper is a 2x2 square at (1,0): x in [0,2], y in [-1,1]
    // overlap: x in [0,1], y in [-1,1] => area 2
    const subj = square(0, 0, 1);
    const clip = square(1, 0, 1);
    const out = sutherlandHodgmanClip(subj, clip);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(shoelaceArea(out)).toBeCloseTo(2, 6);
  });

  it("clips a triangle against a rectangle", () => {
    const triangle: Ring = [
      [0, 0],
      [4, 0],
      [2, 4],
    ];
    const rect = square(2, 1, 1); // covers x in [1,3], y in [0,2]
    const out = sutherlandHodgmanClip(triangle, rect);
    expect(out.length).toBeGreaterThanOrEqual(3);
    // area must be > 0 and < both inputs
    const a = shoelaceArea(out);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(shoelaceArea(triangle));
    expect(a).toBeLessThanOrEqual(shoelaceArea(rect));
  });

  it("handles reversed (CW) winding by normalising internally", () => {
    const cw: Ring = [
      [-1, -1],
      [-1, 1],
      [1, 1],
      [1, -1],
    ];
    const clip = square(0, 0, 5);
    const out = sutherlandHodgmanClip(cw, clip);
    expect(out.length).toBe(4);
    expect(shoelaceArea(out)).toBeCloseTo(4, 6);
  });
});

describe("polygonClip — Shoelace area", () => {
  it("computes a unit square as 1", () => {
    expect(shoelaceArea(square(0, 0, 0.5))).toBeCloseTo(1, 9);
  });

  it("computes a 3x3 square as 9", () => {
    expect(shoelaceArea(square(0, 0, 1.5))).toBeCloseTo(9, 9);
  });

  it("returns 0 for degenerate rings", () => {
    expect(shoelaceArea([])).toBe(0);
    expect(shoelaceArea([[0, 0]])).toBe(0);
    expect(shoelaceArea([[0, 0], [1, 1]])).toBe(0);
  });
});

describe("polygonClip — geodesic area", () => {
  it("computes a ~1km square near Perth to roughly 1,000,000 m²", () => {
    // 1km north-south = ~0.009° lat. At -31.95°, 1km east-west ≈ 0.01057° lng.
    const lat = -31.95;
    const lng = 115.86;
    const ring: Ring = [
      [lng - 0.005285, lat - 0.0045],
      [lng + 0.005285, lat - 0.0045],
      [lng + 0.005285, lat + 0.0045],
      [lng - 0.005285, lat + 0.0045],
    ];
    const m2 = geodesicAreaM2(ring);
    // Allow ±3% — the formula is spherical, not WGS-84 ellipsoidal.
    expect(m2).toBeGreaterThan(970_000);
    expect(m2).toBeLessThan(1_030_000);
  });

  it("m2ToHa converts cleanly", () => {
    expect(m2ToHa(10_000)).toBe(1);
    expect(m2ToHa(123_456)).toBeCloseTo(12.3456, 4);
  });
});

describe("polygonClip — haversine distance", () => {
  it("returns 0 for the same point", () => {
    expect(haversineDistanceM([115.86, -31.95], [115.86, -31.95])).toBe(0);
  });

  it("Perth to Kalgoorlie is ~550km ± 5%", () => {
    const perth: [number, number] = [115.857, -31.953];
    const kal: [number, number] = [121.466, -30.749];
    const d = haversineDistanceM(perth, kal);
    expect(d).toBeGreaterThan(525_000);
    expect(d).toBeLessThan(580_000);
  });
});

describe("polygonClip — overlapStats", () => {
  it("returns null when there is no overlap", () => {
    const tenement = square(120, -25, 0.1);
    const parcel = square(115, -32, 0.01);
    expect(overlapStats(tenement, parcel)).toBeNull();
  });

  it("returns 100% when tenement fully covers parcel", () => {
    const tenement = square(115.86, -31.95, 0.01);
    const parcel = square(115.86, -31.95, 0.001);
    const r = overlapStats(tenement, parcel);
    expect(r).not.toBeNull();
    expect(r!.percentOfParcel).toBeCloseTo(100, 0);
  });

  it("returns ~50% when tenement covers half the parcel", () => {
    const parcel = square(115.86, -31.95, 0.001);
    // tenement covers the eastern half of the parcel
    const tenement: Ring = [
      [115.86, -31.951],
      [115.87, -31.951],
      [115.87, -31.949],
      [115.86, -31.949],
    ];
    const r = overlapStats(tenement, parcel);
    expect(r).not.toBeNull();
    expect(r!.percentOfParcel).toBeGreaterThan(45);
    expect(r!.percentOfParcel).toBeLessThan(55);
  });
});
