/**
 * Round-trip test for `list_lag_window_candidates` through the dispatcher.
 *
 * The handler delegates to the spatial layer which will fail to reach SLIP
 * from the test environment — the seeded grant + parcel fallbacks are
 * supplied by the handler so the result is always `ok: true` with
 * `source: "seeded"` in this test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatch } from "../src/runtime/dispatcher.js";
import { createRequestContext } from "../src/runtime/context.js";
import { CommitTokenStore } from "../src/runtime/commitTokens.js";
import { DataStore } from "../src/data/index.js";
import { createAbnClient } from "@ratesassist/identity";

function ctx() {
  return createRequestContext({
    store: new DataStore(),
    commitTokens: new CommitTokenStore(),
    abnClient: createAbnClient({ strict: false }),
    correlationId: "corr-test-lag",
    now: () => new Date("2026-05-10T00:00:00Z"),
  });
}

describe("dispatch list_lag_window_candidates", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async () => new Response("oops", { status: 500 })) as typeof fetch;
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    globalThis.fetch = originalFetch;
  });

  it("returns ok=true with seeded candidates in offline test mode", async () => {
    const r = await dispatch({
      toolName: "list_lag_window_candidates",
      input: { sinceDays: 90, minSeverity: "medium" },
      context: ctx(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as {
      candidates: Array<{
        tenement: { tenementIdDisplay: string; detailUrl: string };
        parcel: { detailUrl: string; landuse: string };
        severityHint: "high" | "medium" | "low";
        lagDays: number;
      }>;
      source: string;
    };
    expect(data.source).toBe("seeded");
    expect(data.candidates.length).toBeGreaterThan(0);
    expect(data.candidates[0]!.parcel.detailUrl).toContain("landgate");
    // minSeverity=medium filter
    for (const c of data.candidates) {
      expect(c.severityHint === "medium" || c.severityHint === "high").toBe(true);
    }
  });

  it("filters by minSeverity=high", async () => {
    const r = await dispatch({
      toolName: "list_lag_window_candidates",
      input: { sinceDays: 90, minSeverity: "high" },
      context: ctx(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as {
      candidates: Array<{ severityHint: "high" | "medium" | "low" }>;
    };
    for (const c of data.candidates) {
      expect(c.severityHint).toBe("high");
    }
  });

  it("rejects sinceDays out of range via the schema", async () => {
    const r = await dispatch({
      toolName: "list_lag_window_candidates",
      input: { sinceDays: 9999, minSeverity: "medium" },
      context: ctx(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });
});
