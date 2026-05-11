/**
 * Tests for `import_rating_roll` — two-phase commit, replace vs upsert,
 * council-not-found, commit-token-invalid, audit row written.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createAbnClient } from "@ratesassist/identity";

import { dispatch } from "../src/runtime/dispatcher.js";
import { createRequestContext } from "../src/runtime/context.js";
import { CommitTokenStore } from "../src/runtime/commitTokens.js";
import { DataStore } from "../src/data/index.js";
import { _resetForTests, readRecent } from "../src/audit/index.js";

function ctx(store?: DataStore) {
  return createRequestContext({
    store: store ?? new DataStore(),
    commitTokens: new CommitTokenStore(),
    abnClient: createAbnClient({ strict: false }),
    correlationId: "corr-import-roll",
    tenantId: "T-test",
    userId: "U-tester",
  });
}

const HEADER =
  "assessment_number,address,suburb,postcode,state,landuse,valuation,annual_rates,owner_name,owner_abn";
const SAMPLE_CSV = [
  HEADER,
  "TPS-IMP-01,1 New Road,Tom Price,6751,WA,Residential,400000,2000,Test Owner A,",
  "TPS-IMP-02,2 New Road,Tom Price,6751,WA,Commercial,800000,6400,Test Owner B,12345678901",
  "TPS-IMP-03,3 New Road,Tom Price,6751,WA,Rural,150000,750,Pastoral Trust,",
  // Bad row — postcode invalid
  "TPS-IMP-BAD,99 Bad,Tom Price,675,WA,Residential,300000,1500,Bad Tester,",
].join("\n");

describe("import_rating_roll", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("preview returns commit token + counts; no mutation", async () => {
    const c = ctx();
    const before = c.store.countPropertiesForCouncil("TPS");
    const r = await dispatch({
      toolName: "import_rating_roll",
      input: {
        councilCode: "TPS",
        csvText: SAMPLE_CSV,
        mergeStrategy: "upsert",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mutated).toBe(false);
    expect(typeof r.commitToken).toBe("string");
    const data = r.data as {
      validCount: number;
      errorCount: number;
    };
    expect(data.validCount).toBe(3);
    expect(data.errorCount).toBe(1);
    expect(c.store.countPropertiesForCouncil("TPS")).toBe(before);
  });

  it("upsert commit appends new properties + writes audit", async () => {
    const c = ctx();
    const before = c.store.countPropertiesForCouncil("TPS");
    const preview = await dispatch({
      toolName: "import_rating_roll",
      input: {
        councilCode: "TPS",
        csvText: SAMPLE_CSV,
        mergeStrategy: "upsert",
        confirm: false,
      },
      context: c,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const commit = await dispatch({
      toolName: "import_rating_roll",
      input: {
        councilCode: "TPS",
        csvText: SAMPLE_CSV,
        mergeStrategy: "upsert",
        confirm: true,
        commitToken: preview.commitToken!,
      },
      context: c,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(commit.mutated).toBe(true);
    const after = c.store.countPropertiesForCouncil("TPS");
    expect(after).toBe(before + 3);
    expect(c.store.getProperty("TPS-IMP-01")).toBeDefined();
    expect(c.store.getProperty("TPS-IMP-02")).toBeDefined();

    const audit = readRecent("T-test", 10);
    const row = audit.find((e) => e.action === "write.import_rating_roll");
    expect(row).toBeDefined();
    expect(row?.targetType).toBe("council");
    expect(row?.targetId).toBe("TPS");
  });

  it("replace strategy wipes existing council properties", async () => {
    const c = ctx();
    const beforeAll = c.store.countPropertiesForCouncil("TPS");
    expect(beforeAll).toBeGreaterThan(0);
    const preview = await dispatch({
      toolName: "import_rating_roll",
      input: {
        councilCode: "TPS",
        csvText: SAMPLE_CSV,
        mergeStrategy: "replace",
        confirm: false,
      },
      context: c,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const commit = await dispatch({
      toolName: "import_rating_roll",
      input: {
        councilCode: "TPS",
        csvText: SAMPLE_CSV,
        mergeStrategy: "replace",
        confirm: true,
        commitToken: preview.commitToken!,
      },
      context: c,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(c.store.countPropertiesForCouncil("TPS")).toBe(3);
  });

  it("unknown council returns not_found", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "import_rating_roll",
      input: {
        councilCode: "ZZZ",
        csvText: SAMPLE_CSV,
        mergeStrategy: "upsert",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("not_found");
  });

  it("confirm without commitToken returns invalid_input", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "import_rating_roll",
      input: {
        councilCode: "TPS",
        csvText: SAMPLE_CSV,
        mergeStrategy: "upsert",
        confirm: true,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });

  it("confirm with unknown commitToken returns conflict", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "import_rating_roll",
      input: {
        councilCode: "TPS",
        csvText: SAMPLE_CSV,
        mergeStrategy: "upsert",
        confirm: true,
        commitToken: "00000000-0000-0000-0000-000000000000",
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("conflict");
  });

  it("commit token issued for upsert cannot be replayed as replace", async () => {
    const c = ctx();
    const preview = await dispatch({
      toolName: "import_rating_roll",
      input: {
        councilCode: "TPS",
        csvText: SAMPLE_CSV,
        mergeStrategy: "upsert",
        confirm: false,
      },
      context: c,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const commit = await dispatch({
      toolName: "import_rating_roll",
      input: {
        councilCode: "TPS",
        csvText: SAMPLE_CSV,
        mergeStrategy: "replace",
        confirm: true,
        commitToken: preview.commitToken!,
      },
      context: c,
    });
    expect(commit.ok).toBe(false);
    if (commit.ok) return;
    expect(commit.code).toBe("conflict");
  });

  it("zero-valid-rows preview returns invalid_input", async () => {
    const c = ctx();
    const onlyBad = [
      HEADER,
      "BAD,99 Bad,Tom Price,675,WA,Residential,300000,1500,Bad,",
    ].join("\n");
    const r = await dispatch({
      toolName: "import_rating_roll",
      input: {
        councilCode: "TPS",
        csvText: onlyBad,
        mergeStrategy: "upsert",
        confirm: false,
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });
});
