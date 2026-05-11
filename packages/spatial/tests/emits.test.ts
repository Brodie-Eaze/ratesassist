/**
 * Tests for `./emits.ts`.
 *
 * EMITS has no public machine-readable endpoint as of 2026-05-11, so the
 * library treats every successful return as `source: "seeded"`. These tests
 * pin that behaviour, the URL helper, and the error paths.
 */

import { describe, it, expect } from "vitest";
import {
  EMITS_BASE,
  EMITS_PUBLIC_SEARCH,
  buildEmitsSearchUrl,
  emitsAvailable,
  fetchEmitsApprovalsForTenement,
  type EmitsApproval,
} from "../src/emits.js";

const SEED: readonly EmitsApproval[] = Object.freeze([
  {
    tenementId: "M  4701612",
    approvalType: "MP",
    approvalNumber: "MP-12345",
    status: "active",
    startDate: "2025-09-12",
    endDate: "2030-09-12",
    scopeSummary: "Iron ore open pit — pre-strip + ROM pad.",
  },
  {
    tenementId: "M  2600987",
    approvalType: "POW",
    approvalNumber: "POW-98711",
    status: "active",
    startDate: "2026-01-04",
    scopeSummary: "Gold tailings reprocessing — Year 1 POW.",
  },
  {
    tenementId: "M  4701709",
    approvalType: "MP",
    approvalNumber: "MP-22018",
    status: "pending",
    scopeSummary: "Iron ore — under assessment.",
  },
]);

describe("emits constants & availability", () => {
  it("exposes the public-reports search base", () => {
    expect(EMITS_BASE).toMatch(/^https:\/\/emits\.dmp\.wa\.gov\.au/);
    expect(EMITS_PUBLIC_SEARCH).toContain("/Pages/PublicReports.aspx");
  });

  it("reports the portal as available (browser users only)", () => {
    expect(emitsAvailable()).toBe(true);
  });
});

describe("buildEmitsSearchUrl", () => {
  it("returns the bare search URL for an empty id", () => {
    expect(buildEmitsSearchUrl("")).toBe(EMITS_PUBLIC_SEARCH);
    expect(buildEmitsSearchUrl("   ")).toBe(EMITS_PUBLIC_SEARCH);
  });

  it("percent-encodes the raw tenement id into the hash", () => {
    const url = buildEmitsSearchUrl("M  4701612");
    expect(url.startsWith(EMITS_PUBLIC_SEARCH + "#tenement=")).toBe(true);
    expect(url).toContain("M%20%204701612");
  });
});

describe("fetchEmitsApprovalsForTenement", () => {
  it("rejects empty tenement id with invalid_input", async () => {
    const r = await fetchEmitsApprovalsForTenement("   ");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });

  it("returns no_layer_responded when no seeded set is provided", async () => {
    const r = await fetchEmitsApprovalsForTenement("M  4701612");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("no_layer_responded");
  });

  it("returns seeded approvals filtered by exact-match tenement id", async () => {
    const r = await fetchEmitsApprovalsForTenement("M  4701612", { seeded: SEED });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("seeded");
    expect(r.approvals).toHaveLength(1);
    expect(r.approvals[0]!.approvalNumber).toBe("MP-12345");
    expect(r.note).toContain("machine-readable");
  });

  it("returns an empty seeded set when no fixture matches", async () => {
    const r = await fetchEmitsApprovalsForTenement("M  9999999", { seeded: SEED });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("seeded");
    expect(r.approvals).toHaveLength(0);
  });

  it("propagates the correlationId on failure", async () => {
    const r = await fetchEmitsApprovalsForTenement("", { correlationId: "corr-1" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.correlationId).toBe("corr-1");
  });
});
