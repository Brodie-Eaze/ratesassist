/**
 * Characterization tests for @ratesassist/contract.
 *
 * Pin the wire shapes that adapters must produce and consumers must accept.
 * Any drift in these tests is a contract change — handle as semver.
 */

import { describe, it, expect } from "vitest";
import {
  inputs,
  toolResult,
  adapterIdentity,
  pinSchema,
  encumbranceSchema,
  pensionerConcessionSchema,
  titleSourceFreshnessSchema,
  strataChildSchema,
  geoJsonGeometry,
} from "../src/schemas.js";

describe("inputs schemas — round-trip", () => {
  it("search_property: valid query parses, empty rejected", () => {
    expect(inputs.search_property.parse({ query: "Pilbara" })).toEqual({
      query: "Pilbara",
    });
    const bad = inputs.search_property.safeParse({ query: "" });
    expect(bad.success).toBe(false);
  });

  it("get_property_detail: alphanumeric+dash assessment numbers, rejects symbols", () => {
    expect(
      inputs.get_property_detail.parse({ assessmentNumber: "A123-456" }),
    ).toEqual({ assessmentNumber: "A123-456" });
    expect(
      inputs.get_property_detail.safeParse({ assessmentNumber: "BAD!" })
        .success,
    ).toBe(false);
  });

  it("list_overdue: optional council + minDaysOverdue with bounds", () => {
    expect(inputs.list_overdue.parse({})).toEqual({});
    expect(
      inputs.list_overdue.parse({ council: "TPS", minDaysOverdue: 30 }),
    ).toEqual({ council: "TPS", minDaysOverdue: 30 });
    // out-of-bounds
    expect(
      inputs.list_overdue.safeParse({ minDaysOverdue: -1 }).success,
    ).toBe(false);
    expect(
      inputs.list_overdue.safeParse({ minDaysOverdue: 9999 }).success,
    ).toBe(false);
  });

  it("list_councils: strict empty object rejects extra keys", () => {
    expect(inputs.list_councils.parse({})).toEqual({});
    expect(
      inputs.list_councils.safeParse({ extra: 1 }).success,
    ).toBe(false);
  });

  it("draft_payment_reminder: tone defaults to friendly", () => {
    const parsed = inputs.draft_payment_reminder.parse({
      assessmentNumber: "A123",
    });
    expect(parsed.tone).toBe("friendly");
  });

  it("update_owner_contact: requires phone or email; confirm defaults false", () => {
    const empty = inputs.update_owner_contact.safeParse({ ownerId: "O1" });
    expect(empty.success).toBe(false);

    const ok = inputs.update_owner_contact.parse({
      ownerId: "O1",
      newPhone: "0400000000",
    });
    expect(ok.confirm).toBe(false);
  });

  it("update_owner_contact: rejects malformed email", () => {
    const bad = inputs.update_owner_contact.safeParse({
      ownerId: "O1",
      newEmail: "not-an-email",
    });
    expect(bad.success).toBe(false);
  });

  it("verify_abn: 11-digit ABN with optional spaces accepted; short rejected", () => {
    expect(inputs.verify_abn.parse({ abn: "32614882110" }).abn).toBe(
      "32614882110",
    );
    expect(
      inputs.verify_abn.parse({ abn: "32 614 882 110" }).abn,
    ).toBe("32 614 882 110");
    expect(inputs.verify_abn.safeParse({ abn: "12345" }).success).toBe(false);
  });

  it("find_mining_mismatches: minSeverity must be high|medium|low", () => {
    expect(
      inputs.find_mining_mismatches.parse({ minSeverity: "high" }).minSeverity,
    ).toBe("high");
    expect(
      inputs.find_mining_mismatches.safeParse({ minSeverity: "critical" })
        .success,
    ).toBe(false);
  });

  it("generate_statutory_certificate: requires email; certificateType length-bounded", () => {
    expect(
      inputs.generate_statutory_certificate.parse({
        assessmentNumber: "A123",
        certificateType: "WA-6.76",
        requesterName: "Jo",
        requesterEmail: "jo@example.com",
      }).certificateType,
    ).toBe("WA-6.76");
    expect(
      inputs.generate_statutory_certificate.safeParse({
        assessmentNumber: "A123",
        certificateType: "X",
        requesterName: "Jo",
        requesterEmail: "jo@example.com",
      }).success,
    ).toBe(false);
  });
});

describe("toolResult discriminated union", () => {
  it("ok=true variant: applies mutated default false", () => {
    const r = toolResult.parse({ ok: true, output: "hello" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toBe("hello");
      expect(r.mutated).toBe(false);
    }
  });

  it("ok=true with commitToken + data passes through", () => {
    const r = toolResult.parse({
      ok: true,
      output: "preview",
      data: { foo: 1 },
      commitToken: "tok-1",
      mutated: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.commitToken).toBe("tok-1");
  });

  const errorCodes = [
    "not_found",
    "invalid_input",
    "unauthorized",
    "forbidden",
    "conflict",
    "commit_token_invalid",
    "commit_token_expired",
    "rate_limited",
    "upstream_error",
    "timeout",
    "internal_error",
  ] as const;

  for (const code of errorCodes) {
    it(`ok=false code=${code} round-trips`, () => {
      const r = toolResult.parse({ ok: false, error: "x", code });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe(code);
        expect(r.retryable).toBe(false); // default
      }
    });
  }

  it("rejects unknown error code", () => {
    const bad = toolResult.safeParse({
      ok: false,
      error: "x",
      code: "wat",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects ok=true with no output", () => {
    expect(toolResult.safeParse({ ok: true }).success).toBe(false);
  });
});

describe("adapterIdentity schema", () => {
  it("parses a valid identity", () => {
    const id = adapterIdentity.parse({
      id: "demo",
      name: "Demo Adapter",
      vendor: "RatesAssist",
      version: "0.2.0",
      contractVersion: "0.2.0",
      capabilities: ["read.property", "write.add_property_note"],
    });
    expect(id.id).toBe("demo");
  });

  it("rejects non-semver versions", () => {
    expect(
      adapterIdentity.safeParse({
        id: "demo",
        name: "Demo",
        vendor: "RA",
        version: "alpha",
        contractVersion: "0.2.0",
        capabilities: [],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown capability strings", () => {
    expect(
      adapterIdentity.safeParse({
        id: "demo",
        name: "Demo",
        vendor: "RA",
        version: "0.2.0",
        contractVersion: "0.2.0",
        capabilities: ["read.everything"],
      }).success,
    ).toBe(false);
  });
});

// ===== VEN + CT + Concession primitives =====

describe("cadastre primitives — type schemas", () => {
  it("pinSchema: parses a minimal valid PIN", () => {
    const p = pinSchema.parse({
      pin: "1234567",
      lotPlan: "Lot 42 DP 18337",
      landuseCode: "Rural",
      areaSquareMetres: 8500,
    });
    expect(p.pin).toBe("1234567");
    expect(p.areaSquareMetres).toBe(8500);
  });

  it("pinSchema: parses a PIN with geometry + councilCode", () => {
    const p = pinSchema.parse({
      pin: "1234568",
      lotPlan: "Lot 43 DP 18337",
      landuseCode: "Industrial",
      areaSquareMetres: 4200,
      geometry: {
        type: "Polygon",
        coordinates: [[[115.0, -32.0], [115.1, -32.0], [115.1, -32.1], [115.0, -32.0]]],
      },
      councilCode: "TPS",
    });
    expect(p.geometry?.type).toBe("Polygon");
    expect(p.councilCode).toBe("TPS");
  });

  it("pinSchema: rejects negative area and unknown fields", () => {
    expect(
      pinSchema.safeParse({
        pin: "1234567",
        lotPlan: "Lot 42 DP 18337",
        landuseCode: "Rural",
        areaSquareMetres: -1,
      }).success,
    ).toBe(false);
    expect(
      pinSchema.safeParse({
        pin: "1234567",
        lotPlan: "Lot 42 DP 18337",
        landuseCode: "Rural",
        areaSquareMetres: 100,
        rogueField: "x",
      }).success,
    ).toBe(false);
  });

  it("geoJsonGeometry: accepts Point, Polygon, MultiPolygon; rejects unknown type", () => {
    expect(geoJsonGeometry.parse({ type: "Point", coordinates: [115, -32] }).type).toBe("Point");
    expect(
      geoJsonGeometry.parse({
        type: "MultiPolygon",
        coordinates: [[[[115, -32], [115.1, -32], [115.1, -32.1], [115, -32]]]],
      }).type,
    ).toBe("MultiPolygon");
    expect(
      geoJsonGeometry.safeParse({ type: "LineString", coordinates: [] }).success,
    ).toBe(false);
  });

  it("encumbranceSchema: parses all encumbrance types; rejects unknown type", () => {
    for (const t of ["mortgage", "easement", "caveat", "tenement_notation", "covenant", "other"] as const) {
      const e = encumbranceSchema.parse({
        type: t,
        reference: "REF-001",
        date: "2024-01-01",
        source: "landgate_restricted",
      });
      expect(e.type).toBe(t);
    }
    expect(
      encumbranceSchema.safeParse({
        type: "lien",
        reference: "REF-001",
        date: "2024-01-01",
        source: "landgate_restricted",
      }).success,
    ).toBe(false);
  });

  it("pensionerConcessionSchema: round-trip with full Water Corp reconciliation", () => {
    const c = pensionerConcessionSchema.parse({
      applied: true,
      type: "pensioner",
      appliedAt: "2020-07-01",
      cardNumber: "XXXX-XXXX-1234",
      cardExpiry: "2027-12-31",
      wcEligibilityVerifiedAt: "2026-05-01T00:00:00Z",
      wcEligibilityStatus: "cancelled",
      wcCancellationReason: "Deceased",
      wcCancellationDate: "2026-03-15",
    });
    expect(c.applied).toBe(true);
    expect(c.wcEligibilityStatus).toBe("cancelled");
  });

  it("pensionerConcessionSchema: rejects unknown concession type + bad ISO timestamp", () => {
    expect(
      pensionerConcessionSchema.safeParse({
        applied: true,
        type: "carer",
        appliedAt: "2020-07-01",
      }).success,
    ).toBe(false);
    expect(
      pensionerConcessionSchema.safeParse({
        applied: true,
        type: "pensioner",
        appliedAt: "2020-07-01",
        wcEligibilityVerifiedAt: "not-an-iso",
      }).success,
    ).toBe(false);
  });

  it("titleSourceFreshnessSchema: every tier round-trips; ISO timestamp required", () => {
    for (const tier of [
      "wc_feed",
      "landgate_restricted",
      "slip",
      "council_uploaded_pdf",
      "map_viewer_plus",
    ] as const) {
      const t = titleSourceFreshnessSchema.parse({
        source: tier,
        retrievedAt: "2026-05-15T12:00:00Z",
      });
      expect(t.source).toBe(tier);
    }
    expect(
      titleSourceFreshnessSchema.safeParse({
        source: "council_uploaded_pdf",
        retrievedAt: "yesterday",
      }).success,
    ).toBe(false);
  });

  it("strataChildSchema: requires both volume and folio", () => {
    expect(strataChildSchema.parse({ volume: "1234", folio: "567" }).volume).toBe("1234");
    expect(strataChildSchema.safeParse({ volume: "1234" }).success).toBe(false);
  });
});

// ===== VEN + CT + Concession tool input schemas =====

describe("import_rate_schedule — round-trip", () => {
  const validCsv = "rate_code,applies_to_landuse,rate_in_dollar,minimum_payment,basis\n" +
    "RES-A,Residential,0.107,1100,GRV\nRES-B,Residential,0.110,1150,GRV";

  it("preview path (confirm: false default) parses with required fields", () => {
    const r = inputs.import_rate_schedule.parse({
      councilCode: "TPS",
      financialYear: "2025-26",
      csvText: validCsv,
    });
    expect(r.confirm).toBe(false);
    expect(r.mergeStrategy).toBe("upsert");
    expect(r.commitToken).toBeUndefined();
  });

  it("commit path (confirm: true + UUID token) parses", () => {
    const r = inputs.import_rate_schedule.parse({
      councilCode: "TPS",
      financialYear: "2025-26",
      csvText: validCsv,
      mergeStrategy: "replace",
      confirm: true,
      commitToken: "00000000-0000-0000-0000-000000000001",
    });
    expect(r.confirm).toBe(true);
    expect(r.mergeStrategy).toBe("replace");
  });

  it("rejects malformed financialYear, missing csvText, oversize csvText, non-UUID token, unknown field", () => {
    expect(
      inputs.import_rate_schedule.safeParse({
        councilCode: "TPS",
        financialYear: "2025",
        csvText: validCsv,
      }).success,
    ).toBe(false);
    expect(
      inputs.import_rate_schedule.safeParse({
        councilCode: "TPS",
        financialYear: "2025-26",
      }).success,
    ).toBe(false);
    expect(
      inputs.import_rate_schedule.safeParse({
        councilCode: "TPS",
        financialYear: "2025-26",
        csvText: "x",
      }).success,
    ).toBe(false);
    expect(
      inputs.import_rate_schedule.safeParse({
        councilCode: "TPS",
        financialYear: "2025-26",
        csvText: validCsv,
        commitToken: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      inputs.import_rate_schedule.safeParse({
        councilCode: "TPS",
        financialYear: "2025-26",
        csvText: validCsv,
        rogueField: 1,
      }).success,
    ).toBe(false);
  });
});

describe("import_landgate_title_data — round-trip", () => {
  const csv = "assessment_number,ct_volume,ct_folio,proprietor_name,pin,lot_plan,landuse_code,area_sqm\n" +
    "TPS-9001-01,LR3123,456,Carter Holdings,1234567,Lot 42 DP 18337,Rural,8500";

  it("preview path defaults sourceTier to council_uploaded_pdf and confirm to false", () => {
    const r = inputs.import_landgate_title_data.parse({
      councilCode: "TPS",
      csvText: csv,
    });
    expect(r.sourceTier).toBe("council_uploaded_pdf");
    expect(r.confirm).toBe(false);
  });

  it("commit path with explicit sourceTier + retrievedAt + commitToken", () => {
    const r = inputs.import_landgate_title_data.parse({
      councilCode: "TPS",
      csvText: csv,
      sourceTier: "landgate_restricted",
      retrievedAt: "2026-05-15T03:00:00Z",
      confirm: true,
      commitToken: "11111111-1111-1111-1111-111111111111",
    });
    expect(r.sourceTier).toBe("landgate_restricted");
    expect(r.confirm).toBe(true);
  });

  it("rejects map_viewer_plus tier, malformed retrievedAt, oversize CSV", () => {
    expect(
      inputs.import_landgate_title_data.safeParse({
        councilCode: "TPS",
        csvText: csv,
        sourceTier: "map_viewer_plus",
      }).success,
    ).toBe(false);
    expect(
      inputs.import_landgate_title_data.safeParse({
        councilCode: "TPS",
        csvText: csv,
        retrievedAt: "yesterday",
      }).success,
    ).toBe(false);
    expect(
      inputs.import_landgate_title_data.safeParse({
        councilCode: "TPS",
        csvText: "x".repeat(10_000_001),
      }).success,
    ).toBe(false);
  });
});

describe("import_wc_eligibility — round-trip", () => {
  const csv = "customer_id,card_number,holder_name,eligibility_status,valid_from\n" +
    "WC-001,PCC-XXXX-1234,Jane Smith,active,2020-07-01";

  it("preview path parses with minimal fields", () => {
    const r = inputs.import_wc_eligibility.parse({
      councilCode: "TPS",
      csvText: csv,
    });
    expect(r.confirm).toBe(false);
    expect(r.retrievedAt).toBeUndefined();
  });

  it("commit path with retrievedAt + commitToken", () => {
    const r = inputs.import_wc_eligibility.parse({
      councilCode: "TPS",
      csvText: csv,
      retrievedAt: "2026-05-15T03:00:00Z",
      confirm: true,
      commitToken: "22222222-2222-2222-2222-222222222222",
    });
    expect(r.confirm).toBe(true);
    expect(r.retrievedAt).toBe("2026-05-15T03:00:00Z");
  });

  it("rejects malformed councilCode (lowercase), too-short csvText, unknown field", () => {
    expect(
      inputs.import_wc_eligibility.safeParse({
        councilCode: "tps",
        csvText: csv,
      }).success,
    ).toBe(false);
    expect(
      inputs.import_wc_eligibility.safeParse({
        councilCode: "TPS",
        csvText: "tiny",
      }).success,
    ).toBe(false);
    expect(
      inputs.import_wc_eligibility.safeParse({
        councilCode: "TPS",
        csvText: csv,
        rogueField: true,
      }).success,
    ).toBe(false);
  });
});

describe("request_strata_conversion — round-trip", () => {
  it("preview path with toState only", () => {
    const r = inputs.request_strata_conversion.parse({
      parentAssessmentNumber: "TPS-9001-01",
      toState: "strata_plan_uploaded",
    });
    expect(r.confirm).toBe(false);
    expect(r.childCts).toBeUndefined();
  });

  it("commit path with childCts + reason + token", () => {
    const r = inputs.request_strata_conversion.parse({
      parentAssessmentNumber: "TPS-9001-01",
      toState: "children_previewed",
      childCts: [
        { volume: "LR3124", folio: "001", ven: "VEN-001", address: "Unit 1 / 12 X St" },
        { volume: "LR3124", folio: "002" },
      ],
      reason: "Strata plan SP12345 lodged 2026-05-01",
      confirm: true,
      commitToken: "33333333-3333-3333-3333-333333333333",
    });
    expect(r.childCts?.length).toBe(2);
    expect(r.confirm).toBe(true);
  });

  it("rejects unknown toState, missing parentAssessmentNumber, non-UUID token", () => {
    expect(
      inputs.request_strata_conversion.safeParse({
        parentAssessmentNumber: "TPS-9001-01",
        toState: "parent_strata_detected",
      }).success,
    ).toBe(false);
    expect(
      inputs.request_strata_conversion.safeParse({
        toState: "strata_plan_uploaded",
      }).success,
    ).toBe(false);
    expect(
      inputs.request_strata_conversion.safeParse({
        parentAssessmentNumber: "TPS-9001-01",
        toState: "withdrawn",
        commitToken: "not-uuid",
      }).success,
    ).toBe(false);
  });

  it("accepts all 5 toState values", () => {
    for (const state of [
      "strata_plan_uploaded",
      "children_previewed",
      "children_imported",
      "parent_superseded",
      "withdrawn",
    ] as const) {
      const r = inputs.request_strata_conversion.parse({
        parentAssessmentNumber: "TPS-9001-01",
        toState: state,
      });
      expect(r.toState).toBe(state);
    }
  });
});
