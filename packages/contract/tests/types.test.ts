/**
 * Compile-time type-shape sanity tests for the VEN + CT + Concession types.
 *
 * These tests only assert that realistic example objects satisfy the new
 * types (and that the existing Property type still accepts records that
 * omit every new field). If this file compiles, the type shapes are sound.
 *
 * No runtime behaviour is being exercised here — the actual schemas are
 * covered by `schemas.test.ts`. We keep one trivial expect() per test so
 * vitest counts the cases.
 */

import { describe, it, expect } from "vitest";
import type {
  Pin,
  Encumbrance,
  EncumbranceType,
  PensionerConcession,
  PensionerConcessionType,
  WaterCorpEligibilityStatus,
  TitleSourceFreshness,
  TitleSourceTier,
  StrataChild,
  Property,
  GeoJsonGeometry,
} from "../src/types.js";

describe("VEN + CT + Concession types — shape sanity", () => {
  it("Pin: minimal + extended forms compile", () => {
    const minimal: Pin = {
      pin: "1234567",
      lotPlan: "Lot 42 DP 18337",
      landuseCode: "Rural",
      areaSquareMetres: 8500,
    };
    const geom: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [[[115, -32], [115.1, -32], [115.1, -32.1], [115, -32]]],
    };
    const extended: Pin = {
      pin: "1234568",
      lotPlan: "Lot 43 DP 18337",
      landuseCode: "Industrial",
      areaSquareMetres: 4200,
      geometry: geom,
      councilCode: "TPS",
    };
    expect([minimal.pin, extended.pin]).toEqual(["1234567", "1234568"]);
  });

  it("Encumbrance: every EncumbranceType value is a legal record", () => {
    const types: ReadonlyArray<EncumbranceType> = [
      "mortgage",
      "easement",
      "caveat",
      "tenement_notation",
      "covenant",
      "other",
    ];
    const rows: ReadonlyArray<Encumbrance> = types.map((t) => ({
      type: t,
      reference: `REF-${t}`,
      date: "2024-01-01",
      source: "landgate_restricted",
    }));
    expect(rows.length).toBe(6);
  });

  it("PensionerConcession: all concession types + WC status values are legal", () => {
    const cTypes: ReadonlyArray<PensionerConcessionType> = [
      "pensioner",
      "first_home",
      "senior",
      "veteran",
    ];
    const wcStatuses: ReadonlyArray<WaterCorpEligibilityStatus> = [
      "active",
      "cancelled",
      "expired",
      "deceased",
      "unknown",
    ];
    const c: PensionerConcession = {
      applied: true,
      type: cTypes[0]!,
      appliedAt: "2020-07-01",
      wcEligibilityStatus: wcStatuses[1]!,
    };
    expect(c.applied).toBe(true);
  });

  it("TitleSourceFreshness: every tier is a legal record", () => {
    const tiers: ReadonlyArray<TitleSourceTier> = [
      "wc_feed",
      "landgate_restricted",
      "slip",
      "council_uploaded_pdf",
      "map_viewer_plus",
    ];
    const rows: ReadonlyArray<TitleSourceFreshness> = tiers.map((t) => ({
      source: t,
      retrievedAt: "2026-05-15T12:00:00Z",
    }));
    expect(rows.map((r) => r.source)).toEqual(tiers);
  });

  it("StrataChild: 2-field shape", () => {
    const c: StrataChild = { volume: "LR3124", folio: "001" };
    expect(c.folio).toBe("001");
  });

  it("Property: legacy record (no new fields) still satisfies the type", () => {
    // This locks in the optionality of every new field. If any of them
    // becomes required by accident, this test stops compiling.
    const legacy: Property = {
      assessmentNumber: "TPS-9001-01",
      council: "TPS",
      address: "12 Hamersley Drive",
      suburb: "Tom Price",
      postcode: "6751",
      state: "WA",
      landUse: "Residential",
      valuation: 420000,
      annualRates: 2100,
      balance: 0,
      lastPaymentDate: null,
      lastPaymentAmount: null,
      paymentMethod: null,
      pensionerRebate: false,
      paymentArrangement: false,
      ownerIds: [],
      notes: [],
      lat: -22.69,
      lng: 117.79,
    };
    expect(legacy.assessmentNumber).toBe("TPS-9001-01");
  });

  it("Property: extended record with every new field compiles", () => {
    const extended: Property = {
      assessmentNumber: "TPS-9001-01",
      council: "TPS",
      address: "12 Hamersley Drive",
      suburb: "Tom Price",
      postcode: "6751",
      state: "WA",
      landUse: "Rural",
      valuation: 420000,
      annualRates: 2100,
      balance: 0,
      lastPaymentDate: null,
      lastPaymentAmount: null,
      paymentMethod: null,
      pensionerRebate: false,
      paymentArrangement: false,
      ownerIds: [],
      notes: [],
      lat: -22.69,
      lng: 117.79,
      ven: "VEN-001",
      pins: [
        {
          pin: "1234567",
          lotPlan: "Lot 42 DP 18337",
          landuseCode: "Rural",
          areaSquareMetres: 8500,
        },
      ],
      ctVolume: "LR3123",
      ctFolio: "456",
      ctIssuedDate: "2019-04-12",
      proprietorOnTitle: "Carter Holdings Pty Ltd",
      proprietorPostalAddress: "PO Box 12, Perth WA 6000",
      strataParentCt: { volume: "LR3120", folio: "001" },
      strataChildren: [{ volume: "LR3124", folio: "001" }],
      encumbrances: [
        {
          type: "mortgage",
          reference: "M-2024-001",
          date: "2024-01-01",
          source: "landgate_restricted",
        },
      ],
      pensionerConcession: {
        applied: true,
        type: "pensioner",
        appliedAt: "2020-07-01",
        wcEligibilityStatus: "active",
      },
      titleSource: {
        source: "landgate_restricted",
        retrievedAt: "2026-05-15T03:00:00Z",
      },
    };
    expect(extended.pins?.length).toBe(1);
    expect(extended.encumbrances?.[0]?.type).toBe("mortgage");
  });
});
