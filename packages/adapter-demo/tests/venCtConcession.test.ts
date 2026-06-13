/**
 * Tests for the 4 VEN + CT + Concession handlers (Round 2):
 *
 *  - `import_rate_schedule`         (preview, confirm, malformed CSV, missing council, RBAC denial scaffold)
 *  - `import_landgate_title_data`   (same shape; multi-PIN aggregation; encumbrances; idempotency)
 *  - `import_wc_eligibility`        (same shape; status normalisation)
 *  - `request_strata_conversion`    (legal/illegal transitions; child materialisation)
 *
 * The adapter does NOT enforce RBAC — the REST/web routes do. The "RBAC
 * denied for rates_officer" cases are covered as expectation-tests that the
 * handlers themselves stay neutral (succeed regardless of `userRole`); the
 * real gating lives in apps/web/app/api/... and is tested by integration.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createAbnClient } from "@ratesassist/identity";

import { dispatch } from "../src/runtime/dispatcher.js";
import { createRequestContext } from "../src/runtime/context.js";
import { CommitTokenStore } from "../src/runtime/commitTokens.js";
import { DataStore } from "../src/data/index.js";
import { _resetForTests, readRecent } from "../src/audit/index.js";

function ctx(overrides?: { userRole?: "officer" | "senior_officer" | "manager" | "admin" }) {
  return createRequestContext({
    store: new DataStore(),
    commitTokens: new CommitTokenStore(),
    abnClient: createAbnClient({ strict: false }),
    correlationId: "corr-ven-ct",
    tenantId: "T-test",
    userId: "U-tester",
    ...(overrides?.userRole !== undefined ? { userRole: overrides.userRole } : {}),
  });
}

// ===== 1. import_rate_schedule ==============================================

const RATE_HEADER =
  "financial_year,rate_code,applies_to_landuse,rate_in_dollar,minimum_payment,basis";
const RATE_CSV = [
  RATE_HEADER,
  "2025-26,GRV-RES,Residential,0.107,1200,GRV",
  "2025-26,GRV-COM,Commercial,0.135,1400,GRV",
  "2025-26,UV-RUR,Rural,0.045,800,UV",
  // Bad row: rate_in_dollar negative
  "2025-26,BAD-CODE,Residential,-0.5,100,GRV",
].join("\n");

describe("import_rate_schedule", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("preview returns commitToken + counts; no mutation", async () => {
    const c = ctx();
    const before = c.store.countRateScheduleForCouncilYear("TPS", "2025-26");
    const r = await dispatch({
      toolName: "import_rate_schedule",
      input: {
        councilCode: "TPS",
        financialYear: "2025-26",
        csvText: RATE_CSV,
        mergeStrategy: "upsert",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mutated).toBe(false);
    expect(typeof r.commitToken).toBe("string");
    const data = r.data as { validCount: number; errorCount: number };
    expect(data.validCount).toBe(3);
    expect(data.errorCount).toBe(1);
    expect(c.store.countRateScheduleForCouncilYear("TPS", "2025-26")).toBe(
      before,
    );
  });

  it("upsert confirm writes rows + audit row", async () => {
    const c = ctx();
    const preview = await dispatch({
      toolName: "import_rate_schedule",
      input: {
        councilCode: "TPS",
        financialYear: "2025-26",
        csvText: RATE_CSV,
        mergeStrategy: "upsert",
        confirm: false,
      },
      context: c,
    });
    if (!preview.ok) throw new Error("preview failed");
    const commit = await dispatch({
      toolName: "import_rate_schedule",
      input: {
        councilCode: "TPS",
        financialYear: "2025-26",
        csvText: RATE_CSV,
        mergeStrategy: "upsert",
        confirm: true,
        commitToken: preview.commitToken!,
      },
      context: c,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(commit.mutated).toBe(true);
    expect(c.store.countRateScheduleForCouncilYear("TPS", "2025-26")).toBe(3);
    const audit = readRecent("T-test", 10);
    const row = audit.find((e) => e.action === "write.import_rate_schedule");
    expect(row).toBeDefined();
    expect(row?.targetType).toBe("council_rate_schedule");
    expect(row?.targetId).toBe("TPS-2025-26");
    // Before/after counts captured.
    const after = row?.after as { rowCount: number; inserted: number };
    expect(after.rowCount).toBe(3);
    expect(after.inserted).toBe(3);
  });

  it("replace strategy wipes prior FY rows", async () => {
    const c = ctx();
    // Seed with upsert first
    const p1 = await dispatch({
      toolName: "import_rate_schedule",
      input: {
        councilCode: "TPS",
        financialYear: "2025-26",
        csvText: RATE_CSV,
        mergeStrategy: "upsert",
        confirm: false,
      },
      context: c,
    });
    if (!p1.ok) throw new Error("seed preview failed");
    const cm1 = await dispatch({
      toolName: "import_rate_schedule",
      input: {
        councilCode: "TPS",
        financialYear: "2025-26",
        csvText: RATE_CSV,
        mergeStrategy: "upsert",
        confirm: true,
        commitToken: p1.commitToken!,
      },
      context: c,
    });
    if (!cm1.ok) throw new Error("seed commit failed");
    // Now replace with two rows
    const small = [
      RATE_HEADER,
      "2025-26,GRV-RES,Residential,0.110,1300,GRV",
      "2025-26,UV-RUR,Rural,0.050,900,UV",
    ].join("\n");
    const p2 = await dispatch({
      toolName: "import_rate_schedule",
      input: {
        councilCode: "TPS",
        financialYear: "2025-26",
        csvText: small,
        mergeStrategy: "replace",
        confirm: false,
      },
      context: c,
    });
    if (!p2.ok) throw new Error("replace preview failed");
    const cm2 = await dispatch({
      toolName: "import_rate_schedule",
      input: {
        councilCode: "TPS",
        financialYear: "2025-26",
        csvText: small,
        mergeStrategy: "replace",
        confirm: true,
        commitToken: p2.commitToken!,
      },
      context: c,
    });
    expect(cm2.ok).toBe(true);
    expect(c.store.countRateScheduleForCouncilYear("TPS", "2025-26")).toBe(2);
  });

  it("malformed CSV (no header row) returns invalid_input", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "import_rate_schedule",
      input: {
        councilCode: "TPS",
        financialYear: "2025-26",
        csvText: "not_a_real_header,another_one\nrow,without,context_lol",
        mergeStrategy: "upsert",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });

  it("missing council returns not_found", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "import_rate_schedule",
      input: {
        councilCode: "ZZZ",
        financialYear: "2025-26",
        csvText: RATE_CSV,
        mergeStrategy: "upsert",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("not_found");
  });

  it("succeeds regardless of adapter userRole (RBAC enforced at route layer)", async () => {
    // Adapter context type uses {"officer"|"senior_officer"|"manager"|"admin"};
    // RBAC for rates_officer is enforced upstream at apps/web. The handler
    // itself stays role-neutral.
    const c = ctx({ userRole: "officer" });
    const r = await dispatch({
      toolName: "import_rate_schedule",
      input: {
        councilCode: "TPS",
        financialYear: "2025-26",
        csvText: RATE_CSV,
        mergeStrategy: "upsert",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(true);
  });

  it("upsert is idempotent under re-running identical content", async () => {
    const c = ctx();
    for (let i = 0; i < 2; i++) {
      const preview = await dispatch({
        toolName: "import_rate_schedule",
        input: {
          councilCode: "TPS",
          financialYear: "2025-26",
          csvText: RATE_CSV,
          mergeStrategy: "upsert",
          confirm: false,
        },
        context: c,
      });
      if (!preview.ok) throw new Error("preview failed");
      const commit = await dispatch({
        toolName: "import_rate_schedule",
        input: {
          councilCode: "TPS",
          financialYear: "2025-26",
          csvText: RATE_CSV,
          mergeStrategy: "upsert",
          confirm: true,
          commitToken: preview.commitToken!,
        },
        context: c,
      });
      if (!commit.ok) throw new Error("commit failed");
    }
    expect(c.store.countRateScheduleForCouncilYear("TPS", "2025-26")).toBe(3);
  });
});

// ===== 2. import_landgate_title_data ========================================

const TITLE_HEADER =
  "assessment_number,ven,ct_volume,ct_folio,ct_issued_date,proprietor_name,proprietor_postal_address,pin,lot_plan,landuse_code,area_sqm,encumbrance_type,encumbrance_reference,encumbrance_date,strata_parent_volume,strata_parent_folio";

const TITLE_CSV = [
  TITLE_HEADER,
  // VEN A — 3 PINs, 1 encumbrance
  "TPS-001,VEN-001,1234,567,2010-05-12,Smith Jane,1 Main St Perth WA 6000,P001,Lot 1 DP 1,Rural,8500,,,,,",
  "TPS-001,VEN-001,,,,,,P002,Lot 2 DP 1,Industrial,4200,,,,,",
  "TPS-001,VEN-001,,,,,,P003,Lot 3 DP 1,Rural,6800,,,,,",
  "TPS-001,VEN-001,,,,,,,,,,mortgage,M-001,2020-01-15,,",
  // VEN B — 1 PIN, strata parent indicator
  "TPS-002,VEN-002,2222,888,2015-08-01,Brown Ltd,42 Elm Rd Perth WA 6001,P010,Lot 10 DP 2,Residential,300,,,,V-9999,F-1",
  // Bad row: no ven and no assessment number
  ",,,,,,,P999,Lot 99 DP 99,Other,1,,,,,",
].join("\n");

describe("import_landgate_title_data", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("preview aggregates rows into VEN records + commitToken", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "import_landgate_title_data",
      input: {
        councilCode: "TPS",
        csvText: TITLE_CSV,
        sourceTier: "landgate_restricted",
        retrievedAt: "2026-05-15T00:00:00.000Z",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mutated).toBe(false);
    const data = r.data as {
      validRecordCount: number;
      pinCount: number;
      encumbranceCount: number;
      strataParentCount: number;
      errorCount: number;
    };
    expect(data.validRecordCount).toBe(2);
    expect(data.pinCount).toBe(4);
    expect(data.encumbranceCount).toBe(1);
    expect(data.strataParentCount).toBe(1);
    expect(data.errorCount).toBe(1);
  });

  it("confirm persists records + writes audit; lookup by VEN works", async () => {
    const c = ctx();
    const preview = await dispatch({
      toolName: "import_landgate_title_data",
      input: {
        councilCode: "TPS",
        csvText: TITLE_CSV,
        sourceTier: "landgate_restricted",
        retrievedAt: "2026-05-15T00:00:00.000Z",
        confirm: false,
      },
      context: c,
    });
    if (!preview.ok) throw new Error("preview failed");
    const commit = await dispatch({
      toolName: "import_landgate_title_data",
      input: {
        councilCode: "TPS",
        csvText: TITLE_CSV,
        sourceTier: "landgate_restricted",
        retrievedAt: "2026-05-15T00:00:00.000Z",
        confirm: true,
        commitToken: preview.commitToken!,
      },
      context: c,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(commit.mutated).toBe(true);

    const rec = c.store.landgateRecordsByVen("TPS", "VEN-001");
    expect(rec).toBeDefined();
    expect(rec?.pins.length).toBe(3);
    expect(rec?.encumbrances.length).toBe(1);
    expect(rec?.source.source).toBe("landgate_restricted");
    expect(rec?.source.retrievedAt).toBe("2026-05-15T00:00:00.000Z");

    const audit = readRecent("T-test", 10);
    const row = audit.find(
      (e) => e.action === "write.import_landgate_title_data",
    );
    expect(row).toBeDefined();
    expect(row?.targetType).toBe("council_landgate_snapshot");
    expect(row?.targetId).toBe("TPS-2026-05-15T00:00:00.000Z");
  });

  it("malformed CSV (no required header) returns invalid_input", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "import_landgate_title_data",
      input: {
        councilCode: "TPS",
        csvText: "foo,bar,baz\n1,2,3\n4,5,6",
        sourceTier: "council_uploaded_pdf",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });

  it("missing council returns not_found", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "import_landgate_title_data",
      input: {
        councilCode: "ZZZ",
        csvText: TITLE_CSV,
        sourceTier: "council_uploaded_pdf",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("not_found");
  });

  it("succeeds regardless of adapter userRole (RBAC enforced at route layer)", async () => {
    const c = ctx({ userRole: "officer" });
    const r = await dispatch({
      toolName: "import_landgate_title_data",
      input: {
        councilCode: "TPS",
        csvText: TITLE_CSV,
        sourceTier: "landgate_restricted",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(true);
  });

  it("repeated imports of identical content are idempotent", async () => {
    const c = ctx();
    async function once() {
      const p = await dispatch({
        toolName: "import_landgate_title_data",
        input: {
          councilCode: "TPS",
          csvText: TITLE_CSV,
          sourceTier: "landgate_restricted",
          retrievedAt: "2026-05-15T00:00:00.000Z",
          confirm: false,
        },
        context: c,
      });
      if (!p.ok) throw new Error("preview failed");
      const cm = await dispatch({
        toolName: "import_landgate_title_data",
        input: {
          councilCode: "TPS",
          csvText: TITLE_CSV,
          sourceTier: "landgate_restricted",
          retrievedAt: "2026-05-15T00:00:00.000Z",
          confirm: true,
          commitToken: p.commitToken!,
        },
        context: c,
      });
      if (!cm.ok) throw new Error("commit failed");
    }
    await once();
    await once();
    expect(c.store.countLandgateRecordsForCouncil("TPS")).toBe(2);
  });
});

// ===== 3. import_wc_eligibility =============================================

const WC_HEADER =
  "customer_id,card_number,holder_name,eligibility_status,valid_from,valid_to,cancellation_reason,cancellation_date,property_address_on_file";
const WC_CSV = [
  WC_HEADER,
  "CUST-001,PCC-1111,Mary Jones,ACTIVE,2020-01-01,,,,1 Main St",
  "CUST-002,PCC-2222,John Doe,Active,2018-03-01,,,,2 Main St",
  "CUST-003,DVA-3333,Pat Lee,cancelled,2015-05-01,2024-02-12,No longer eligible,2024-02-12,3 Main St",
  "CUST-004,,Jane Brown,deceased,2010-01-01,,Notification of death,2024-04-01,4 Main St",
  // Bad row: invalid status
  "CUST-005,PCC-5555,Bad Row,wat,2010-01-01,,,,5 Main St",
].join("\n");

describe("import_wc_eligibility", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("preview normalises status case + returns commitToken", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "import_wc_eligibility",
      input: {
        councilCode: "TPS",
        csvText: WC_CSV,
        retrievedAt: "2026-05-15T00:00:00.000Z",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as {
      validCount: number;
      errorCount: number;
      sampleRows: ReadonlyArray<{ eligibilityStatus: string }>;
    };
    expect(data.validCount).toBe(4);
    expect(data.errorCount).toBe(1);
    expect(data.sampleRows[0]!.eligibilityStatus).toBe("active");
    expect(data.sampleRows[1]!.eligibilityStatus).toBe("active");
  });

  it("confirm persists rows + audit; lookup by card works", async () => {
    const c = ctx();
    const preview = await dispatch({
      toolName: "import_wc_eligibility",
      input: {
        councilCode: "TPS",
        csvText: WC_CSV,
        retrievedAt: "2026-05-15T00:00:00.000Z",
        confirm: false,
      },
      context: c,
    });
    if (!preview.ok) throw new Error("preview failed");
    const commit = await dispatch({
      toolName: "import_wc_eligibility",
      input: {
        councilCode: "TPS",
        csvText: WC_CSV,
        retrievedAt: "2026-05-15T00:00:00.000Z",
        confirm: true,
        commitToken: preview.commitToken!,
      },
      context: c,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(commit.mutated).toBe(true);

    // Has card
    const recordA = c.store.waterCorpEligibilityByCard("TPS", "PCC-1111");
    expect(recordA?.eligibilityStatus).toBe("active");
    expect(recordA?.holderName).toBe("Mary Jones");
    // No card → fallback to customerId
    const recordB = c.store.waterCorpEligibilityByCard("TPS", "CUST-004");
    expect(recordB?.eligibilityStatus).toBe("deceased");

    const audit = readRecent("T-test", 10);
    const row = audit.find((e) => e.action === "write.import_wc_eligibility");
    expect(row).toBeDefined();
    expect(row?.targetType).toBe("council_wc_eligibility");
  });

  it("malformed CSV (missing required header) returns invalid_input", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "import_wc_eligibility",
      input: {
        councilCode: "TPS",
        csvText: "customer_id,holder_name\nCUST-X,Name", // missing eligibility_status, valid_from
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });

  it("missing council returns not_found", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "import_wc_eligibility",
      input: {
        councilCode: "ZZZ",
        csvText: WC_CSV,
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("not_found");
  });

  it("succeeds regardless of adapter userRole (RBAC enforced at route layer)", async () => {
    const c = ctx({ userRole: "officer" });
    const r = await dispatch({
      toolName: "import_wc_eligibility",
      input: {
        councilCode: "TPS",
        csvText: WC_CSV,
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(true);
  });
});

// ===== 4. request_strata_conversion =========================================

describe("request_strata_conversion", () => {
  beforeEach(() => {
    _resetForTests();
  });

  // Pick a real assessment from the demo fixtures.
  // The store's `listProperties` for TPS surfaces at least one assessment we
  // can use as the parent. Use it dynamically.
  function pickAnyTpsAssessment(c: ReturnType<typeof ctx>): string {
    const props = c.store.listProperties("TPS");
    expect(props.length).toBeGreaterThan(0);
    return props[0]!.assessmentNumber;
  }

  it("legal first transition (parent_strata_detected → strata_plan_uploaded) previews + commits", async () => {
    const c = ctx();
    const parent = pickAnyTpsAssessment(c);
    const p = await dispatch({
      toolName: "request_strata_conversion",
      input: {
        parentAssessmentNumber: parent,
        toState: "strata_plan_uploaded",
        confirm: false,
      },
      context: c,
    });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const cm = await dispatch({
      toolName: "request_strata_conversion",
      input: {
        parentAssessmentNumber: parent,
        toState: "strata_plan_uploaded",
        confirm: true,
        commitToken: p.commitToken!,
      },
      context: c,
    });
    expect(cm.ok).toBe(true);
    if (!cm.ok) return;
    const lc = c.store.strataLifecycleByAssessment(parent);
    expect(lc?.state).toBe("strata_plan_uploaded");
    expect(lc?.history.length).toBe(1);

    const audit = readRecent("T-test", 10);
    expect(
      audit.find(
        (e) => e.action === "state.strata_conversion.strata_plan_uploaded",
      ),
    ).toBeDefined();
  });

  it("illegal skip (parent_strata_detected → children_imported) returns invalid_input", async () => {
    const c = ctx();
    const parent = pickAnyTpsAssessment(c);
    const r = await dispatch({
      toolName: "request_strata_conversion",
      input: {
        parentAssessmentNumber: parent,
        toState: "children_imported",
        childCts: [{ volume: "V1", folio: "F1" }],
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
    expect(r.error).toMatch(/Illegal strata transition/);
  });

  it("withdraw is legal from any non-terminal state with a reason", async () => {
    const c = ctx();
    const parent = pickAnyTpsAssessment(c);
    const p = await dispatch({
      toolName: "request_strata_conversion",
      input: {
        parentAssessmentNumber: parent,
        toState: "withdrawn",
        reason: "Subdivision plan rejected by Landgate",
        confirm: false,
      },
      context: c,
    });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const cm = await dispatch({
      toolName: "request_strata_conversion",
      input: {
        parentAssessmentNumber: parent,
        toState: "withdrawn",
        reason: "Subdivision plan rejected by Landgate",
        confirm: true,
        commitToken: p.commitToken!,
      },
      context: c,
    });
    expect(cm.ok).toBe(true);
    const lc = c.store.strataLifecycleByAssessment(parent);
    expect(lc?.state).toBe("withdrawn");
    // The free-text reason survives in the RTBF-erasable lifecycle history…
    expect(lc?.history.at(-1)?.reason).toBe("Subdivision plan rejected by Landgate");
    // …but must NEVER reach the append-only, RTBF-exempt audit chain (RA-01).
    // The audit row records only the shape: reasonProvided + reasonChars.
    const audit = readRecent("T-test", 10);
    const row = audit.find((e) => e.action === "state.strata_conversion.withdrawn");
    expect(row).toBeDefined();
    const after = row!.after as { reasonProvided?: boolean; reasonChars?: number };
    expect(after.reasonProvided).toBe(true);
    expect(after.reasonChars).toBe("Subdivision plan rejected by Landgate".length);
    expect(JSON.stringify({ before: row!.before, after: row!.after })).not.toContain(
      "Subdivision plan rejected by Landgate",
    );
  });

  it("withdraw without reason returns invalid_input", async () => {
    const c = ctx();
    const parent = pickAnyTpsAssessment(c);
    const r = await dispatch({
      toolName: "request_strata_conversion",
      input: {
        parentAssessmentNumber: parent,
        toState: "withdrawn",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });

  it("children_imported materialises N child Property records (deterministic IDs)", async () => {
    const c = ctx();
    const parent = pickAnyTpsAssessment(c);
    // Walk states forward: detected → uploaded → previewed → imported.
    async function step(
      toState:
        | "strata_plan_uploaded"
        | "children_previewed"
        | "children_imported",
      extra: { childCts?: { volume: string; folio: string }[] } = {},
    ) {
      const p = await dispatch({
        toolName: "request_strata_conversion",
        input: {
          parentAssessmentNumber: parent,
          toState,
          ...(extra.childCts !== undefined ? { childCts: extra.childCts } : {}),
          confirm: false,
        },
        context: c,
      });
      if (!p.ok) throw new Error(`preview ${toState} failed: ${p.error}`);
      const cm = await dispatch({
        toolName: "request_strata_conversion",
        input: {
          parentAssessmentNumber: parent,
          toState,
          ...(extra.childCts !== undefined ? { childCts: extra.childCts } : {}),
          confirm: true,
          commitToken: p.commitToken!,
        },
        context: c,
      });
      if (!cm.ok) throw new Error(`commit ${toState} failed: ${cm.error}`);
    }
    const beforeCount = c.store.listProperties("TPS").length;
    const childCts = [
      { volume: "V100", folio: "F1" },
      { volume: "V100", folio: "F2" },
      { volume: "V100", folio: "F3" },
    ];
    await step("strata_plan_uploaded");
    await step("children_previewed", { childCts });
    await step("children_imported", { childCts });
    const afterCount = c.store.listProperties("TPS").length;
    expect(afterCount - beforeCount).toBe(3);
    const lc = c.store.strataLifecycleByAssessment(parent);
    expect(lc?.state).toBe("children_imported");
    expect(lc?.childCts.length).toBe(3);
    for (const cc of lc!.childCts) {
      expect(cc.childAssessmentNumber).toBeDefined();
      expect(c.store.getProperty(cc.childAssessmentNumber!)).toBeDefined();
    }
  });

  it("children_imported without childCts returns invalid_input", async () => {
    const c = ctx();
    const parent = pickAnyTpsAssessment(c);
    // Get to children_previewed first.
    for (const toState of [
      "strata_plan_uploaded",
      "children_previewed",
    ] as const) {
      const p = await dispatch({
        toolName: "request_strata_conversion",
        input: { parentAssessmentNumber: parent, toState, confirm: false },
        context: c,
      });
      if (!p.ok) throw new Error("preview failed");
      const cm = await dispatch({
        toolName: "request_strata_conversion",
        input: {
          parentAssessmentNumber: parent,
          toState,
          confirm: true,
          commitToken: p.commitToken!,
        },
        context: c,
      });
      if (!cm.ok) throw new Error("commit failed");
    }
    const r = await dispatch({
      toolName: "request_strata_conversion",
      input: {
        parentAssessmentNumber: parent,
        toState: "children_imported",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });

  it("unknown parent assessment returns not_found", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "request_strata_conversion",
      input: {
        parentAssessmentNumber: "DOES-NOT-EXIST",
        toState: "strata_plan_uploaded",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("not_found");
  });

  it("succeeds regardless of adapter userRole (RBAC enforced at route layer)", async () => {
    const c = ctx({ userRole: "officer" });
    const parent = pickAnyTpsAssessment(c);
    const r = await dispatch({
      toolName: "request_strata_conversion",
      input: {
        parentAssessmentNumber: parent,
        toState: "strata_plan_uploaded",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(true);
  });
});
