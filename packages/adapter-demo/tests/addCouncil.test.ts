/**
 * Characterization tests for `add_council` — two-phase commit semantics,
 * audit log integration, and duplicate-code rejection.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { dispatch } from "../src/runtime/dispatcher.js";
import { createRequestContext } from "../src/runtime/context.js";
import { CommitTokenStore } from "../src/runtime/commitTokens.js";
import { DataStore } from "../src/data/index.js";
import { createAbnClient } from "@ratesassist/identity";
import { _resetForTests, readRecent } from "../src/audit/index.js";

function ctx() {
  return createRequestContext({
    store: new DataStore(),
    commitTokens: new CommitTokenStore(),
    abnClient: createAbnClient({ strict: false }),
    correlationId: "corr-add-council",
    tenantId: "T-test",
    userId: "U-tester",
  });
}

const VALID = {
  code: "ABC",
  name: "Shire of Test",
  state: "WA" as const,
  centerLat: -31.5,
  centerLng: 117.0,
  population: 1000,
  rateableProperties: 500,
  rateRevenue: 1_000_000,
};

describe("add_council", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("preview returns commitToken; no mutation yet", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "add_council",
      input: { ...VALID, confirm: false },
      context: c,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mutated).toBe(false);
    expect(typeof r.commitToken).toBe("string");
    expect(c.store.getCouncil(VALID.code)).toBeUndefined();
  });

  it("confirm with valid token persists + writes audit", async () => {
    const c = ctx();
    const preview = await dispatch({
      toolName: "add_council",
      input: { ...VALID, confirm: false },
      context: c,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const token = preview.commitToken!;

    const commit = await dispatch({
      toolName: "add_council",
      input: { ...VALID, confirm: true, commitToken: token },
      context: c,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(commit.mutated).toBe(true);
    expect(c.store.getCouncil(VALID.code)).toBeDefined();

    const audit = readRecent("T-test", 10);
    const row = audit.find((e) => e.action === "write.add_council");
    expect(row).toBeDefined();
    expect(row?.targetType).toBe("council");
    expect(row?.targetId).toBe(VALID.code);
  });

  it("duplicate code returns conflict on preview", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "add_council",
      input: { ...VALID, code: "TPS", confirm: false },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("conflict");
  });

  it("confirm without commitToken returns invalid_input", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "add_council",
      input: { ...VALID, confirm: true },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });

  it("confirm with unknown commitToken returns conflict", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "add_council",
      input: {
        ...VALID,
        confirm: true,
        commitToken: "00000000-0000-0000-0000-000000000000",
      },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("conflict");
  });

  it("rejects malformed code (lower case)", async () => {
    const c = ctx();
    const r = await dispatch({
      toolName: "add_council",
      input: { ...VALID, code: "abc", confirm: false },
      context: c,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });
});
