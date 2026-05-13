/**
 * Tests for the accurate rate-recovery uplift calculator.
 *
 * Numbers here are the contract: every calculation must match what the
 * council CFO would compute by hand against the published schedule.
 */

import { describe, it, expect } from "vitest";
import type { RateTable } from "@ratesassist/contract";
import {
  calculateUplift,
  BACKDATING_CONSERVATIVE_YEARS,
  BACKDATING_STATUTORY_YEARS,
} from "../src/upliftCalculator.js";

const EVAL_DATE = "2026-05-14";

const TABLE: RateTable = {
  councilCode: "KAL",
  financialYear: "2025-26",
  effectiveFrom: "2025-07-01",
  effectiveTo: "2026-06-30",
  sourceUrl: "https://example.com/kal-rates",
  retrievedAt: "2026-05-14",
  verified: true,
  lines: [
    { landUse: "Residential", rateInDollar: 0.085, minimumPayment: 1_200, basis: "GRV" },
    { landUse: "Commercial", rateInDollar: 0.13, minimumPayment: 1_400, basis: "GRV" },
    { landUse: "Industrial", rateInDollar: 0.16, minimumPayment: 1_500, basis: "GRV" },
    { landUse: "Vacant", rateInDollar: 0.17, minimumPayment: 1_200, basis: "GRV" },
    { landUse: "Rural", rateInDollar: 0.045, minimumPayment: 1_100, basis: "UV" },
    { landUse: "Mining", rateInDollar: 0.225, minimumPayment: 1_500, basis: "UV" },
    { landUse: "Pastoral", rateInDollar: 0.06, minimumPayment: 1_100, basis: "UV" },
    { landUse: "MiningOther", rateInDollar: 0.18, minimumPayment: 1_500, basis: "UV" },
  ],
};

const UNVERIFIED_TABLE: RateTable = {
  ...TABLE,
  verified: false,
  carriedForward: true,
  note: "Carried forward from 2024-25",
};

describe("calculateUplift — happy path", () => {
  it("Residential @ 8.5c on $400k GRV gives $34,000/yr (above min)", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A1",
        councilCode: "KAL",
        grv: 400_000,
        currentLandUse: "Residential",
        currentAnnualRates: 1_200,
      },
      correctLandUse: "Residential",
      changeDetectedAt: "2025-05-14",
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.correctAnnualRates).toBe(34_000);
    expect(r.rateBasis).toBe("GRV");
  });

  it("GRV × rate below minimum → take minimum", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A2",
        councilCode: "KAL",
        grv: 5_000,
        currentLandUse: "Residential",
        currentAnnualRates: 1_200,
      },
      correctLandUse: "Residential",
      changeDetectedAt: "2025-05-14",
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 5_000 * 0.085 = 425 -> floor 1_200
    expect(r.correctAnnualRates).toBe(1_200);
    expect(r.caveats.some((c) => c.toLowerCase().includes("minimum"))).toBe(true);
  });

  it("Mining @ 22.5c on $63,100 UV vs Rural @ 4.5c on $40,400 UV", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "KAL-4401-12",
        councilCode: "KAL",
        uv: 40_400,
        currentLandUse: "Rural",
        currentAnnualRates: 1_818,
      },
      correctLandUse: "Mining",
      changeDetectedAt: "2024-02-15",
      rateTable: { ...TABLE, lines: TABLE.lines.map((l) => l) },
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Mining uses UV (same property's UV = 40,400) * 0.225 = 9,090; above min.
    // Rural: 40,400 * 0.045 = 1,818 ; above min.
    expect(r.currentAnnualRates).toBeCloseTo(1_818, 0);
    expect(r.correctAnnualRates).toBeCloseTo(9_090, 0);
    expect(r.annualUplift).toBeCloseTo(7_272, 0);
  });

  it("rural basis target uses UV not GRV when both present", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A3",
        councilCode: "KAL",
        grv: 20_000,
        uv: 100_000,
        currentLandUse: "Rural",
        currentAnnualRates: 4_500,
      },
      correctLandUse: "Mining",
      changeDetectedAt: "2025-01-01",
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rateBasis).toBe("UV");
    expect(r.correctAnnualRates).toBe(22_500); // 100,000 * 0.225
  });
});

describe("calculateUplift — backdating math", () => {
  it("change ~2.5y ago: conservative == statutory == 2.5×uplift", () => {
    // 2.5 years before EVAL_DATE 2026-05-14 ≈ 2023-11-14
    const r = calculateUplift({
      property: {
        assessmentNumber: "A4",
        councilCode: "KAL",
        uv: 100_000,
        currentLandUse: "Rural",
        currentAnnualRates: 4_500,
      },
      correctLandUse: "Mining",
      changeDetectedAt: "2023-11-14",
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.yearsSinceChange).toBeGreaterThan(2.4);
    expect(r.yearsSinceChange).toBeLessThan(2.6);
    // Within both caps -> equal
    expect(r.backdatedYearsConservative).toBe(r.yearsSinceChange);
    expect(r.backdatedYearsStatutory).toBe(r.yearsSinceChange);
    expect(r.backdatedAmountConservative).toBeCloseTo(
      r.annualUplift * r.yearsSinceChange,
      0,
    );
  });

  it("change ~7y ago: conservative caps at 3y, statutory caps at 5y", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A5",
        councilCode: "KAL",
        uv: 100_000,
        currentLandUse: "Rural",
        currentAnnualRates: 4_500,
      },
      correctLandUse: "Mining",
      changeDetectedAt: "2019-05-14",
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.yearsSinceChange).toBeGreaterThan(6);
    expect(r.backdatedYearsConservative).toBe(BACKDATING_CONSERVATIVE_YEARS);
    expect(r.backdatedYearsStatutory).toBe(BACKDATING_STATUTORY_YEARS);
    expect(r.backdatedAmountConservative).toBeCloseTo(r.annualUplift * 3, 0);
    expect(r.backdatedAmountStatutory).toBeCloseTo(r.annualUplift * 5, 0);
    expect(r.caveats.some((c) => c.includes("statutory cap"))).toBe(true);
  });

  it("future-dated change yields 0 backdating, not negative", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A6",
        councilCode: "KAL",
        uv: 100_000,
        currentLandUse: "Rural",
        currentAnnualRates: 4_500,
      },
      correctLandUse: "Mining",
      changeDetectedAt: "2028-01-01",
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.yearsSinceChange).toBe(0);
    expect(r.backdatedAmountConservative).toBe(0);
    expect(r.backdatedAmountStatutory).toBe(0);
  });
});

describe("calculateUplift — failure modes", () => {
  it("missing GRV when basis = GRV returns missing_grv", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A7",
        councilCode: "KAL",
        currentLandUse: "Residential",
        currentAnnualRates: 1_200,
      },
      correctLandUse: "Residential",
      changeDetectedAt: "2025-01-01",
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("missing_grv");
    expect(r.message).toMatch(/GRV/);
  });

  it("missing UV when basis = UV returns missing_uv", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A8",
        councilCode: "KAL",
        grv: 50_000,
        currentLandUse: "Residential",
        currentAnnualRates: 1_200,
      },
      correctLandUse: "Mining",
      changeDetectedAt: "2025-01-01",
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("missing_uv");
  });

  it("unknown land-use returns no_rate_line", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A9",
        councilCode: "KAL",
        grv: 50_000,
        currentLandUse: "Residential",
        currentAnnualRates: 1_200,
      },
      // @ts-expect-error testing runtime guard
      correctLandUse: "NotARealCategory",
      changeDetectedAt: "2025-01-01",
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("no_rate_line");
  });

  it("invalid change date returns invalid_change_date", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A10",
        councilCode: "KAL",
        grv: 50_000,
        currentLandUse: "Residential",
        currentAnnualRates: 1_200,
      },
      correctLandUse: "Commercial",
      changeDetectedAt: "not-a-date",
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_change_date");
  });
});

describe("calculateUplift — provenance & formula", () => {
  it("unverified rate table surfaces caveat", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A11",
        councilCode: "KAL",
        uv: 100_000,
        currentLandUse: "Rural",
        currentAnnualRates: 4_500,
      },
      correctLandUse: "Mining",
      changeDetectedAt: "2024-05-14",
      rateTable: UNVERIFIED_TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.verified).toBe(false);
    expect(r.caveats.some((c) => c.toLowerCase().includes("verified"))).toBe(true);
    expect(r.caveats.some((c) => c.toLowerCase().includes("carried forward"))).toBe(
      true,
    );
  });

  it("formula string includes basis, rate, value and uplift", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A12",
        councilCode: "KAL",
        uv: 100_000,
        currentLandUse: "Rural",
        currentAnnualRates: 4_500,
      },
      correctLandUse: "Mining",
      changeDetectedAt: "2024-05-14",
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.formula).toContain("Current");
    expect(r.formula).toContain("Correct");
    expect(r.formula).toContain("UV");
    expect(r.formula).toContain("$100,000");
    expect(r.formula).toContain("/yr");
    expect(r.formula).toContain("Backdated");
  });

  it("source URL passes through verbatim", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A13",
        councilCode: "KAL",
        uv: 100_000,
        currentLandUse: "Rural",
        currentAnnualRates: 4_500,
      },
      correctLandUse: "Mining",
      changeDetectedAt: "2024-05-14",
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sourceUrl).toBe("https://example.com/kal-rates");
  });
});

describe("calculateUplift — total recoverable", () => {
  it("totalRecoverableConservative = 3y backdated + 1y forward", () => {
    const r = calculateUplift({
      property: {
        assessmentNumber: "A14",
        councilCode: "KAL",
        uv: 100_000,
        currentLandUse: "Rural",
        currentAnnualRates: 4_500,
      },
      correctLandUse: "Mining",
      changeDetectedAt: "2019-05-14", // >5y ago
      rateTable: TABLE,
      evaluationDate: EVAL_DATE,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalRecoverableConservative).toBeCloseTo(r.annualUplift * 4, 0);
    expect(r.totalRecoverableStatutory).toBeCloseTo(r.annualUplift * 6, 0);
  });
});
