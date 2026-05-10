/**
 * Round-trip test for the `list_recent_grants` tool through the dispatcher.
 *
 * The handler delegates to `@ratesassist/spatial` which will fail to reach
 * SLIP from the test environment — the seeded fallback (SEEDED_GRANTS) is
 * supplied by the handler so the result is always `ok: true` with
 * `source: "seeded"` in this test. This pins the demo-mode behaviour.
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
    correlationId: "corr-test-grants",
    // Anchor "now" to the same date the seeded fixture targets so the
    // 30-day-window math is deterministic.
    now: () => new Date("2026-05-10T00:00:00Z"),
  });
}

describe("dispatch list_recent_grants", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    originalFetch = globalThis.fetch;
    // Force SLIP failure so seeded fallback fires.
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async () => new Response("oops", { status: 500 })) as typeof fetch;
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    globalThis.fetch = originalFetch;
  });

  it("returns ok=true with seeded grants in offline test mode", async () => {
    const r = await dispatch({
      toolName: "list_recent_grants",
      input: { sinceDays: 30 },
      context: ctx(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as {
      grants: Array<{ tenementIdDisplay: string; detailUrl: string }>;
      source: string;
      watermarkUsedMs: number;
    };
    expect(data.source).toBe("seeded");
    expect(data.grants.length).toBeGreaterThan(0);
    // First grant is most recent.
    expect(data.grants[0]!.tenementIdDisplay).toMatch(/^[MEPGLR] \d{1,2}\/\d+$/);
    expect(data.grants[0]!.detailUrl).toContain("%20%20");
    expect(typeof data.watermarkUsedMs).toBe("number");
  });

  it("filters by type allow-list", async () => {
    const r = await dispatch({
      toolName: "list_recent_grants",
      input: { sinceDays: 90, types: ["M"] },
      context: ctx(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { grants: Array<{ type: string }> };
    for (const g of data.grants) {
      expect(g.type).toBe("M");
    }
  });

  it("rejects sinceDays out of range", async () => {
    const r = await dispatch({
      toolName: "list_recent_grants",
      input: { sinceDays: 9999 },
      context: ctx(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });
});
