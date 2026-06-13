/**
 * Tenement ↔ parcel intersection: point-in-polygon correctness, the honest
 * "no geometry → unchanged" path, dedup/determinism, and the map inversion the
 * evaluation context consumes. Pure (no network).
 */

import { describe, expect, it } from "vitest";

import {
  pointInPolygon,
  assignTenementIntersections,
  groupTenementsByAssessment,
  type IntersectableParcel,
} from "../src/intersection.js";
import type { LatLng, Tenement } from "@ratesassist/contract";

// A ~2km square around a Pilbara centroid, in contract LatLng = [lat, lng].
const SQUARE: readonly LatLng[] = [
  [-22.70, 117.78],
  [-22.70, 117.80],
  [-22.68, 117.80],
  [-22.68, 117.78],
  [-22.70, 117.78],
];

function tenement(overrides: Partial<Tenement> = {}): Tenement {
  return {
    tenementId: "M 4701569",
    type: "M",
    status: "Live",
    holder: "Pilbara Resources Pty Ltd",
    holderAbn: null,
    commodity: ["Iron Ore"],
    grantedDate: "2020-01-01",
    expiryDate: "2041-01-01",
    areaHectares: 1234,
    intersectsAssessmentNumbers: [],
    isProducing: false,
    lastWorkProgramYear: null,
    polygon: SQUARE,
    ...overrides,
  };
}

function parcel(assessmentNumber: string, lat: number, lng: number): IntersectableParcel {
  return { assessmentNumber, lat, lng };
}

describe("pointInPolygon", () => {
  it("is true for a centroid inside the ring", () => {
    expect(pointInPolygon([-22.69, 117.79], SQUARE)).toBe(true);
  });

  it("is false for a point north / east of the ring", () => {
    expect(pointInPolygon([-22.60, 117.79], SQUARE)).toBe(false); // north
    expect(pointInPolygon([-22.69, 117.95], SQUARE)).toBe(false); // east
  });

  it("is false for a degenerate ring (< 3 vertices)", () => {
    expect(pointInPolygon([-22.69, 117.79], [[-22.70, 117.78], [-22.68, 117.80]])).toBe(false);
    expect(pointInPolygon([-22.69, 117.79], [])).toBe(false);
  });
});

describe("assignTenementIntersections", () => {
  it("attaches the assessment of a parcel whose centroid sits inside the tenement", () => {
    const out = assignTenementIntersections(
      [tenement()],
      [
        parcel("A-100", -22.69, 117.79), // inside
        parcel("B-200", -22.50, 117.79), // outside (north)
      ],
    );
    expect(out[0]!.intersectsAssessmentNumbers).toEqual(["A-100"]);
  });

  it("leaves a tenement with no usable polygon UNCHANGED (identity-stable)", () => {
    const pointTenement = tenement({ polygon: [] });
    const out = assignTenementIntersections([pointTenement], [parcel("A-100", -22.69, 117.79)]);
    expect(out[0]).toBe(pointTenement); // same object — no fabricated intersection
  });

  it("de-duplicates and sorts the assessment list deterministically", () => {
    const out = assignTenementIntersections(
      [tenement()],
      [
        parcel("Z-9", -22.69, 117.79),
        parcel("A-1", -22.685, 117.785),
        parcel("Z-9", -22.695, 117.795), // duplicate assessment, also inside
      ],
    );
    expect(out[0]!.intersectsAssessmentNumbers).toEqual(["A-1", "Z-9"]);
  });

  it("skips parcels with non-finite coordinates", () => {
    const out = assignTenementIntersections(
      [tenement()],
      [parcel("NAN", Number.NaN, 117.79), parcel("OK", -22.69, 117.79)],
    );
    expect(out[0]!.intersectsAssessmentNumbers).toEqual(["OK"]);
  });

  it("keeps an already-empty list identity-stable when there are no hits", () => {
    const t = tenement();
    const out = assignTenementIntersections([t], [parcel("FAR", -23.50, 119.00)]);
    expect(out[0]).toBe(t);
  });

  it("clears a previously non-empty list when geometry no longer matches", () => {
    const t = tenement({ intersectsAssessmentNumbers: ["STALE-1"] });
    const out = assignTenementIntersections([t], [parcel("FAR", -23.50, 119.00)]);
    expect(out[0]!.intersectsAssessmentNumbers).toEqual([]);
    expect(out[0]).not.toBe(t);
  });
});

describe("groupTenementsByAssessment", () => {
  it("inverts into assessment → tenements, only for intersecting tenements", () => {
    const a = tenement({ tenementId: "M 1", intersectsAssessmentNumbers: ["A-100"] });
    const b = tenement({ tenementId: "E 2", intersectsAssessmentNumbers: ["A-100", "B-200"] });
    const c = tenement({ tenementId: "P 3", intersectsAssessmentNumbers: [] }); // no hits
    const map = groupTenementsByAssessment([a, b, c]);

    expect(map.get("A-100")!.map((t) => t.tenementId)).toEqual(["M 1", "E 2"]);
    expect(map.get("B-200")!.map((t) => t.tenementId)).toEqual(["E 2"]);
    expect(map.has("(none)")).toBe(false);
    expect([...map.keys()].sort()).toEqual(["A-100", "B-200"]);
  });
});
