/**
 * Round-trip tests for `list_address_discrepancies` through the dispatcher.
 */

import { describe, it, expect } from "vitest";
import { dispatch } from "../src/runtime/dispatcher.js";
import { createRequestContext } from "../src/runtime/context.js";
import { CommitTokenStore } from "../src/runtime/commitTokens.js";
import { DataStore } from "../src/data/index.js";
import { createAbnClient } from "@ratesassist/identity";
import { SEEDED_ADDRESS_DISCREPANCIES } from "../src/handlers/addressDiscrepancies.js";

function ctx() {
  return createRequestContext({
    store: new DataStore(),
    commitTokens: new CommitTokenStore(),
    abnClient: createAbnClient({ strict: false }),
    correlationId: "corr-test-addr",
    now: () => new Date("2026-05-10T00:00:00Z"),
  });
}

describe("dispatch list_address_discrepancies", () => {
  it("returns the seeded discrepancies at default filter (medium+)", async () => {
    const r = await dispatch({
      toolName: "list_address_discrepancies",
      input: { kind: "all", minSeverity: "medium" },
      context: ctx(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as {
      discrepancies: ReadonlyArray<{ kind: string; severityHint: string }>;
      source: string;
    };
    expect(data.source).toBe("seeded");
    expect(data.discrepancies.length).toBe(SEEDED_ADDRESS_DISCREPANCIES.length);
    for (const d of data.discrepancies) {
      expect(d.severityHint === "medium" || d.severityHint === "high").toBe(true);
    }
  });

  it("filters by kind", async () => {
    const r = await dispatch({
      toolName: "list_address_discrepancies",
      input: { kind: "industrial_reuse", minSeverity: "low" },
      context: ctx(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { discrepancies: Array<{ kind: string }> };
    expect(data.discrepancies.length).toBeGreaterThan(0);
    for (const d of data.discrepancies) {
      expect(d.kind).toBe("industrial_reuse");
    }
  });

  it("filters by minSeverity=high", async () => {
    const r = await dispatch({
      toolName: "list_address_discrepancies",
      input: { kind: "all", minSeverity: "high" },
      context: ctx(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { discrepancies: Array<{ severityHint: string }> };
    for (const d of data.discrepancies) {
      expect(d.severityHint).toBe("high");
    }
  });

  it("rejects unknown kind via the schema", async () => {
    const r = await dispatch({
      toolName: "list_address_discrepancies",
      input: { kind: "bogus" as never, minSeverity: "medium" },
      context: ctx(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });

  it("seed entries are well-formed and reasonings are non-empty", () => {
    expect(SEEDED_ADDRESS_DISCREPANCIES.length).toBeGreaterThanOrEqual(5);
    for (const d of SEEDED_ADDRESS_DISCREPANCIES) {
      expect(d.assessmentNumber.length).toBeGreaterThan(0);
      expect(d.reasoning.length).toBeGreaterThan(20);
      expect(d.landgateAddress.length).toBeGreaterThan(0);
      expect(d.techoneAddress.length).toBeGreaterThan(0);
    }
  });
});
