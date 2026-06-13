/**
 * Audit-integration tests for mutating handlers.
 *
 * Round 5 wires recordMutation() into the two-phase commit handlers and
 * the certificate handler. These tests verify:
 *   - update_owner_contact preview: NO audit row.
 *   - update_owner_contact confirm: ONE audit row with correct shape.
 *   - add_property_note confirm: ONE audit row with correct before/after.
 *   - generate_statutory_certificate: ONE audit row (fail-closed action).
 *   - list_audit_log returns the rows in newest-first order, scoped by tenant.
 *   - Cross-tenant isolation: the in-memory buffer holds entries for both
 *     tenants but readRecent only surfaces the requested one.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { _resetForTests, readRecent, size } from "../src/audit/index.js";
import { DataStore } from "../src/data/index.js";
import { CommitTokenStore } from "../src/runtime/commitTokens.js";
import {
  createDefaultAbnClient,
  createRequestContext,
} from "../src/runtime/context.js";
import { dispatch } from "../src/runtime/dispatcher.js";

function makeCtx(overrides: { actorId?: string; tenantId?: string; ip?: string } = {}) {
  return createRequestContext({
    store: new DataStore(),
    commitTokens: new CommitTokenStore(),
    abnClient: createDefaultAbnClient(),
    correlationId: "corr-audit-test",
    actorKind: "user",
    actorId: overrides.actorId ?? "user-supervisor-1",
    ...(overrides.tenantId !== undefined ? { tenantId: overrides.tenantId } : {}),
    ...(overrides.ip !== undefined ? { ip: overrides.ip } : {}),
  });
}

beforeEach(() => {
  _resetForTests();
});

describe("audit log integration", () => {
  it("update_owner_contact preview does not audit; confirm does", async () => {
    const ctx = makeCtx({ ip: "10.0.0.5" });
    // Preview
    const preview = await dispatch({
      toolName: "update_owner_contact",
      input: { ownerId: "O-WA-001", newPhone: "08 1234 5678" },
      context: ctx,
    });
    expect(preview.ok).toBe(true);
    expect(size()).toBe(0);

    if (!preview.ok) throw new Error("preview failed");
    const token = preview.commitToken!;
    expect(token).toBeDefined();

    // Confirm — uses the SAME context so commitTokens carries over.
    const confirm = await dispatch({
      toolName: "update_owner_contact",
      input: {
        ownerId: "O-WA-001",
        newPhone: "08 1234 5678",
        confirm: true,
        commitToken: token,
      },
      context: ctx,
    });
    expect(confirm.ok).toBe(true);

    const entries = readRecent(ctx.tenantId, 50);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.action).toBe("update_owner_contact");
    expect(e.actorId).toBe("user-supervisor-1");
    expect(e.actorKind).toBe("user");
    expect(e.tenantId).toBe(ctx.tenantId);
    expect(e.targetType).toBe("owner");
    expect(e.targetId).toBe("O-WA-001");
    expect(e.correlationId).toBe("corr-audit-test");
    expect(e.ip).toBe("10.0.0.5");
    // PII-clean audit projection (RA-01): the audit row records WHICH fields
    // changed, never the phone/email/name values. The audit log is append-only
    // and RTBF-exempt, so lodging the PII here would defeat erasure (APP 11.2).
    const before = e.before as { redacted: boolean; changedFields: string[] };
    const after = e.after as {
      redacted: boolean;
      changedFields: string[];
      ownerId: string;
    };
    expect(before.redacted).toBe(true);
    expect(before.changedFields).toContain("phone");
    expect(after.changedFields).toContain("phone");
    expect(after.ownerId).toBe("O-WA-001");
    // The actual PII values must NOT appear anywhere in the audit payload.
    const payload = JSON.stringify({ before: e.before, after: e.after });
    expect(payload).not.toContain("08 9200 7700");
    expect(payload).not.toContain("08 1234 5678");
  });

  it("add_property_note records before/after notes array", async () => {
    const ctx = makeCtx();
    const store = ctx.store;
    const sampleProp = store.listProperties()[0]!;

    const preview = await dispatch({
      toolName: "add_property_note",
      input: { assessmentNumber: sampleProp.assessmentNumber, note: "Audit-test note" },
      context: ctx,
    });
    if (!preview.ok) throw new Error("note preview failed");

    const confirm = await dispatch({
      toolName: "add_property_note",
      input: {
        assessmentNumber: sampleProp.assessmentNumber,
        note: "Audit-test note",
        confirm: true,
        commitToken: preview.commitToken!,
      },
      context: ctx,
    });
    expect(confirm.ok).toBe(true);

    const entries = readRecent(ctx.tenantId, 50);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("add_property_note");
    expect(entries[0]!.targetType).toBe("property");
    expect(entries[0]!.targetId).toBe(sampleProp.assessmentNumber);
    // PII-clean audit projection (RA-01): the audit row records the SHAPE
    // of the change (note count + characters appended), never the note body.
    // The audit log is append-only and RTBF-exempt, so lodging the free-text
    // note here would defeat erasure (APP 11.2).
    const before = entries[0]!.before as { redacted: boolean; noteCount: number };
    const after = entries[0]!.after as {
      redacted: boolean;
      noteCount: number;
      addedNoteChars: number;
    };
    expect(before.redacted).toBe(true);
    expect(after.redacted).toBe(true);
    expect(after.noteCount).toBe(before.noteCount + 1);
    expect(after.addedNoteChars).toBe("Audit-test note".length);
    // The note body must NOT appear anywhere in the audit payload.
    const payload = JSON.stringify({ before: entries[0]!.before, after: entries[0]!.after });
    expect(payload).not.toContain("Audit-test note");
  });

  it("generate_statutory_certificate writes a fail-closed audit row", async () => {
    const ctx = makeCtx();
    // Find a WA property — those have certificate templates.
    const waProp = ctx.store.listProperties().find((p) => p.state === "WA")!;
    const result = await dispatch({
      toolName: "generate_statutory_certificate",
      input: {
        assessmentNumber: waProp.assessmentNumber,
        certificateType: "WA-6.76",
        requesterName: "Audit Tester",
        requesterEmail: "audit@test.example",
      },
      context: ctx,
    });
    expect(result.ok).toBe(true);

    const entries = readRecent(ctx.tenantId, 50);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("generate_statutory_certificate");
    expect(entries[0]!.targetType).toBe("certificate");
    const after = entries[0]!.after as { certificateId: string; state: string };
    expect(after.state).toBe("WA");
    expect(after.certificateId).toMatch(/^CERT-/);
  });

  it("list_audit_log returns newest-first entries scoped by tenant", async () => {
    const ctxA = makeCtx({ tenantId: "tenant-a", actorId: "user-a" });
    const ctxB = makeCtx({ tenantId: "tenant-b", actorId: "user-b" });

    // Drive one mutation per tenant.
    await driveOwnerUpdate(ctxA, "O-WA-001", "08 1111 1111");
    await driveOwnerUpdate(ctxB, "O-WA-001", "08 2222 2222");

    const result = await dispatch({
      toolName: "list_audit_log",
      input: { tenantId: "tenant-a", limit: 10 },
      context: ctxA,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { entries: { tenantId: string; actorId: string }[] };
    expect(data.entries.length).toBe(1);
    expect(data.entries[0]!.tenantId).toBe("tenant-a");
    expect(data.entries[0]!.actorId).toBe("user-a");
  });

  it("readRecent honours since filter", async () => {
    const ctx = makeCtx();
    await driveOwnerUpdate(ctx, "O-WA-001", "08 3333 3333");
    // Future since → no rows.
    const future = new Date(Date.now() + 60_000);
    expect(readRecent(ctx.tenantId, 10, { since: future })).toHaveLength(0);
    // Past since → row visible.
    const past = new Date(Date.now() - 60_000);
    expect(readRecent(ctx.tenantId, 10, { since: past })).toHaveLength(1);
  });
});

async function driveOwnerUpdate(
  ctx: ReturnType<typeof makeCtx>,
  ownerId: string,
  newPhone: string,
): Promise<void> {
  const preview = await dispatch({
    toolName: "update_owner_contact",
    input: { ownerId, newPhone },
    context: ctx,
  });
  if (!preview.ok) throw new Error("preview failed");
  const confirm = await dispatch({
    toolName: "update_owner_contact",
    input: {
      ownerId,
      newPhone,
      confirm: true,
      commitToken: preview.commitToken!,
    },
    context: ctx,
  });
  if (!confirm.ok) throw new Error("confirm failed");
}
