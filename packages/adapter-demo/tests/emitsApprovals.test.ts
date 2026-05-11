/**
 * Round-trip tests for the `list_environmental_approvals` tool through the
 * dispatcher, plus a direct test that the seeded `emitsApprovalsByTenement`
 * index has the active flags the recovery engine expects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatch } from "../src/runtime/dispatcher.js";
import { createRequestContext } from "../src/runtime/context.js";
import { CommitTokenStore } from "../src/runtime/commitTokens.js";
import { DataStore } from "../src/data/index.js";
import { createAbnClient } from "@ratesassist/identity";
import {
  SEEDED_EMITS_APPROVALS,
  SEEDED_EMITS_BY_TENEMENT,
} from "../src/handlers/emitsApprovals.js";
import type { EmitsApproval } from "@ratesassist/spatial";

function ctx() {
  return createRequestContext({
    store: new DataStore(),
    commitTokens: new CommitTokenStore(),
    abnClient: createAbnClient({ strict: false }),
    correlationId: "corr-test-emits",
    now: () => new Date("2026-05-10T00:00:00Z"),
  });
}

describe("dispatch list_environmental_approvals", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("returns the active subset by default", async () => {
    const r = await dispatch({
      toolName: "list_environmental_approvals",
      input: { active: true },
      context: ctx(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { approvals: readonly EmitsApproval[]; source: string };
    expect(data.source).toBe("seeded");
    expect(data.approvals.length).toBeGreaterThan(0);
    for (const a of data.approvals) expect(a.status).toBe("active");
  });

  it("returns expired and pending entries when active=false", async () => {
    const r = await dispatch({
      toolName: "list_environmental_approvals",
      input: { active: false },
      context: ctx(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { approvals: readonly EmitsApproval[] };
    const statuses = new Set(data.approvals.map((a) => a.status));
    // Fixture set carries at least one non-active entry to verify the toggle.
    expect(statuses.size).toBeGreaterThan(1);
    expect(data.approvals.length).toBe(SEEDED_EMITS_APPROVALS.length);
  });

  it("filters by tenementId when supplied", async () => {
    const target = "M  4701612";
    const r = await dispatch({
      toolName: "list_environmental_approvals",
      input: { tenementId: target, active: true },
      context: ctx(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { approvals: readonly EmitsApproval[]; source: string };
    expect(data.source).toBe("seeded");
    for (const a of data.approvals) {
      expect(a.tenementId).toBe(target);
      expect(a.status).toBe("active");
    }
  });

  it("rejects an empty tenementId via schema validation", async () => {
    const r = await dispatch({
      toolName: "list_environmental_approvals",
      input: { tenementId: "ab", active: true },
      context: ctx(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_input");
  });
});

describe("SEEDED_EMITS_BY_TENEMENT", () => {
  it("indexes every seeded approval keyed by tenementId", () => {
    const total = [...SEEDED_EMITS_BY_TENEMENT.values()].reduce(
      (n, list) => n + list.length,
      0,
    );
    expect(total).toBe(SEEDED_EMITS_APPROVALS.length);
  });

  it("marks active approvals with active=true and includes approval ids in reasoning", () => {
    const entry = SEEDED_EMITS_BY_TENEMENT.get("M  4701612");
    expect(entry).toBeDefined();
    const active = entry!.find((e) => e.active);
    expect(active).toBeDefined();
    expect(active!.reasoning).toContain("MP-12345");
  });

  it("marks expired approvals with active=false", () => {
    const entry = SEEDED_EMITS_BY_TENEMENT.get("M  4701569");
    expect(entry).toBeDefined();
    for (const e of entry!) expect(e.active).toBe(false);
  });
});
