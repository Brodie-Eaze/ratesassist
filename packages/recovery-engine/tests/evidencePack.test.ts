/**
 * Unit tests for buildEvidencePack — focused on the state-template guard,
 * priority-by-weight sorting (Section 5 + headline panel), and the new
 * Title-state (Section 8) and Concession-audit (Section 9) blocks.
 *
 * The full happy-path is exercised indirectly via findMismatches.test.ts;
 * this file pins the refusal contracts AND the new rendering behaviour
 * introduced by the VEN + CT + Concession feature.
 */

import { describe, it, expect } from "vitest";
import type {
  Encumbrance,
  Owner,
  PensionerConcession,
  Pin,
  Property,
  SignalHit,
  Tenement,
  TitleSourceFreshness,
} from "@ratesassist/contract";
import {
  buildEvidencePack,
  sortSignalsByPriority,
} from "../src/evidencePack.js";
import type { EvaluationContext } from "../src/scoring.js";

function makeCtx(
  state: Property["state"],
  tenementType: Tenement["type"] = "M",
): EvaluationContext {
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
    tenementId: tenementType === "L" ? "L-777" : "M-501",
    type: tenementType,
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

// ---------------------------------------------------------------------------
// Priority-by-weight sort + headline panel
// ---------------------------------------------------------------------------

describe("sortSignalsByPriority — stable weight DESC, id tiebreaker", () => {
  it("sorts signals by weight descending", () => {
    const hits: SignalHit[] = [
      mkHit("low", 0.15),
      mkHit("high", 0.55),
      mkHit("mid", 0.30),
    ];
    const sorted = sortSignalsByPriority(hits);
    expect(sorted.map((s) => s.id)).toEqual(["high", "mid", "low"]);
  });

  it("breaks ties by id alphabetic order (stable / deterministic)", () => {
    const hits: SignalHit[] = [
      mkHit("zulu", 0.40),
      mkHit("alpha", 0.40),
      mkHit("mike", 0.40),
    ];
    const sorted = sortSignalsByPriority(hits);
    expect(sorted.map((s) => s.id)).toEqual(["alpha", "mike", "zulu"]);
  });

  it("does not mutate the input array", () => {
    const hits: SignalHit[] = [mkHit("a", 0.1), mkHit("b", 0.9)];
    const before = hits.map((s) => s.id).join(",");
    sortSignalsByPriority(hits);
    expect(hits.map((s) => s.id).join(",")).toBe(before);
  });

  it("returns a new array (referential inequality)", () => {
    const hits: SignalHit[] = [mkHit("a", 0.1)];
    expect(sortSignalsByPriority(hits)).not.toBe(hits);
  });
});

describe("buildEvidencePack — priority-by-weight rendering", () => {
  it("exposes prioritisedSignals + headlineSignals on the pack", () => {
    const ctx = makeRichCtx();
    const result = buildEvidencePack("A-MULTI", ctx, {
      now: () => new Date("2026-05-15T00:00:00Z"),
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Five signals fire in this fixture (producing tenement + cadastre lag
    // + EMITS + DA approved + ABN cancelled).
    expect(result.pack.prioritisedSignals.length).toBeGreaterThanOrEqual(3);
    // Headline is the first three by weight.
    expect(result.pack.headlineSignals.length).toBe(3);
    expect(result.pack.headlineSignals[0]!.weight).toBeGreaterThanOrEqual(
      result.pack.headlineSignals[1]!.weight,
    );
    expect(result.pack.headlineSignals[1]!.weight).toBeGreaterThanOrEqual(
      result.pack.headlineSignals[2]!.weight,
    );
  });

  it("renders signals in Section 3 sorted by weight descending", () => {
    const ctx = makeRichCtx();
    const result = buildEvidencePack("A-MULTI", ctx, {
      now: () => new Date("2026-05-15T00:00:00Z"),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    const md = result.pack.markdown;
    // Highest-weight signal text must appear before lower-weight signal
    // text in the rendered markdown.
    const highestIdx = md.indexOf(result.pack.prioritisedSignals[0]!.short);
    const lowestIdx = md.indexOf(
      result.pack.prioritisedSignals[
        result.pack.prioritisedSignals.length - 1
      ]!.short,
    );
    expect(highestIdx).toBeGreaterThan(-1);
    expect(lowestIdx).toBeGreaterThan(highestIdx);
  });

  it("renders the Headline panel with the top 3 signals at the top of the pack", () => {
    const ctx = makeRichCtx();
    const result = buildEvidencePack("A-MULTI", ctx, {
      now: () => new Date("2026-05-15T00:00:00Z"),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    const md = result.pack.markdown;
    expect(md).toContain("Headline — top 3 signals by weight");
    // Headline panel must appear BEFORE Section 1 (Property identification).
    const headlineIdx = md.indexOf("Headline — top");
    const section1Idx = md.indexOf("## 1. Property identification");
    expect(headlineIdx).toBeGreaterThan(-1);
    expect(headlineIdx).toBeLessThan(section1Idx);
    // Each headline signal's `short` name appears in the panel.
    for (const s of result.pack.headlineSignals) {
      expect(md).toContain(s.short);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 8 — Title state
// ---------------------------------------------------------------------------

describe("buildEvidencePack — Section 8 Title state", () => {
  it("renders the PIN table when the property carries multi-PIN data", () => {
    const ctx = makeRichCtx();
    const result = buildEvidencePack("A-MULTI", ctx, {
      now: () => new Date("2026-05-15T00:00:00Z"),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    const md = result.pack.markdown;
    expect(md).toContain("## 8. Title state");
    expect(md).toContain("PINs on this VEN (3)");
    // Each PIN's id appears in the table.
    expect(md).toContain("1234567");
    expect(md).toContain("1234568");
    expect(md).toContain("1234569");
    // The divergent PIN is flagged MISMATCH; matching ones flagged OK.
    expect(md).toContain("MISMATCH");
    expect(md).toContain("OK");
  });

  it("renders encumbrances with type + reference + date", () => {
    const ctx = makeRichCtx();
    const result = buildEvidencePack("A-MULTI", ctx, {
      now: () => new Date("2026-05-15T00:00:00Z"),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.pack.markdown).toContain("Registered encumbrances");
    expect(result.pack.markdown).toContain("mortgage");
    expect(result.pack.markdown).toContain("M-12345");
  });

  it("renders the title-source freshness label", () => {
    const ctx = makeRichCtx();
    const result = buildEvidencePack("A-MULTI", ctx, {
      now: () => new Date("2026-05-15T00:00:00Z"),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.pack.markdown).toContain("landgate_restricted");
    expect(result.pack.markdown).toContain("2026-05-14");
  });

  it("omits Section 8 entirely when the property has no title-state fields", () => {
    // The legacy WA fixture in makeCtx() has no ven/pins/etc — section 8
    // should not render scaffolding for a property with no data.
    const ctx = makeCtx("WA");
    const result = buildEvidencePack("A-MINE", ctx, {
      now: () => new Date("2026-05-10T00:00:00Z"),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.pack.markdown).not.toContain("## 8. Title state");
  });
});

// ---------------------------------------------------------------------------
// Section 9 — Concession audit
// ---------------------------------------------------------------------------

describe("buildEvidencePack — Section 9 Concession audit", () => {
  it("renders the concession block with WC cancellation status", () => {
    const ctx = makeRichCtx();
    const result = buildEvidencePack("A-MULTI", ctx, {
      now: () => new Date("2026-05-15T00:00:00Z"),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    const md = result.pack.markdown;
    expect(md).toContain("## 9. Concession audit");
    expect(md).toContain("Cancelled — no longer eligible");
    expect(md).toContain("Rates and Charges");
    expect(md).toContain("Recommended action");
    // Cancellation reason surfaces.
    expect(md).toContain("Customer requested cancellation");
  });

  it("masks the concession card number to last 4 digits", () => {
    const ctx = makeRichCtx();
    const result = buildEvidencePack("A-MULTI", ctx, {
      now: () => new Date("2026-05-15T00:00:00Z"),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    // Card "PCC1234567890123" -> last 4 = "0123"; full card must NOT appear.
    expect(result.pack.markdown).not.toContain("PCC1234567890123");
    expect(result.pack.markdown).toContain("0123");
  });

  it("renders a postal-vs-property comparison row", () => {
    const ctx = makeRichCtx();
    const result = buildEvidencePack("A-MULTI", ctx, {
      now: () => new Date("2026-05-15T00:00:00Z"),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    const md = result.pack.markdown;
    expect(md).toContain("Postal vs property address comparison");
    expect(md).toContain("Property address");
    expect(md).toContain("Proprietor postal");
  });

  it("omits Section 9 entirely when there is no pensioner concession on file", () => {
    const ctx = makeCtx("WA");
    const result = buildEvidencePack("A-MINE", ctx, {
      now: () => new Date("2026-05-10T00:00:00Z"),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.pack.markdown).not.toContain("## 9. Concession audit");
  });

  it("recommends executor engagement for deceased status", () => {
    const ctx = makeDeceasedCtx();
    const result = buildEvidencePack("A-DECEASED", ctx, {
      now: () => new Date("2026-05-15T00:00:00Z"),
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.pack.markdown).toContain("executor");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkHit(id: string, weight: number): SignalHit {
  return {
    id,
    name: id,
    short: id,
    category: "register",
    weight,
    source: "test",
    evidence: `evidence-${id}`,
  };
}

/**
 * Rich context with multi-PIN, encumbrances, concession (cancelled), and
 * enough signals firing that the headline panel has 3 entries.
 */
function makeRichCtx(): EvaluationContext {
  const owner: Owner = {
    ownerId: "O-MULTI",
    name: "Pilbara Iron Holdings Pty Ltd",
    abn: "32614882110",
    abnCheck: { kind: "checked", status: "Cancelled", checkedAt: "2026-05-01" },
    postalAddress: "PO Box 99, Perth WA 6000",
    email: null,
    phone: null,
    ownerSince: "2020-01-01",
    previousOwners: [],
  };

  const pins: Pin[] = [
    {
      pin: "1234567",
      lotPlan: "Lot 42 DP 18337",
      landuseCode: "Rural",
      areaSquareMetres: 8500,
    },
    {
      pin: "1234568",
      lotPlan: "Lot 43 DP 18337",
      landuseCode: "Industrial",
      areaSquareMetres: 4200,
    },
    {
      pin: "1234569",
      lotPlan: "Lot 44 DP 18337",
      landuseCode: "Rural",
      areaSquareMetres: 6800,
    },
  ];

  const encumbrances: Encumbrance[] = [
    {
      type: "mortgage",
      reference: "M-12345",
      date: "2022-08-14",
      source: "landgate_restricted",
    },
    {
      type: "caveat",
      reference: "C-98765",
      date: "2024-03-01",
      source: "landgate_restricted",
    },
  ];

  const titleSource: TitleSourceFreshness = {
    source: "landgate_restricted",
    retrievedAt: "2026-05-14",
  };

  const concession: PensionerConcession = {
    applied: true,
    type: "pensioner",
    appliedAt: "2019-01-01",
    cardNumber: "PCC1234567890123",
    cardExpiry: "2025-12-31",
    wcEligibilityVerifiedAt: "2026-05-13",
    wcEligibilityStatus: "cancelled",
    wcCancellationReason: "Customer requested cancellation — moved interstate",
    wcCancellationDate: "2026-02-10",
  };

  const property: Property = {
    assessmentNumber: "A-MULTI",
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
    pensionerRebate: true,
    paymentArrangement: false,
    ownerIds: ["O-MULTI"],
    notes: [],
    lat: -20.7,
    lng: 116.8,
    ven: "VEN-001",
    pins,
    ctVolume: "2735",
    ctFolio: "421",
    ctIssuedDate: "2018-06-12",
    proprietorOnTitle: "Pilbara Iron Holdings Pty Ltd",
    proprietorPostalAddress: "PO Box 99, Perth WA 6000",
    encumbrances,
    pensionerConcession: concession,
    titleSource,
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
    intersectsAssessmentNumbers: ["A-MULTI"],
    isProducing: true,
    lastWorkProgramYear: 2024,
    polygon: [],
  };

  return {
    properties: [property],
    ownersById: new Map([[owner.ownerId, owner]]),
    tenementsByAssessment: new Map([["A-MULTI", [tenement]]]),
    lagCandidatesByAssessment: new Map([
      [
        "A-MULTI",
        [
          {
            severityHint: "high",
            reasoning:
              "DMIRS tenement M-501 (producing) intersects parcel rated Rural in Landgate cadastre.",
          },
        ],
      ],
    ]),
    emitsApprovalsByTenement: new Map([
      [
        "M-501",
        [{ active: true, reasoning: "Mining Proposal MP-2024-0042 active." }],
      ],
    ]),
    changeDetectionByAssessment: new Map([
      [
        "A-MULTI",
        [
          {
            kind: "construction_approved",
            detectedAt: "2025-09-01",
            reasoning: "DA-2025-114 approved for processing facility.",
          },
        ],
      ],
    ]),
  };
}

function makeDeceasedCtx(): EvaluationContext {
  const owner: Owner = {
    ownerId: "O-LATE",
    name: "Mr Late",
    abn: null,
    abnCheck: { kind: "unchecked" },
    postalAddress: "7 Sunset Cres, Karratha",
    email: null,
    phone: null,
    ownerSince: "1995-01-01",
    previousOwners: [],
  };

  const concession: PensionerConcession = {
    applied: true,
    type: "pensioner",
    appliedAt: "1996-01-01",
    cardNumber: "PCC0000000099999",
    wcEligibilityVerifiedAt: "2026-05-12",
    wcEligibilityStatus: "deceased",
    wcCancellationDate: "2026-02-10",
  };

  const property: Property = {
    assessmentNumber: "A-DECEASED",
    council: "TPS",
    address: "7 Sunset Cres",
    suburb: "Karratha",
    postcode: "6714",
    state: "WA",
    landUse: "Residential",
    valuation: 450_000,
    annualRates: 1_800,
    balance: 0,
    lastPaymentDate: null,
    lastPaymentAmount: null,
    paymentMethod: null,
    pensionerRebate: true,
    paymentArrangement: false,
    ownerIds: ["O-LATE"],
    notes: [],
    lat: -20.7,
    lng: 116.8,
    proprietorPostalAddress: "7 Sunset Cres, Karratha WA 6714",
    pensionerConcession: concession,
    titleSource: {
      source: "wc_feed",
      retrievedAt: "2026-05-12",
    },
  };

  return {
    properties: [property],
    ownersById: new Map([[owner.ownerId, owner]]),
    tenementsByAssessment: new Map(),
    // No tenements, but ABN-status signal fires.
    addressDiscrepanciesByAssessment: new Map([
      [
        "A-DECEASED",
        [
          {
            severityHint: "medium",
            reasoning: "Landgate proprietor name differs from rating record.",
          },
        ],
      ],
    ]),
  };
}

describe("buildEvidencePack — legal-risk callout (miscellaneous licence)", () => {
  it("renders the contested-law callout when a misc-licence tenement is present", () => {
    const result = buildEvidencePack("A-MINE", makeCtx("WA", "L"), {});
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.pack.markdown).toMatch(/Legal risk/i);
      expect(result.pack.markdown).toMatch(/L-777/);
      expect(result.pack.markdown).toMatch(/Mount Magnet|refund liability/i);
    }
  });

  it("omits the callout for a normal mining-lease recovery", () => {
    const result = buildEvidencePack("A-MINE", makeCtx("WA"), {});
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.pack.markdown).not.toMatch(/Legal risk/i);
    }
  });
});
