/**
 * Characterization tests for the recovery-engine scoring layer.
 *
 * The legacy is the oracle: any value here mirrors what scoring.ts computes
 * today. If a number looks "off" the test pins what the code does, not what
 * we wish it did — fixes are tracked separately.
 */

import { describe, it, expect } from "vitest";
import type { Owner, Property, SignalHit, Tenement } from "@ratesassist/contract";
import {
  computeComposite,
  estimateUplift,
  evaluateSignals,
  severityForScore,
  type EvaluationContext,
} from "../src/scoring.js";
import { SIGNAL_CATALOGUE } from "../src/signals.js";

// ---- Fixture helpers ----

function prop(overrides: Partial<Property> = {}): Property {
  return {
    assessmentNumber: "A1",
    council: "TPS",
    address: "1 Test Way",
    suburb: "Karratha",
    postcode: "6714",
    state: "WA",
    landUse: "Rural",
    valuation: 100_000,
    annualRates: 1_000,
    balance: 0,
    lastPaymentDate: null,
    lastPaymentAmount: null,
    paymentMethod: null,
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O1"],
    notes: [],
    lat: -20.7,
    lng: 116.8,
    ...overrides,
  };
}

/**
 * Owner factory.
 *
 * NOTE: The live `scoring.ts` reads `owner.abnCheck.kind` (the migration target
 * called out in contract types.ts:128), but `@ratesassist/contract` still
 * declares `abnStatus?: AbnStatus`. The runtime code therefore crashes on any
 * owner whose `abnCheck` is undefined — see the discovered-bug note in the
 * test report. We populate `abnCheck` via a cast so these tests can still pin
 * the engine's behaviour given the shape the engine actually expects.
 */
type RuntimeOwner = Owner & {
  readonly abnCheck?:
    | { kind: "unchecked" }
    | { kind: "checked"; status: "Active" | "Cancelled" | "Suspended"; checkedAt: string };
};

function owner(
  overrides: Partial<RuntimeOwner> & {
    abnCheckStatus?: "Active" | "Cancelled" | "Suspended";
  } = {},
): Owner {
  const { abnCheckStatus = "Active", ...rest } = overrides;
  const base: RuntimeOwner = {
    ownerId: "O1",
    name: "Test Pty Ltd",
    abn: "32614882110",
    abnStatus: abnCheckStatus,
    abnCheck: {
      kind: "checked",
      status: abnCheckStatus,
      checkedAt: "2026-05-01",
    },
    postalAddress: "PO Box 1",
    email: null,
    phone: null,
    ownerSince: "2020-01-01",
    previousOwners: [],
    ...rest,
  };
  return base as Owner;
}

function ten(overrides: Partial<Tenement> = {}): Tenement {
  return {
    tenementId: "M-001",
    type: "M",
    status: "Live",
    holder: "Test Pty Ltd",
    holderAbn: null,
    commodity: ["iron"],
    grantedDate: "2010-01-01",
    expiryDate: "2030-01-01",
    areaHectares: 100,
    intersectsAssessmentNumbers: ["A1"],
    isProducing: true,
    lastWorkProgramYear: 2024,
    polygon: [],
    ...overrides,
  };
}

function ctxFrom(args: {
  properties: readonly Property[];
  owners: readonly Owner[];
  tenementsByAssessment?: ReadonlyMap<string, readonly Tenement[]>;
  now?: () => number;
}): EvaluationContext {
  return {
    properties: args.properties,
    ownersById: new Map(args.owners.map((o) => [o.ownerId, o])),
    tenementsByAssessment:
      args.tenementsByAssessment ?? new Map<string, readonly Tenement[]>(),
    now: args.now,
  };
}

/** Fixed clock for time-relative signal tests. */
const FIXED_NOW_MS = Date.parse("2026-05-10T00:00:00Z");
const fixedNow = (): number => FIXED_NOW_MS;

// ---- computeComposite ----

describe("computeComposite", () => {
  it("returns 0 for no hits", () => {
    expect(computeComposite([])).toBe(0);
  });

  it("returns the single hit's weight", () => {
    const sig = SIGNAL_CATALOGUE.find((s) => s.id === "id.holder_ne_owner")!;
    const hit: SignalHit = {
      id: sig.id,
      name: sig.name,
      short: sig.short,
      category: sig.category,
      weight: sig.weight,
      source: sig.source,
      evidence: "x",
    };
    expect(computeComposite([hit])).toBeCloseTo(0.30, 10);
  });

  it("caps the sum at 1.0", () => {
    // Build 6 ungrouped hits of 0.30 each = 1.80 → capped at 1.0
    const sig = SIGNAL_CATALOGUE.find(
      (s) => s.id === "id.holder_ne_owner",
    )!;
    const hits: SignalHit[] = Array.from({ length: 6 }, (_, i) => ({
      id: sig.id,
      name: sig.name,
      short: sig.short,
      category: sig.category,
      weight: sig.weight,
      source: sig.source,
      evidence: `e${i}`,
    }));
    expect(computeComposite(hits)).toBe(1);
  });

  it("exclusiveGroup: two hits in same group → only max-weight contributes", () => {
    const producing = SIGNAL_CATALOGUE.find(
      (s) => s.id === "reg.tenement.producing.on_rural_or_vacant",
    )!; // 0.55
    const exploration = SIGNAL_CATALOGUE.find(
      (s) => s.id === "reg.tenement.exploration_only.on_rural",
    )!; // 0.20
    expect(producing.exclusiveGroup).toBe(exploration.exclusiveGroup);

    const hits: SignalHit[] = [
      {
        id: producing.id,
        name: producing.name,
        short: producing.short,
        category: producing.category,
        weight: producing.weight,
        source: producing.source,
        evidence: "e1",
      },
      {
        id: exploration.id,
        name: exploration.name,
        short: exploration.short,
        category: exploration.category,
        weight: exploration.weight,
        source: exploration.source,
        evidence: "e2",
      },
    ];
    // Only the max-weight (0.55) contributes; the 0.20 is suppressed.
    expect(computeComposite(hits)).toBeCloseTo(0.55, 10);
  });
});

// ---- severityForScore boundaries ----

describe("severityForScore boundaries", () => {
  it("0.59 → medium", () => {
    expect(severityForScore(0.59)).toBe("medium");
  });
  it("0.6 → high", () => {
    expect(severityForScore(0.6)).toBe("high");
  });
  it("0.34 → low", () => {
    expect(severityForScore(0.34)).toBe("low");
  });
  it("0.35 → medium", () => {
    expect(severityForScore(0.35)).toBe("medium");
  });
  it("0 → low", () => {
    expect(severityForScore(0)).toBe("low");
  });
  it("1.0 → high", () => {
    expect(severityForScore(1.0)).toBe("high");
  });
});

// ---- estimateUplift ----

describe("estimateUplift", () => {
  it("high: 8x multiplier", () => {
    const r = estimateUplift(1_000, "high");
    expect(r.estAnnualRatesNew).toBe(8_000);
    expect(r.estUplift).toBe(7_000);
    expect(r.estArrears3y).toBe(21_000);
  });
  it("medium: 4x multiplier", () => {
    const r = estimateUplift(1_000, "medium");
    expect(r.estAnnualRatesNew).toBe(4_000);
    expect(r.estUplift).toBe(3_000);
    expect(r.estArrears3y).toBe(9_000);
  });
  it("low: 1.5x multiplier (rounded)", () => {
    const r = estimateUplift(1_000, "low");
    expect(r.estAnnualRatesNew).toBe(1_500);
    expect(r.estUplift).toBe(500);
    expect(r.estArrears3y).toBe(1_500);
  });
});

// ---- evaluateSignals ----

describe("evaluateSignals", () => {
  it("no signals fire on a clean residential property with no tenements", () => {
    const p = prop({
      assessmentNumber: "R1",
      landUse: "Residential",
      ownerIds: ["O1"],
    });
    const ctx = ctxFrom({ properties: [p], owners: [owner()] });
    expect(evaluateSignals(p, ctx)).toEqual([]);
  });

  it("fires producing-tenement signal on rural with producing M lease", () => {
    const p = prop({ landUse: "Rural" });
    const t = ten({ type: "M", isProducing: true });
    const ctx = ctxFrom({
      properties: [p],
      owners: [owner()],
      tenementsByAssessment: new Map([["A1", [t]]]),
    });
    const hits = evaluateSignals(p, ctx);
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("reg.tenement.producing.on_rural_or_vacant");
    // exclusive group: no other reg.tenement.* should fire
    const tenementClassHits = hits.filter((h) => h.id.startsWith("reg."));
    expect(tenementClassHits).toHaveLength(1);
  });

  it("exploration-only fires when only E/P tenements present (and not the others)", () => {
    const p = prop({ landUse: "Rural" });
    const t = ten({ tenementId: "E-9", type: "E", isProducing: false });
    const ctx = ctxFrom({
      properties: [p],
      owners: [owner()],
      tenementsByAssessment: new Map([["A1", [t]]]),
    });
    const ids = evaluateSignals(p, ctx).map((h) => h.id);
    expect(ids).toContain("reg.tenement.exploration_only.on_rural");
    expect(ids).not.toContain("reg.tenement.producing.on_rural_or_vacant");
    expect(ids).not.toContain("reg.tenement.live_lease.on_rural_or_vacant");
  });

  it("ABN cancelled fires id.abn.cancelled_or_suspended", () => {
    const p = prop({ landUse: "Residential" });
    const o = owner({ abnCheckStatus: "Cancelled" });
    const ctx = ctxFrom({ properties: [p], owners: [o] });
    const ids = evaluateSignals(p, ctx).map((h) => h.id);
    expect(ids).toContain("id.abn.cancelled_or_suspended");
  });

  it("holder ≠ owner fires when tenement holder differs", () => {
    const p = prop({ landUse: "Rural" });
    const o = owner({ name: "Acme Pastoral Pty Ltd" });
    const t = ten({ holder: "Pilbara Iron Holdings", isProducing: false, type: "E" });
    const ctx = ctxFrom({
      properties: [p],
      owners: [o],
      tenementsByAssessment: new Map([["A1", [t]]]),
    });
    const ids = evaluateSignals(p, ctx).map((h) => h.id);
    expect(ids).toContain("id.holder_ne_owner");
  });

  it("industry indicator fires when owner name contains 'mining' on rural", () => {
    const p = prop({ landUse: "Rural" });
    const o = owner({ name: "Pilbara Mining Pty Ltd" });
    const ctx = ctxFrom({ properties: [p], owners: [o] });
    const ids = evaluateSignals(p, ctx).map((h) => h.id);
    expect(ids).toContain("id.industry_indicator_in_owner_name");
  });

  it("portfolio-majority fires when owner holds 3+ props with ≥50% tenement coverage", () => {
    const props = [
      prop({ assessmentNumber: "A1", landUse: "Rural" }),
      prop({ assessmentNumber: "A2", landUse: "Rural" }),
      prop({ assessmentNumber: "A3", landUse: "Rural" }),
    ];
    const tenMap = new Map<string, readonly Tenement[]>([
      ["A1", [ten({ tenementId: "M1", isProducing: false, type: "E" })]],
      ["A2", [ten({ tenementId: "M2", isProducing: false, type: "E" })]],
      // A3: no tenement
    ]);
    const ctx = ctxFrom({
      properties: props,
      owners: [owner()],
      tenementsByAssessment: tenMap,
    });
    const ids = evaluateSignals(props[0]!, ctx).map((h) => h.id);
    expect(ids).toContain("beh.owner_portfolio_tenement_majority");
  });

  describe("reg.tenement.recently_granted", () => {
    function dateMinusDays(days: number): string {
      const ms = FIXED_NOW_MS - days * 24 * 60 * 60 * 1000;
      return new Date(ms).toISOString().slice(0, 10);
    }

    it("fires when grantedDate is within the 90-day window", () => {
      const p = prop({ landUse: "Rural" });
      const t = ten({
        type: "M",
        isProducing: true,
        grantedDate: dateMinusDays(30),
      });
      const ctx = ctxFrom({
        properties: [p],
        owners: [owner()],
        tenementsByAssessment: new Map([["A1", [t]]]),
        now: fixedNow,
      });
      const ids = evaluateSignals(p, ctx).map((h) => h.id);
      expect(ids).toContain("reg.tenement.recently_granted");
    });

    it("does NOT fire at 91 days (just outside window)", () => {
      const p = prop({ landUse: "Rural" });
      const t = ten({
        type: "M",
        isProducing: true,
        grantedDate: dateMinusDays(91),
      });
      const ctx = ctxFrom({
        properties: [p],
        owners: [owner()],
        tenementsByAssessment: new Map([["A1", [t]]]),
        now: fixedNow,
      });
      const ids = evaluateSignals(p, ctx).map((h) => h.id);
      expect(ids).not.toContain("reg.tenement.recently_granted");
    });

    it("has weight 0.40 and no exclusive group (stacks with class signals)", () => {
      const sig = SIGNAL_CATALOGUE.find(
        (s) => s.id === "reg.tenement.recently_granted",
      );
      expect(sig).toBeDefined();
      expect(sig!.weight).toBe(0.40);
      expect(sig!.exclusiveGroup).toBeUndefined();
    });

    it("stacks with the producing-tenement class signal — both fire and both contribute", () => {
      const p = prop({ landUse: "Rural" });
      const t = ten({
        type: "M",
        isProducing: true,
        grantedDate: dateMinusDays(10),
      });
      const ctx = ctxFrom({
        properties: [p],
        owners: [owner()],
        tenementsByAssessment: new Map([["A1", [t]]]),
        now: fixedNow,
      });
      const hits = evaluateSignals(p, ctx);
      const ids = hits.map((h) => h.id);
      expect(ids).toContain("reg.tenement.producing.on_rural_or_vacant");
      expect(ids).toContain("reg.tenement.recently_granted");
      // Composite reflects both — producing (0.55) + recent (0.40) = 0.95.
      expect(computeComposite(hits)).toBeCloseTo(0.95, 10);
    });
  });

  it("exclusive-group fires only once per property even with multiple tenements", () => {
    // A producing M lease + an exploration tenement on the same parcel.
    const p = prop({ landUse: "Rural" });
    const tenements = [
      ten({ tenementId: "M-1", type: "M", isProducing: true }),
      ten({ tenementId: "E-1", type: "E", isProducing: false }),
    ];
    const ctx = ctxFrom({
      properties: [p],
      owners: [owner()],
      tenementsByAssessment: new Map([["A1", tenements]]),
    });
    const hits = evaluateSignals(p, ctx);
    const tenementClassIds = hits
      .filter((h) => h.id.startsWith("reg."))
      .map((h) => h.id);
    expect(tenementClassIds).toEqual([
      "reg.tenement.producing.on_rural_or_vacant",
    ]);
  });
});
