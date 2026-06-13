/**
 * IAAO ratio-study math, verified against hand-computed worked examples, plus
 * the peer-dispersion + roll-quality layers that run on current (sale-price-free)
 * data. Pure; no I/O.
 */

import { describe, expect, it } from "vitest";

import {
  computeRatioStats,
  assessUniformity,
  peerDispersion,
  rollQuality,
  IAAO_COD_UPPER,
} from "../src/ratioStudy.js";
import type { LandUse } from "@ratesassist/contract";

describe("computeRatioStats — IAAO math", () => {
  it("computes median / COD / mean / PRD on a symmetric set (hand-verified)", () => {
    // ratios 0.90,0.95,1.00,1.05,1.10 (market=100). median 1.00; COD = 100*0.06 = 6.0.
    const s = computeRatioStats([
      { assessed: 90, market: 100 },
      { assessed: 95, market: 100 },
      { assessed: 100, market: 100 },
      { assessed: 105, market: 100 },
      { assessed: 110, market: 100 },
    ]);
    expect(s.n).toBe(5);
    expect(s.medianRatio).toBeCloseTo(1.0, 6);
    expect(s.meanRatio).toBeCloseTo(1.0, 6);
    expect(s.weightedMeanRatio).toBeCloseTo(1.0, 6);
    expect(s.cod).toBeCloseTo(6.0, 6);
    expect(s.prd).toBeCloseTo(1.0, 6);
  });

  it("perfect uniformity → COD 0, PRD 1, PRB 0", () => {
    const s = computeRatioStats([
      { assessed: 100, market: 100 },
      { assessed: 200, market: 200 },
      { assessed: 300, market: 300 },
    ]);
    expect(s.cod).toBeCloseTo(0, 6);
    expect(s.prd).toBeCloseTo(1.0, 6);
    expect(s.prb).toBeCloseTo(0, 6);
  });

  it("regressive roll → PRD > 1.03 and PRB negative (hand-verified)", () => {
    // small parcel over-assessed (1.10), large under-assessed (0.90).
    // weightedMean = 1010/1100 = 0.91818; PRD = 1.00/0.91818 = 1.0891.
    // PRB (2-pt slope) = -0.20 / (log2(950) - log2(105)) = -0.0629.
    const s = computeRatioStats([
      { assessed: 110, market: 100 },
      { assessed: 900, market: 1000 },
    ]);
    expect(s.prd).toBeCloseTo(1.0891, 3);
    expect(s.prb).toBeCloseTo(-0.0629, 3);
    expect(s.prb).toBeLessThan(-0.05);
  });

  it("returns all-zero stats for an empty set and skips non-positive markets", () => {
    expect(computeRatioStats([]).n).toBe(0);
    const s = computeRatioStats([
      { assessed: 100, market: 0 }, // skipped
      { assessed: 100, market: -5 }, // skipped
      { assessed: 100, market: 100 },
    ]);
    expect(s.n).toBe(1);
    expect(s.medianRatio).toBeCloseTo(1.0, 6);
  });
});

describe("assessUniformity — IAAO verdicts", () => {
  it("passes a uniform residential stratum and flags a regressive one", () => {
    const uniform = assessUniformity(
      computeRatioStats([
        { assessed: 95, market: 100 },
        { assessed: 100, market: 100 },
        { assessed: 105, market: 100 },
      ]),
      "Residential",
    );
    expect(uniform.codUpperBound).toBe(IAAO_COD_UPPER.Residential);
    expect(uniform.prdWithinStandard).toBe(true);
    expect(uniform.prdDirection).toBe("neutral");

    const regressive = assessUniformity(
      computeRatioStats([
        { assessed: 110, market: 100 },
        { assessed: 900, market: 1000 },
      ]),
      "Rural",
    );
    expect(regressive.prdWithinStandard).toBe(false);
    expect(regressive.prdDirection).toBe("regressive");
    expect(regressive.prbActionRequired).toBe(false); // -0.063 is past ±0.05 but within ±0.10
  });

  it("uses the property-class COD band (vacant/mining wider than residential)", () => {
    const stats = computeRatioStats([{ assessed: 100, market: 100 }]);
    expect(assessUniformity(stats, "Vacant").codUpperBound).toBe(25);
    expect(assessUniformity(stats, "Residential").codUpperBound).toBe(15);
  });
});

describe("peerDispersion", () => {
  it("is 0 for identical valuations and matches the hand-computed COD", () => {
    expect(peerDispersion([100, 100, 100]).cod).toBeCloseTo(0, 6);
    // [50,100,150]: median 100; COD = 100 * mean(50,0,50)/100 = 33.333
    const d = peerDispersion([50, 100, 150]);
    expect(d.medianValuation).toBe(100);
    expect(d.cod).toBeCloseTo(33.3333, 3);
  });
});

describe("rollQuality", () => {
  function prop(assessmentNumber: string, landUse: LandUse, suburb: string, valuation: number) {
    return { assessmentNumber, landUse, suburb, valuation };
  }

  it("flags a high-dispersion stratum with a usable sample and exposes outliers", () => {
    // Residential/Boddington: 5 tight + 1 wild industrial-sized valuation → high COD.
    const report = rollQuality([
      prop("R1", "Residential", "Boddington", 100),
      prop("R2", "Residential", "Boddington", 105),
      prop("R3", "Residential", "Boddington", 95),
      prop("R4", "Residential", "Boddington", 100),
      prop("R5", "Residential", "Boddington", 102),
      prop("R6", "Residential", "Boddington", 1200), // the anomaly
    ]);
    const stratum = report.strata.find((s) => s.suburb === "Boddington")!;
    expect(stratum.underSampled).toBe(false);
    expect(stratum.exceedsStandard).toBe(true); // COD ≫ 15
    expect(stratum.topOutlierAssessments[0]).toBe("R6"); // furthest from median
    expect(report.flaggedStrata.map((s) => s.suburb)).toContain("Boddington");
    expect(report.note).toMatch(/no sale prices/i);
  });

  it("does not flag an under-sampled stratum (< IAAO minimum)", () => {
    const report = rollQuality([
      prop("M1", "Mining", "Leinster", 100),
      prop("M2", "Mining", "Leinster", 9000), // huge spread but only 2 parcels
    ]);
    const stratum = report.strata.find((s) => s.suburb === "Leinster")!;
    expect(stratum.underSampled).toBe(true);
    expect(stratum.exceedsStandard).toBe(false); // too small to flag
    expect(report.flaggedStrata).toHaveLength(0);
  });
});
