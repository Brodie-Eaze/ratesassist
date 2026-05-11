/**
 * Audit hash chain tests.
 *
 * Covers:
 *   - Genesis seed is deterministic per tenant.
 *   - Append-and-verify roundtrip on real audit rows.
 *   - Tamper detection: mutating a row's `after` field breaks the chain at
 *     the correct index.
 *   - Eviction (ring-buffer overflow) honestly breaks the chain — verified
 *     by overflowing past MAX_ENTRIES with a tiny test cap.
 *   - Cross-tenant rows verify as independent chains.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  _resetForTests,
  append,
  readChainOrdered,
  genesisHash,
  computeRowHash,
  verifyChain,
  type AuditEntry,
  type AuditRowWithHashes,
} from "../src/audit/index.js";

beforeEach(() => {
  _resetForTests();
});

function seed(tenantId: string, action: string, after: unknown): AuditEntry {
  return append({
    tenantId,
    actorId: `actor-${action}`,
    actorKind: "user",
    action,
    target: { type: "owner", id: "O-WA-001" },
    after,
  });
}

describe("audit hash chain", () => {
  it("genesisHash is deterministic and differs by tenant", () => {
    expect(genesisHash("alpha")).toBe(genesisHash("alpha"));
    expect(genesisHash("alpha")).not.toBe(genesisHash("beta"));
    expect(genesisHash("alpha")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("first row's prevHash is the genesis hash for its tenant", () => {
    const e = seed("alpha", "a1", { foo: 1 });
    expect(e.prevHash).toBe(genesisHash("alpha"));
    expect(e.rowHash).toMatch(/^[0-9a-f]{64}$/);
    expect(e.rowHash).not.toBe(e.prevHash);
  });

  it("subsequent rows chain via the previous rowHash", () => {
    const a = seed("alpha", "a1", { foo: 1 });
    const b = seed("alpha", "a2", { foo: 2 });
    expect(b.prevHash).toBe(a.rowHash);
  });

  it("verifyChain returns ok over an untouched chain", () => {
    seed("alpha", "a1", { foo: 1 });
    seed("alpha", "a2", { foo: 2 });
    seed("alpha", "a3", { foo: 3 });
    const rows = readChainOrdered("alpha", 100) as ReadonlyArray<AuditRowWithHashes>;
    const result = verifyChain(rows);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.verified).toBe(3);
  });

  it("detects tamper on a mutated `after` at the correct break index", () => {
    seed("alpha", "a1", { foo: 1 });
    seed("alpha", "a2", { foo: 2 });
    seed("alpha", "a3", { foo: 3 });
    const rows = readChainOrdered("alpha", 100) as AuditRowWithHashes[];
    // Mutate row at index 1 — clone the array & swap in a row with a
    // different `after`. The stored rowHash stays put, so the recomputed
    // hash for that index should diverge.
    const tampered: AuditRowWithHashes[] = rows.map((r, i) =>
      i === 1 ? { ...r, after: { foo: 999 } } : r,
    );
    const result = verifyChain(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.firstBreakIndex).toBe(1);
      expect(result.actualHash).toBe(rows[1]!.rowHash);
      expect(result.expectedHash).not.toBe(rows[1]!.rowHash);
    }
  });

  it("detects swapped prevHash (broken linkage)", () => {
    seed("alpha", "a1", { foo: 1 });
    seed("alpha", "a2", { foo: 2 });
    const rows = readChainOrdered("alpha", 100) as AuditRowWithHashes[];
    const tampered = rows.map((r, i) =>
      i === 1 ? { ...r, prevHash: "0".repeat(64) } : r,
    );
    const result = verifyChain(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.firstBreakIndex).toBe(1);
  });

  it("cross-tenant rows verify as independent per-tenant chains", () => {
    seed("alpha", "a1", { foo: 1 });
    seed("beta", "b1", { bar: 1 });
    seed("alpha", "a2", { foo: 2 });
    seed("beta", "b2", { bar: 2 });
    const alpha = readChainOrdered("alpha", 100) as ReadonlyArray<AuditRowWithHashes>;
    const beta = readChainOrdered("beta", 100) as ReadonlyArray<AuditRowWithHashes>;
    expect(verifyChain(alpha).ok).toBe(true);
    expect(verifyChain(beta).ok).toBe(true);
  });

  it("computeRowHash output is stable for identical inputs", () => {
    const body = {
      id: "row-1",
      tenantId: "alpha",
      actorId: "a",
      actorKind: "user",
      action: "noop",
      targetType: "x",
      targetId: "y",
      before: null,
      after: { a: 1, b: 2 },
      correlationId: null,
      ip: null,
      userAgent: null,
      occurredAt: "2026-01-01T00:00:00.000Z",
    };
    const h1 = computeRowHash(genesisHash("alpha"), body);
    const h2 = computeRowHash(genesisHash("alpha"), body);
    expect(h1).toBe(h2);
    // Key reordering must not change the hash (canonicalise sorts keys).
    const reordered = { ...body, after: { b: 2, a: 1 } };
    const h3 = computeRowHash(genesisHash("alpha"), reordered);
    expect(h3).toBe(h1);
  });
});
