/**
 * Hash-chain primitives — byte-identical-output guarantees.
 *
 * The whole point of lifting hashChain.ts into a shared package is so that
 * both the in-memory store (packages/adapter-demo) and the Postgres-backed
 * sink (packages/db) hash byte-identical inputs. One verifier walks both.
 *
 * These tests are the contract for that guarantee. They do NOT exercise the
 * stores themselves — those have their own integration tests. What they
 * prove:
 *
 *   1. Canonicalisation is byte-identical for two independently-built rows
 *      whose property values are identical but whose key-insertion order
 *      differs. This is the round-trip every store must survive
 *      (JSONB → JS object → canonicalise) without drift.
 *   2. computeRowHash output is byte-identical across two independent call
 *      sites in the same process AND across the same payload re-encoded
 *      through JSON.parse / stringify (proxying a DB round-trip).
 *   3. Sentinel handling (__PRE_CHAIN__) skips legacy rows without
 *      advancing the per-tenant chain expectation.
 *   4. The verifier surfaces the FIRST break index, not the last.
 */

import { describe, expect, it } from "vitest";

import {
  PRE_CHAIN_SENTINEL,
  canonicalise,
  canonicalize,
  chainHash,
  computeRowHash,
  genesisHash,
  verifyChain,
  type AuditRowWithHashes,
  type AuditRowWithoutHash,
} from "../src/index.js";

function fixtureRow(over: Partial<AuditRowWithoutHash> = {}): AuditRowWithoutHash {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "alpha",
    actorId: "user-1",
    actorKind: "user",
    action: "update_owner_contact",
    targetType: "owner",
    targetId: "O-WA-001",
    before: { phone: "08 0000 0000", email: "old@example.test" },
    after: { phone: "08 9999 9999", email: "new@example.test" },
    correlationId: "corr-1",
    ip: "10.0.0.1",
    userAgent: "vitest/1.0",
    occurredAt: "2026-05-26T10:00:00.000Z",
    ...over,
  };
}

describe("canonicalise — byte-identical guarantee", () => {
  it("US-English alias matches the Australian spelling", () => {
    const row = fixtureRow();
    expect(canonicalize(row)).toBe(canonicalise(row));
  });

  it("sorts keys recursively — top-level reorder is a no-op", () => {
    const a = fixtureRow();
    const reorderedTop: AuditRowWithoutHash = {
      // Same fields, different insertion order.
      occurredAt: a.occurredAt,
      userAgent: a.userAgent,
      ip: a.ip,
      correlationId: a.correlationId,
      after: a.after,
      before: a.before,
      targetId: a.targetId,
      targetType: a.targetType,
      action: a.action,
      actorKind: a.actorKind,
      actorId: a.actorId,
      tenantId: a.tenantId,
      id: a.id,
    };
    expect(canonicalise(reorderedTop)).toBe(canonicalise(a));
  });

  it("sorts keys recursively — nested reorder is a no-op", () => {
    const a = fixtureRow({ after: { a: 1, b: 2, c: { x: 1, y: 2 } } });
    const b = fixtureRow({ after: { c: { y: 2, x: 1 }, b: 2, a: 1 } });
    expect(canonicalise(b)).toBe(canonicalise(a));
  });

  it("survives a JSONB round-trip without drift", () => {
    // Mimic what the Postgres-backed store sees after the driver hydrates
    // the JSONB column: a fresh JS object built from JSON.parse. The
    // verifier MUST hash this to the same bytes as the in-memory store
    // saw on the way in.
    const row = fixtureRow();
    const hopped = JSON.parse(JSON.stringify(row)) as AuditRowWithoutHash;
    expect(canonicalise(hopped)).toBe(canonicalise(row));
  });

  it("treats undefined / NaN / Infinity as null", () => {
    const row = fixtureRow({ after: { ok: true, bad: Number.NaN } });
    // NaN serialises to "null" in canonicalise() — equality with a row that
    // explicitly stores null is the contract.
    const explicit = fixtureRow({ after: { ok: true, bad: null } });
    expect(canonicalise(row)).toBe(canonicalise(explicit));
  });
});

describe("computeRowHash — byte-identical across callers", () => {
  it("chainHash alias matches computeRowHash", () => {
    const row = fixtureRow();
    const prev = genesisHash(row.tenantId);
    expect(chainHash(prev, row)).toBe(computeRowHash(prev, row));
  });

  it("two independently-built rows with the same content produce the same hash", () => {
    const a = fixtureRow();
    // Build via a different code path: spread + explicit field-by-field
    // copy (proxies "row built by the in-memory store" vs "row built by
    // the SQL hydrator"). Field values are identical.
    const b: AuditRowWithoutHash = {
      id: a.id,
      tenantId: a.tenantId,
      actorId: a.actorId,
      actorKind: a.actorKind,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      // before/after intentionally rebuilt with a different key order to
      // prove canonicalisation does its job.
      before: { email: "old@example.test", phone: "08 0000 0000" },
      after: { email: "new@example.test", phone: "08 9999 9999" },
      correlationId: a.correlationId,
      ip: a.ip,
      userAgent: a.userAgent,
      occurredAt: a.occurredAt,
    };
    const prev = genesisHash(a.tenantId);
    expect(computeRowHash(prev, a)).toBe(computeRowHash(prev, b));
  });

  it("output is a 64-char lowercase hex sha256", () => {
    const row = fixtureRow();
    const h = computeRowHash(genesisHash(row.tenantId), row);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("any byte change in the row produces a different hash", () => {
    const row = fixtureRow();
    const prev = genesisHash(row.tenantId);
    const baseline = computeRowHash(prev, row);
    expect(computeRowHash(prev, fixtureRow({ action: "x" }))).not.toBe(baseline);
    expect(
      computeRowHash(prev, fixtureRow({ after: { phone: "08 9999 9998" } })),
    ).not.toBe(baseline);
    expect(computeRowHash("0".repeat(64), row)).not.toBe(baseline);
  });
});

describe("genesisHash — deterministic per tenant", () => {
  it("is deterministic and tenant-specific", () => {
    expect(genesisHash("alpha")).toBe(genesisHash("alpha"));
    expect(genesisHash("alpha")).not.toBe(genesisHash("beta"));
    expect(genesisHash("alpha")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyChain", () => {
  function buildChain(
    tenantId: string,
    count: number,
  ): AuditRowWithHashes[] {
    const out: AuditRowWithHashes[] = [];
    let prevHash = genesisHash(tenantId);
    for (let i = 0; i < count; i++) {
      const body: AuditRowWithoutHash = fixtureRow({
        tenantId,
        action: `action-${i}`,
        targetId: `target-${i}`,
        occurredAt: `2026-05-26T10:00:0${i}.000Z`,
      });
      const rowHash = computeRowHash(prevHash, body);
      out.push({ ...body, prevHash, rowHash });
      prevHash = rowHash;
    }
    return out;
  }

  it("returns ok for an untouched chain", () => {
    const rows = buildChain("alpha", 5);
    const r = verifyChain(rows);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verified).toBe(5);
  });

  it("surfaces the FIRST break — not the last", () => {
    const rows = buildChain("alpha", 5);
    // Tamper rows 1 AND 3 — the verifier must report 1.
    const tampered: AuditRowWithHashes[] = rows.map((r, i) =>
      i === 1 || i === 3 ? { ...r, after: { tampered: i } } : r,
    );
    const result = verifyChain(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.firstBreakIndex).toBe(1);
  });

  it("skips PRE_CHAIN_SENTINEL rows but still verifies real ones", () => {
    const tenantId = "alpha";
    // Mix: one legacy row, then a real chain starting at genesis.
    const legacy: AuditRowWithHashes = {
      ...fixtureRow({ tenantId, occurredAt: "2026-01-01T00:00:00.000Z" }),
      prevHash: PRE_CHAIN_SENTINEL,
      rowHash: `${PRE_CHAIN_SENTINEL}-legacy-id`,
    };
    const real = buildChain(tenantId, 3);
    const rows = [legacy, ...real];
    const r = verifyChain(rows);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verified).toBe(4);
  });

  it("treats cross-tenant segments as independent chains", () => {
    const alpha = buildChain("alpha", 3);
    const beta = buildChain("beta", 3);
    // Interleave to prove the verifier groups by tenant.
    const mixed: AuditRowWithHashes[] = [
      alpha[0]!,
      beta[0]!,
      alpha[1]!,
      beta[1]!,
      alpha[2]!,
      beta[2]!,
    ];
    expect(verifyChain(mixed).ok).toBe(true);
  });
});
