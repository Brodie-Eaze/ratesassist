/**
 * Round-trip test for `get_grant_detail` through the dispatcher.
 *
 * Pins:
 *   - happy path returns ok=true with the grant + a synthetic-fallback
 *     parcel set (cadastreSource === "seeded").
 *   - unknown tenement → ok=false, code=not_found.
 *   - invalid input shape → invalid_input.
 *   - synthetic fallback is labelled honestly via cadastreSource +
 *     cadastreNote.
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
    correlationId: "corr-test-grant-detail",
    now: () => new Date("2026-05-10T00:00:00Z"),
  });
}

describe("dispatch get_grant_detail", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    originalFetch = globalThis.fetch;
    // Force SLIP failure → seeded fallback fires.
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async () => new Response("oops", { status: 500 })) as typeof fetch;
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    globalThis.fetch = originalFetch;
  });

  it("returns the joined briefing for a seeded tenement id", async () => {
    const r = await dispatch({
      toolName: "get_grant_detail",
      input: { tenementId: "M  4701569", sinceDays: 90 },
      context: ctx(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as {
      grant: { tenementId: string; tenementIdDisplay: string; provisional: boolean };
      intersectingParcels: Array<{
        assessmentNumber: string;
        estimatedUpliftSeverity: string;
        estimatedUpliftAmount: number;
      }>;
      cadastreSource: string;
      cadastreNote: string;
      grantsSource: string;
    };
    expect(data.grant.tenementId).toBe("M  4701569");
    expect(data.grant.tenementIdDisplay).toBe("M 47/1569");
    // Demo store has no cadastre — synthetic fallback expected.
    expect(data.cadastreSource).toBe("seeded");
    expect(data.cadastreNote).toContain("synthetic");
    expect(data.grantsSource).toBe("seeded");
    // Tom Price-area properties should land within 50km of M  4701569 centroid.
    expect(data.intersectingParcels.length).toBeGreaterThan(0);
    for (const p of data.intersectingParcels) {
      expect(["high", "medium", "low"]).toContain(p.estimatedUpliftSeverity);
      expect(typeof p.estimatedUpliftAmount).toBe("number");
    }
  });

  it("returns not_found for an unknown tenement id", async () => {
    const r = await dispatch({
      toolName: "get_grant_detail",
      input: { tenementId: "Z  9999999", sinceDays: 90 },
      context: ctx(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("not_found");
  });

  it("rejects malformed input", async () => {
    const r = await dispatch({
      toolName: "get_grant_detail",
      input: { tenementId: "x" }, // too short
      context: ctx(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });
});
