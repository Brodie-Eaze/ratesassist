/**
 * Unit tests for buildEvidencePack — focused on the state-template guard.
 *
 * The full happy-path is exercised indirectly via findMismatches.test.ts;
 * this file pins the no_state_template refusal that protects callers from
 * emitting a council-grade legal document with a placeholder citation.
 */

import { describe, it, expect } from "vitest";
import type { Owner, Property, Tenement } from "@ratesassist/contract";
import { buildEvidencePack } from "../src/evidencePack.js";
import type { EvaluationContext } from "../src/scoring.js";

function makeCtx(state: Property["state"]): EvaluationContext {
  const owner = {
    ownerId: "O-MINER",
    name: "Pilbara Iron Holdings Pty Ltd",
    abn: "32614882110",
    abnCheck: { kind: "checked", status: "Active", checkedAt: "2026-05-01" },
    postalAddress: "PO Box 1",
    email: null,
    phone: null,
    ownerSince: "2020-01-01",
    previousOwners: [],
  } as unknown as Owner;

  const property: Property = {
    assessmentNumber: "A-MINE",
    council: "TPS",
    address: "Mine Rd",
    suburb: "Karratha",
    postcode: "6714",
    state,
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
  };

  const tenement: Tenement = {
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
  };

  return {
    properties: [property],
    ownersById: new Map([[owner.ownerId, owner]]),
    tenementsByAssessment: new Map([["A-MINE", [tenement]]]),
  };
}

describe("buildEvidencePack — state template guard", () => {
  it("returns no_state_template for a state without a drafted citation", () => {
    // VIC has no entry in TEMPLATE_BY_STATE — the pack must be refused
    // rather than rendered with a placeholder citation.
    const ctx = makeCtx("VIC");
    const result = buildEvidencePack("A-MINE", ctx, {
      now: () => new Date("2026-05-10T00:00:00Z"),
    });
    expect(result.kind).toBe("no_state_template");
    if (result.kind === "no_state_template") {
      expect(result.state).toBe("VIC");
    }
  });

  it("renders successfully for WA (template present)", () => {
    const ctx = makeCtx("WA");
    const result = buildEvidencePack("A-MINE", ctx, {
      now: () => new Date("2026-05-10T00:00:00Z"),
    });
    expect(result.kind).toBe("ok");
  });

  it("renders successfully for NSW (template present)", () => {
    const ctx = makeCtx("NSW");
    const result = buildEvidencePack("A-MINE", ctx, {
      now: () => new Date("2026-05-10T00:00:00Z"),
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.pack.markdown).toContain("s.514");
      expect(result.pack.markdown).not.toContain("TODO");
    }
  });

  it("renders successfully for QLD (template present)", () => {
    const ctx = makeCtx("QLD");
    const result = buildEvidencePack("A-MINE", ctx, {
      now: () => new Date("2026-05-10T00:00:00Z"),
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.pack.markdown).toContain("s.94");
      expect(result.pack.markdown).not.toContain("TODO");
    }
  });
});
