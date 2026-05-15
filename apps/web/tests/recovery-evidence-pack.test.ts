/**
 * Tests for the /recovery/[assessment] page and the three NEW UI components
 * introduced by the VEN + CT + Concession feature:
 *
 *   - SignalAccordion        — collapsible per-signal card, top-3 expanded
 *   - TitleStateSection      — Section 8 (multi-PIN, encumbrances, strata)
 *   - ConcessionAuditSection — Section 9 (WC status, address comparison)
 *
 * The vitest harness here is Node-only (no DOM, no React renderer). To
 * exercise the post-split module surface without booting React, we:
 *
 *   1. Module-import each component and assert the default export is a
 *      function component (smoke checks for build-breaking signature drift).
 *   2. Source-text smoke-check the page.tsx wiring (the headline panel
 *      reads `pack.headlineSignals`, the accordion reads `defaultOpen`
 *      based on rank, the section components are mounted, etc.).
 *   3. Call the underlying engine helpers (sortSignalsByPriority,
 *      buildEvidencePack) to verify the data the components rely on
 *      ordering and tier logic.
 *
 * This mirrors the test pattern in property-map.test.ts — Playwright owns
 * full DOM rendering; vitest owns module / data / source-text guarantees.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Encumbrance,
  PensionerConcession,
  Pin,
  Property,
  SignalHit,
  TitleSourceFreshness,
} from "@ratesassist/contract";
import {
  sortSignalsByPriority,
  buildEvidencePack,
} from "@ratesassist/recovery-engine";
import type { EvaluationContext } from "@ratesassist/recovery-engine";

// ---------------------------------------------------------------------------
// Module-load smoke tests
// ---------------------------------------------------------------------------

describe("recovery UI components — module loads", () => {
  it("SignalAccordion default export is a function component", async () => {
    const mod = await import("../components/recovery/SignalAccordion");
    expect(mod.SignalAccordion).toBeDefined();
    expect(typeof mod.SignalAccordion).toBe("function");
    expect(mod.default).toBe(mod.SignalAccordion);
  });

  it("TitleStateSection default export is a function component", async () => {
    const mod = await import("../components/recovery/TitleStateSection");
    expect(mod.TitleStateSection).toBeDefined();
    expect(typeof mod.TitleStateSection).toBe("function");
    expect(mod.default).toBe(mod.TitleStateSection);
  });

  it("ConcessionAuditSection default export is a function component", async () => {
    const mod = await import("../components/recovery/ConcessionAuditSection");
    expect(mod.ConcessionAuditSection).toBeDefined();
    expect(typeof mod.ConcessionAuditSection).toBe("function");
    expect(mod.default).toBe(mod.ConcessionAuditSection);
  });
});

// ---------------------------------------------------------------------------
// Page-source smoke tests — the page must wire components + sort order
// correctly. Source-text checks are appropriate because the page is an
// async Server Component that needs a real Next runtime to render.
// ---------------------------------------------------------------------------

const PAGE_SRC = readFileSync(
  join(__dirname, "..", "app", "recovery", "[assessment]", "page.tsx"),
  "utf8",
);

describe("/recovery/[assessment] page — wiring", () => {
  it("imports all three new recovery components", () => {
    expect(PAGE_SRC).toContain('from "@/components/recovery/SignalAccordion"');
    expect(PAGE_SRC).toContain(
      'from "@/components/recovery/TitleStateSection"',
    );
    expect(PAGE_SRC).toContain(
      'from "@/components/recovery/ConcessionAuditSection"',
    );
  });

  it("renders the headline panel keyed off pack.headlineSignals", () => {
    expect(PAGE_SRC).toContain("pack.headlineSignals");
    expect(PAGE_SRC).toContain("data-testid=\"headline-panel\"");
  });

  it("renders the priority-sorted signal breakdown via pack.prioritisedSignals", () => {
    expect(PAGE_SRC).toContain("pack.prioritisedSignals");
    expect(PAGE_SRC).toContain("data-testid=\"signal-breakdown\"");
  });

  it("expands the top-3 accordions by default (defaultOpen={ix < 3})", () => {
    // The rank-based default-open rule is the locked spec. Pin it to the
    // source so refactors that lose this default surface a failure.
    expect(PAGE_SRC).toMatch(/defaultOpen=\{ix < 3\}/);
  });

  it("mounts TitleStateSection with the full property title-state props", () => {
    expect(PAGE_SRC).toContain("<TitleStateSection");
    expect(PAGE_SRC).toContain("ctVolume={pack.candidate.property.ctVolume}");
    expect(PAGE_SRC).toContain("pins={pack.candidate.property.pins ?? []}");
    expect(PAGE_SRC).toContain(
      "councilLandUse={pack.candidate.property.landUse}",
    );
  });

  it("mounts ConcessionAuditSection only when a pensionerConcession is on file", () => {
    expect(PAGE_SRC).toContain(
      "pack.candidate.property.pensionerConcession",
    );
    expect(PAGE_SRC).toContain("<ConcessionAuditSection");
  });

  it("keeps the markdown render so accessibility & download paths still work", () => {
    expect(PAGE_SRC).toContain("<Markdown>");
  });
});

// ---------------------------------------------------------------------------
// SignalAccordion — source-text contract
// ---------------------------------------------------------------------------

const ACCORDION_SRC = readFileSync(
  join(__dirname, "..", "components", "recovery", "SignalAccordion.tsx"),
  "utf8",
);

describe("SignalAccordion — accessibility + tier contract", () => {
  it("uses aria-expanded + aria-controls on the toggle button", () => {
    expect(ACCORDION_SRC).toContain("aria-expanded={open}");
    expect(ACCORDION_SRC).toContain("aria-controls={panelId}");
  });

  it("renders the panel with role='region' and an aria-labelledby ref", () => {
    expect(ACCORDION_SRC).toContain('role="region"');
    expect(ACCORDION_SRC).toContain("aria-labelledby={buttonId}");
  });

  it("tier badge styling differentiates high / mid / low weight", () => {
    // The tier function is the single source of truth for the badge style;
    // pin its threshold semantics so future weight-band changes are
    // intentional.
    expect(ACCORDION_SRC).toContain("weight >= 0.45");
    expect(ACCORDION_SRC).toContain("weight >= 0.25");
    expect(ACCORDION_SRC).toContain("bg-critical-50");
    expect(ACCORDION_SRC).toContain("bg-warn-50");
  });

  it("exposes data-signal-id for headless interaction selectors", () => {
    expect(ACCORDION_SRC).toContain("data-signal-id={signal.id}");
  });
});

// ---------------------------------------------------------------------------
// TitleStateSection — source-text contract
// ---------------------------------------------------------------------------

const TITLE_SECTION_SRC = readFileSync(
  join(__dirname, "..", "components", "recovery", "TitleStateSection.tsx"),
  "utf8",
);

describe("TitleStateSection — multi-PIN table contract", () => {
  it("renders a PIN table with the 6 documented columns", () => {
    // The JSX wraps each <th>label</th> across multiple lines; we test for
    // the label text appearing within the source rather than the exact
    // ">label<" tag pair.
    expect(TITLE_SECTION_SRC).toContain("PIN");
    expect(TITLE_SECTION_SRC).toContain("Lot / Plan");
    expect(TITLE_SECTION_SRC).toContain("Council landuse");
    expect(TITLE_SECTION_SRC).toContain("Landgate landuse");
    expect(TITLE_SECTION_SRC).toContain("Area m²");
    expect(TITLE_SECTION_SRC).toContain("Status");
    // The thead bodyless smoke check — a <table> with a <thead> is the
    // entry point clerks click on. Source must include both tags.
    expect(TITLE_SECTION_SRC).toContain("<table");
    expect(TITLE_SECTION_SRC).toContain("<thead>");
  });

  it("colour-codes PIN status: OK = green, MISMATCH = amber", () => {
    expect(TITLE_SECTION_SRC).toContain("bg-success-50 text-success-700");
    expect(TITLE_SECTION_SRC).toContain("bg-warn-50 text-warn-700");
    expect(TITLE_SECTION_SRC).toContain("OK");
    expect(TITLE_SECTION_SRC).toContain("MISMATCH");
  });

  it("emits a data-pin-status attribute per row for headless assertions", () => {
    expect(TITLE_SECTION_SRC).toContain(
      'data-pin-status={matches ? "ok" : "mismatch"}',
    );
  });

  it("renders strata children as links to /recovery/<volume>-<folio>", () => {
    expect(TITLE_SECTION_SRC).toContain("/recovery/");
    expect(TITLE_SECTION_SRC).toContain("encodeURIComponent(`${c.volume}-${c.folio}`)");
  });

  it("renders a source-freshness label even when source is undefined", () => {
    expect(TITLE_SECTION_SRC).toContain("sourceFreshnessLine");
    expect(TITLE_SECTION_SRC).toContain(
      "No source freshness on file",
    );
  });

  it("uses a labelled h2 for the section heading (aria-labelledby)", () => {
    expect(TITLE_SECTION_SRC).toContain(
      'aria-labelledby="title-state-heading"',
    );
    expect(TITLE_SECTION_SRC).toContain('id="title-state-heading"');
  });
});

// ---------------------------------------------------------------------------
// ConcessionAuditSection — source-text contract
// ---------------------------------------------------------------------------

const CONCESSION_SECTION_SRC = readFileSync(
  join(__dirname, "..", "components", "recovery", "ConcessionAuditSection.tsx"),
  "utf8",
);

describe("ConcessionAuditSection — status tier + masking", () => {
  it("renders a status badge with status-tier classes (green / amber / red)", () => {
    expect(CONCESSION_SECTION_SRC).toContain('data-testid="wc-status-badge"');
    expect(CONCESSION_SECTION_SRC).toContain("bg-success-50 text-success-700");
    expect(CONCESSION_SECTION_SRC).toContain(
      "bg-critical-50 text-critical-700",
    );
    expect(CONCESSION_SECTION_SRC).toContain("bg-warn-50 text-warn-700");
  });

  it("masks the concession card number to the last 4 digits", () => {
    expect(CONCESSION_SECTION_SRC).toContain("maskCard");
    expect(CONCESSION_SECTION_SRC).toContain("card.slice(-4)");
  });

  it("cites the WA statutory basis (Rates and Charges Act 1992)", () => {
    expect(CONCESSION_SECTION_SRC).toContain(
      "Rates and Charges (Rebates and Deferments) Act 1992",
    );
  });

  it("recommends executor engagement when status is deceased", () => {
    expect(CONCESSION_SECTION_SRC).toContain("executor");
  });

  it("renders a postal-vs-property comparison row with a match badge", () => {
    expect(CONCESSION_SECTION_SRC).toContain(
      'data-testid="address-comparison-badge"',
    );
    expect(CONCESSION_SECTION_SRC).toContain(
      'data-address-match={addressMatches ? "yes" : "no"}',
    );
  });
});

// ---------------------------------------------------------------------------
// Engine-level: priority sort + pack rendering used by the page
// ---------------------------------------------------------------------------

describe("sortSignalsByPriority — surfaces the right top-3", () => {
  it("places the 3 highest-weight signals first; ties broken alphabetically", () => {
    const hits: SignalHit[] = [
      mkHit("z-low", 0.10),
      mkHit("a-highest", 0.55),
      mkHit("c-mid", 0.40),
      mkHit("b-mid", 0.40),
      mkHit("d-second", 0.50),
    ];
    const sorted = sortSignalsByPriority(hits);
    expect(sorted[0]!.id).toBe("a-highest");
    expect(sorted[1]!.id).toBe("d-second");
    // 0.40 tie between b-mid and c-mid → b-mid first (alphabetic).
    expect(sorted[2]!.id).toBe("b-mid");
    expect(sorted[3]!.id).toBe("c-mid");
    expect(sorted[4]!.id).toBe("z-low");
  });
});

describe("buildEvidencePack → pack headlineSignals drives the panel", () => {
  it("returns the top-3 by weight as headlineSignals", () => {
    const ctx = makeMultiSignalCtx();
    const r = buildEvidencePack("A-MULTI", ctx, {
      now: () => new Date("2026-05-15T00:00:00Z"),
    });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.pack.headlineSignals.length).toBe(3);
    // Each weight in the headline is >= the next; >= the highest of the
    // remaining signals.
    const headlineMin = r.pack.headlineSignals[2]!.weight;
    const restMax = Math.max(
      0,
      ...r.pack.prioritisedSignals.slice(3).map((s) => s.weight),
    );
    expect(headlineMin).toBeGreaterThanOrEqual(restMax);
  });

  it("Section 8 (Title state) and Section 9 (Concession audit) appear in markdown when data present", () => {
    const ctx = makeMultiSignalCtx();
    const r = buildEvidencePack("A-MULTI", ctx, {
      now: () => new Date("2026-05-15T00:00:00Z"),
    });
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.pack.markdown).toContain("## 8. Title state");
    expect(r.pack.markdown).toContain("## 9. Concession audit");
  });
});

// ---------------------------------------------------------------------------
// Fixtures
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

function makeMultiSignalCtx(): EvaluationContext {
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
  ];

  const encumbrances: Encumbrance[] = [
    {
      type: "mortgage",
      reference: "M-12345",
      date: "2022-08-14",
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
    wcCancellationReason: "Customer requested cancellation",
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

  return {
    properties: [property],
    ownersById: new Map([
      [
        "O-MULTI",
        {
          ownerId: "O-MULTI",
          name: "Pilbara Iron Holdings Pty Ltd",
          abn: "32614882110",
          abnCheck: {
            kind: "checked",
            status: "Cancelled",
            checkedAt: "2026-05-01",
          },
          postalAddress: "PO Box 99",
          email: null,
          phone: null,
          ownerSince: "2020-01-01",
          previousOwners: [],
        },
      ],
    ]),
    tenementsByAssessment: new Map([
      [
        "A-MULTI",
        [
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
            intersectsAssessmentNumbers: ["A-MULTI"],
            isProducing: true,
            lastWorkProgramYear: 2024,
            polygon: [],
          },
        ],
      ],
    ]),
    lagCandidatesByAssessment: new Map([
      [
        "A-MULTI",
        [
          {
            severityHint: "high",
            reasoning: "DMIRS ahead of Landgate cadastre.",
          },
        ],
      ],
    ]),
    changeDetectionByAssessment: new Map([
      [
        "A-MULTI",
        [
          {
            kind: "construction_approved",
            detectedAt: "2025-09-01",
            reasoning: "DA-2025-114 approved.",
          },
        ],
      ],
    ]),
  };
}
