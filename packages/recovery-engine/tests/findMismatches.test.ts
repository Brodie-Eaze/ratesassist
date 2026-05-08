/**
 * Snapshot-style determinism check for findMismatches over a small fixed dataset.
 * The legacy code is the oracle: assert literal output keys & ordering.
 */

import { describe, it, expect } from "vitest";
import type { Owner, Property, Tenement } from "@ratesassist/contract";
import { findMismatches } from "../src/findMismatches.js";
import type { EvaluationContext } from "../src/scoring.js";

// NOTE: live scoring.ts reads owner.abnCheck (migration target); contract type
// still declares `abnStatus`. We populate both via a cast so tests can run.
const owners: Owner[] = [
  {
    ownerId: "O-MINER",
    name: "Pilbara Iron Holdings Pty Ltd",
    abn: "32614882110",
    abnStatus: "Active",
    abnCheck: { kind: "checked", status: "Active", checkedAt: "2026-05-01" },
    postalAddress: "PO Box 1",
    email: null,
    phone: null,
    ownerSince: "2020-01-01",
    previousOwners: [],
  } as unknown as Owner,
  {
    ownerId: "O-FARMER",
    name: "Smith Family Trust",
    abn: null,
    abnCheck: { kind: "unchecked" },
    postalAddress: "RMB 200",
    email: null,
    phone: null,
    ownerSince: "1995-01-01",
    previousOwners: [],
  } as unknown as Owner,
  {
    ownerId: "O-DEAD",
    name: "Old Resources Pty Ltd",
    abn: "11111111111",
    abnStatus: "Cancelled",
    abnCheck: { kind: "checked", status: "Cancelled", checkedAt: "2026-05-01" },
    postalAddress: "PO Box 99",
    email: null,
    phone: null,
    ownerSince: "2010-01-01",
    previousOwners: [],
  } as unknown as Owner,
];

const properties: Property[] = [
  {
    assessmentNumber: "A-MINE",
    council: "TPS",
    address: "Mine Rd",
    suburb: "Karratha",
    postcode: "6714",
    state: "WA",
    landUse: "Rural",
    valuation: 5_000_000,
    annualRates: 5_000,
    balance: 0,
    lastPaymentDate: null,
    lastPaymentAmount: null,
    paymentMethod: null,
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-MINER"],
    notes: [],
    lat: -20.7,
    lng: 116.8,
  },
  {
    assessmentNumber: "A-FARM",
    council: "TPS",
    address: "Farm Rd",
    suburb: "Karratha",
    postcode: "6714",
    state: "WA",
    landUse: "Rural",
    valuation: 200_000,
    annualRates: 1_500,
    balance: 0,
    lastPaymentDate: null,
    lastPaymentAmount: null,
    paymentMethod: null,
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-FARMER"],
    notes: [],
    lat: -20.71,
    lng: 116.81,
  },
  {
    assessmentNumber: "A-DEAD",
    council: "TPS",
    address: "Empty St",
    suburb: "Karratha",
    postcode: "6714",
    state: "WA",
    landUse: "Vacant",
    valuation: 50_000,
    annualRates: 800,
    balance: 1_200,
    lastPaymentDate: null,
    lastPaymentAmount: null,
    paymentMethod: null,
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-DEAD"],
    notes: [],
    lat: -20.72,
    lng: 116.82,
  },
];

const tenements: Tenement[] = [
  {
    tenementId: "M-501",
    type: "M",
    status: "Live",
    holder: "Pilbara Iron Holdings Pty Ltd",
    holderAbn: "32614882110",
    commodity: ["iron"],
    grantedDate: "2010-01-01",
    expiryDate: "2030-01-01",
    areaHectares: 250,
    intersectsAssessmentNumbers: ["A-MINE"],
    isProducing: true,
    lastWorkProgramYear: 2024,
    polygon: [],
  },
];

const ctx: EvaluationContext = {
  properties,
  ownersById: new Map(owners.map((o) => [o.ownerId, o])),
  tenementsByAssessment: new Map([["A-MINE", tenements]]),
};

describe("findMismatches — deterministic snapshot", () => {
  it("returns the expected ranked candidates", () => {
    const result = findMismatches(ctx);
    // A-MINE: producing tenement (0.55) + industry term in owner name (0.20) → 0.75 → high
    // A-DEAD: cancelled ABN (0.30) + industry term "resources" on vacant (0.20) → 0.50 → medium
    // A-FARM: no signals fire (no tenement, plain owner name, abnCheck unchecked,
    //         too few suburb peers for outlier signal).
    const assessments = result.map((r) => r.assessmentNumber);
    expect(assessments).toEqual(["A-MINE", "A-DEAD"]);

    const mine = result.find((r) => r.assessmentNumber === "A-MINE")!;
    expect(mine.severity).toBe("high");
    expect(mine.compositeScore).toBeCloseTo(0.75, 10);
    expect(mine.kind).toBe("Producing tenement");
    expect(mine.estAnnualRatesNew).toBe(40_000); // 5000 * 8 (high)
    expect(mine.estUplift).toBe(35_000);
    expect(mine.estArrears3y).toBe(105_000);

    const dead = result.find((r) => r.assessmentNumber === "A-DEAD")!;
    expect(dead.severity).toBe("medium");
    expect(dead.compositeScore).toBeCloseTo(0.50, 10);
  });

  it("minSeverity=high drops the medium ABN/industry candidate", () => {
    const r = findMismatches(ctx, { minSeverity: "high" });
    expect(r.map((x) => x.assessmentNumber)).toEqual(["A-MINE"]);
  });

  it("council filter excludes other tenants", () => {
    const r = findMismatches(ctx, { council: "OTHER" });
    expect(r).toEqual([]);
  });

  it("is sorted by estUplift descending", () => {
    const r = findMismatches(ctx);
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1]!.estUplift).toBeGreaterThanOrEqual(r[i]!.estUplift);
    }
  });
});
