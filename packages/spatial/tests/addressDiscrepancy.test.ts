/**
 * Tests for `compareAddressRecords`. Covers each of the five
 * AddressDiscrepancyKind classifiers plus the no-discrepancy path.
 */

import { describe, it, expect } from "vitest";
import { compareAddressRecords } from "../src/addressDiscrepancy.js";

const FIXED_NOW = "2026-05-10T00:00:00Z";
const now = (): string => FIXED_NOW;

describe("compareAddressRecords", () => {
  it("returns null when records match after normalisation", () => {
    const r = compareAddressRecords({
      techone: {
        assessmentNumber: "A1",
        address: "12 Stadium Road, Tom Price",
        landUse: "Residential - single dwelling",
        lotPlan: "Lot 12 DP 191228",
      },
      landgate: {
        address: "12 Stadium Road,  Tom Price",
        landuseDescription: "Residential - single dwelling",
        lotPlan: "Lot 12 DP 191228",
      },
      now,
    });
    expect(r).toBeNull();
  });

  it("classifies industrial_reuse for rural→industrial", () => {
    const r = compareAddressRecords({
      techone: {
        assessmentNumber: "TPS-1102-44",
        address: "Lot 1144 Great Northern Highway, Tom Price",
        landUse: "Rural",
        lotPlan: "Lot 1144 DP 230711",
      },
      landgate: {
        address: "Lot 1144 Great Northern Highway, Tom Price",
        landuseDescription: "Industrial - mining-related infrastructure",
        lotPlan: "Lot 1144 DP 230711",
      },
      now,
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("industrial_reuse");
    expect(r!.severityHint).toBe("high");
    expect(r!.detectedAt).toBe(FIXED_NOW);
  });

  it("classifies landuse_reclass when codes differ but neither is industrial", () => {
    const r = compareAddressRecords({
      techone: {
        assessmentNumber: "A2",
        address: "8 Newman Drive, Newman",
        landUse: "Commercial",
        lotPlan: "Lot 8 DP 304221",
      },
      landgate: {
        address: "8 Newman Drive, Newman",
        landuseDescription: "Commercial - retail",
        lotPlan: "Lot 8 DP 304221",
      },
      now,
    });
    // Both contain "commercial" but the descriptions differ → landuse_reclass
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("landuse_reclass");
    expect(r!.severityHint).toBe("medium");
  });

  it("classifies subdivision when Landgate has a child-lot suffix", () => {
    const r = compareAddressRecords({
      techone: {
        assessmentNumber: "KAL-7777-01",
        address: "211 Hannan Street, Kalgoorlie",
        landUse: "Commercial - retail",
        lotPlan: "Lot 211 DP 411902",
      },
      landgate: {
        address: "211A Hannan Street, Kalgoorlie",
        landuseDescription: "Commercial - retail",
        lotPlan: "Lot 211A DP 411902",
      },
      now,
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("subdivision");
    expect(r!.severityHint).toBe("high");
  });

  it("classifies address_renumber when only the street number changes", () => {
    const r = compareAddressRecords({
      techone: {
        assessmentNumber: "TPS-3041-12",
        address: "12 Stadium Road, Tom Price",
        landUse: "Residential",
        lotPlan: "Lot 12 DP 191228",
      },
      landgate: {
        address: "14 Stadium Road, Tom Price",
        landuseDescription: "Residential",
        lotPlan: "Lot 12 DP 191228",
      },
      now,
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("address_renumber");
    expect(r!.severityHint).toBe("medium");
  });

  it("classifies lot_plan_amend when only lot/plan changes", () => {
    const r = compareAddressRecords({
      techone: {
        assessmentNumber: "ASH-9911-04",
        address: "Lot 9914 Nanutarra-Wittenoom Road, Pannawonica",
        landUse: "Industrial",
        lotPlan: "Lot 9914 DP 552108",
      },
      landgate: {
        address: "Lot 9914 Nanutarra-Wittenoom Road, Pannawonica",
        landuseDescription: "Industrial",
        lotPlan: "Lot 9914A DP 552108",
      },
      now,
    });
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("lot_plan_amend");
    expect(r!.severityHint).toBe("low");
  });

  it("reasoning string mentions both the council and the Landgate value", () => {
    const r = compareAddressRecords({
      techone: {
        assessmentNumber: "ESH-7011-08",
        address: "8 Newman Drive, Newman",
        landUse: "Commercial",
        lotPlan: "Lot 8 DP 304221",
      },
      landgate: {
        address: "8 Newman Drive, Newman",
        landuseDescription: "Industrial - heavy industry",
        lotPlan: "Lot 8 DP 304221",
      },
      now,
    });
    expect(r).not.toBeNull();
    expect(r!.reasoning).toContain("Industrial");
    expect(r!.reasoning).toContain("Commercial");
  });
});
