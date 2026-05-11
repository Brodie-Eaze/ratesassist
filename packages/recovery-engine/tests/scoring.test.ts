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
import { findMismatches } from "../src/findMismatches.js";
import { SIGNAL_BY_ID, SIGNAL_CATALOGUE, getSignal } from "../src/signals.js";

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

// ---- HEADLINE: DMIRS ahead of Landgate ----

describe("reg.dmirs_ahead_of_landgate", () => {
  it("does not fire when lagCandidatesByAssessment is absent", () => {
    const p = prop({ assessmentNumber: "A1" });
    const ctx = ctxFrom({ properties: [p], owners: [owner()] });
    const hits = evaluateSignals(p, ctx);
    expect(hits.find((h) => h.id === "reg.dmirs_ahead_of_landgate")).toBeUndefined();
  });

  it("does not fire when the lag map has no entry for the assessment", () => {
    const p = prop({ assessmentNumber: "A1" });
    const ctx: EvaluationContext = {
      ...ctxFrom({ properties: [p], owners: [owner()] }),
      lagCandidatesByAssessment: new Map([
        ["OTHER", [{ severityHint: "high", reasoning: "irrelevant" }]],
      ]),
    };
    const hits = evaluateSignals(p, ctx);
    expect(hits.find((h) => h.id === "reg.dmirs_ahead_of_landgate")).toBeUndefined();
  });

  it("does not fire when only a low-severity lag candidate is present", () => {
    const p = prop({ assessmentNumber: "A1" });
    const ctx: EvaluationContext = {
      ...ctxFrom({ properties: [p], owners: [owner()] }),
      lagCandidatesByAssessment: new Map([
        ["A1", [{ severityHint: "low", reasoning: "skip me" }]],
      ]),
    };
    const hits = evaluateSignals(p, ctx);
    expect(hits.find((h) => h.id === "reg.dmirs_ahead_of_landgate")).toBeUndefined();
  });

  it("fires with the reasoning string when a medium/high candidate is mapped", () => {
    const p = prop({ assessmentNumber: "A1" });
    const ctx: EvaluationContext = {
      ...ctxFrom({ properties: [p], owners: [owner()] }),
      lagCandidatesByAssessment: new Map([
        [
          "A1",
          [
            {
              severityHint: "high",
              reasoning:
                "Tenement M 47/1569 (Mining Lease) granted 2026-04-20 intersects parcel classified as \"Livestock grazing\". Cadastre lag: 20 days. Reclassification window open.",
            },
          ],
        ],
      ]),
    };
    const hits = evaluateSignals(p, ctx);
    const lag = hits.find((h) => h.id === "reg.dmirs_ahead_of_landgate");
    expect(lag).toBeDefined();
    expect(lag!.weight).toBeCloseTo(0.5, 10);
    expect(lag!.evidence).toContain("Cadastre lag: 20 days");
  });

  it("stacks additively with recently_granted (no exclusive group)", () => {
    // M-class lease producing + rural, plus a recent grantedDate and a
    // matching lag candidate — the producing + recently-granted + lag signals
    // all fire and the composite stays capped at 1.0.
    const p = prop({ assessmentNumber: "A1", landUse: "Rural" });
    const t = ten({
      tenementId: "M-1",
      type: "M",
      isProducing: true,
      // Granted 30 days before fixed clock → fires recently_granted.
      grantedDate: new Date(FIXED_NOW_MS - 30 * 86400_000).toISOString(),
    });
    const ctx: EvaluationContext = {
      ...ctxFrom({
        properties: [p],
        owners: [owner()],
        tenementsByAssessment: new Map([["A1", [t]]]),
        now: fixedNow,
      }),
      lagCandidatesByAssessment: new Map([
        [
          "A1",
          [
            {
              severityHint: "high",
              reasoning: "cadastre-lag evidence string for test",
            },
          ],
        ],
      ]),
    };
    const hitIds = evaluateSignals(p, ctx).map((h) => h.id);
    expect(hitIds).toContain("reg.tenement.producing.on_rural_or_vacant");
    expect(hitIds).toContain("reg.tenement.recently_granted");
    expect(hitIds).toContain("reg.dmirs_ahead_of_landgate");
  });
});

// ---- PERF-004: O(1) signal lookup ----

describe("SIGNAL_BY_ID index", () => {
  it("contains every catalogue entry keyed by id", () => {
    expect(SIGNAL_BY_ID.size).toBe(SIGNAL_CATALOGUE.length);
    for (const sig of SIGNAL_CATALOGUE) {
      expect(SIGNAL_BY_ID.get(sig.id)).toBe(sig);
    }
  });

  it("getSignal() resolves through the Map (O(1))", () => {
    const expected = SIGNAL_CATALOGUE[0]!;
    expect(getSignal(expected.id)).toBe(expected);
    expect(getSignal("nope.does.not.exist")).toBeUndefined();
  });
});

// ---- PERF-002 / PERF-003: index correctness via context indexes ----

describe("EvaluationContext indexes (PERF-002 / PERF-003)", () => {
  it("propertiesByOwnerId yields the same portfolio behaviour as the linear scan", () => {
    const props = [
      prop({ assessmentNumber: "A1", landUse: "Rural", ownerIds: ["O1"] }),
      prop({ assessmentNumber: "A2", landUse: "Rural", ownerIds: ["O1"] }),
      prop({ assessmentNumber: "A3", landUse: "Rural", ownerIds: ["O1"] }),
      prop({ assessmentNumber: "A4", landUse: "Rural", ownerIds: ["O2"] }),
    ];
    const tenMap = new Map<string, readonly Tenement[]>([
      ["A1", [ten({ tenementId: "M1", isProducing: false, type: "E" })]],
      ["A2", [ten({ tenementId: "M2", isProducing: false, type: "E" })]],
    ]);
    const owners = [owner({ ownerId: "O1" }), owner({ ownerId: "O2", name: "Other" })];

    const linear = ctxFrom({ properties: props, owners, tenementsByAssessment: tenMap });
    const indexed: EvaluationContext = {
      ...linear,
      propertiesByOwnerId: new Map([
        ["O1", props.filter((p) => p.ownerIds.includes("O1"))],
        ["O2", props.filter((p) => p.ownerIds.includes("O2"))],
      ]),
    };

    const linearIds = evaluateSignals(props[0]!, linear).map((h) => h.id);
    const indexedIds = evaluateSignals(props[0]!, indexed).map((h) => h.id);
    expect(indexedIds).toEqual(linearIds);
    expect(indexedIds).toContain("beh.owner_portfolio_tenement_majority");
  });

  it("ruralBySuburb yields the same percentile-outlier behaviour as the linear scan", () => {
    const target = prop({
      assessmentNumber: "T1",
      suburb: "Karratha",
      landUse: "Rural",
      valuation: 5_000_000,
    });
    const peers: Property[] = Array.from({ length: 20 }, (_, i) =>
      prop({
        assessmentNumber: `P${i}`,
        suburb: "Karratha",
        landUse: "Rural",
        valuation: 100_000 + i * 1_000,
        ownerIds: [`Other${i}`],
      }),
    );
    const props = [target, ...peers];
    const linear = ctxFrom({ properties: props, owners: [owner()] });
    const indexed: EvaluationContext = {
      ...linear,
      ruralBySuburb: new Map([
        ["Karratha", props.filter((p) => p.landUse === "Rural")],
      ]),
    };

    const linearIds = evaluateSignals(target, linear).map((h) => h.id);
    const indexedIds = evaluateSignals(target, indexed).map((h) => h.id);
    expect(indexedIds).toEqual(linearIds);
    expect(indexedIds).toContain("spat.outlier.high_value_rural");
  });
});

// ---- Sanity perf ceiling: 5000-property sweep ----

describe("findMismatches perf-ceiling", () => {
  it("completes a 5000-property sweep within 2s with indexes wired", () => {
    const N = 5000;
    const SUBURBS = 20;
    const OWNERS_N = 250;
    const properties: Property[] = [];
    for (let i = 0; i < N; i++) {
      const ownerId = `O${i % OWNERS_N}`;
      const suburb = `S${i % SUBURBS}`;
      const isRural = i % 3 === 0;
      properties.push(
        prop({
          assessmentNumber: `A${i}`,
          suburb,
          landUse: isRural ? "Rural" : "Residential",
          valuation: 100_000 + (i % 50) * 5_000,
          ownerIds: [ownerId],
        }),
      );
    }
    const owners: Owner[] = Array.from({ length: OWNERS_N }, (_, i) =>
      owner({ ownerId: `O${i}`, name: `Holder ${i} Pty Ltd` }),
    );

    // Tenements on every 7th rural property — enough to drive owner
    // portfolio + outlier signals.
    const tenMap = new Map<string, readonly Tenement[]>();
    for (let i = 0; i < properties.length; i += 7) {
      const p = properties[i]!;
      if (p.landUse === "Rural") {
        tenMap.set(p.assessmentNumber, [
          ten({
            tenementId: `M-${i}`,
            type: "M",
            isProducing: i % 14 === 0,
          }),
        ]);
      }
    }

    const propertiesByOwnerId = new Map<string, Property[]>();
    const ruralBySuburb = new Map<string, Property[]>();
    for (const p of properties) {
      for (const oid of p.ownerIds) {
        const b = propertiesByOwnerId.get(oid);
        if (b) b.push(p);
        else propertiesByOwnerId.set(oid, [p]);
      }
      if (p.landUse === "Rural") {
        const b = ruralBySuburb.get(p.suburb);
        if (b) b.push(p);
        else ruralBySuburb.set(p.suburb, [p]);
      }
    }

    const ctx: EvaluationContext = {
      properties,
      ownersById: new Map(owners.map((o) => [o.ownerId, o])),
      tenementsByAssessment: tenMap,
      propertiesByOwnerId,
      ruralBySuburb,
    };

    const t0 = Date.now();
    const out = findMismatches(ctx);
    const elapsed = Date.now() - t0;

    expect(out.length).toBeGreaterThan(0);
    // Sanity ceiling, not a real benchmark.
    expect(elapsed).toBeLessThan(2_000);
  });
});
