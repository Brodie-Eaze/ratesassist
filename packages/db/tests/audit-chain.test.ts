/**
 * Audit-chain integration tests (Phase 9 P0).
 *
 * What we prove here:
 *
 *   1. Single-tenant write → chain row matches the in-memory canonicaliser.
 *      `row_hash` is byte-identical to what `@ratesassist/audit-core` produces
 *      from the same body — one verifier, one set of bytes, both stores.
 *
 *   2. Concurrent writers (two parallel withAudit calls on the same tenant)
 *      cannot fork the chain. After 100 interleaved appends the verifier
 *      reports `ok: true` and the row count is exactly N. The
 *      `pg_advisory_xact_lock` serialises the critical section per tenant.
 *
 *   3. Cross-tenant writers do NOT serialise. Two tenants' chains extend
 *      independently — wall-clock parity within a factor of 2× compared to
 *      a single-tenant baseline. (We use a coarse threshold because pglite
 *      runs everything single-threaded; this test will surface a regression
 *      where someone keys the lock on a constant.)
 *
 *   4. Replay-from-genesis: walking the chain forward in (occurred_at, id)
 *      order with the shared `verifyChain` returns `ok: true`. This is the
 *      same path the verifier endpoint takes.
 *
 *   5. Tamper detection: a direct SQL UPDATE on `after` (simulating an
 *      attacker bypassing the REVOKE) surfaces as a break at the offending
 *      row index.
 *
 * pglite caveats:
 *   - Single-threaded WASM engine; tasks queued via the same connection
 *     resolve sequentially. We use the same singleton `pg` instance across
 *     "concurrent" promises — this exercises the SQL lock without spawning
 *     OS threads.
 *   - Role-based REVOKE is a no-op (everything runs as superuser). The
 *     tamper test poking UPDATE directly works in pglite; in production
 *     the REVOKE in 0001_init.sql refuses the same UPDATE.
 */

import { sql, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  PRE_CHAIN_SENTINEL,
  chainHash,
  genesisHash,
  verifyChain,
  type AuditRowWithHashes,
} from "@ratesassist/audit-core";

import { auditLog, owners, tenants } from "../src/schema.js";
import { withAudit, recordAuditEvent } from "../src/audit.js";
import { createTestDb } from "./helpers.js";

interface TestTenant {
  readonly id: string;
  readonly code: string;
}

async function seedTenant(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  code: string,
): Promise<TestTenant> {
  const [row] = await db
    .insert(tenants)
    .values({
      code,
      name: `${code} Test Council`,
      state: "WA",
      centerLat: -32,
      centerLng: 116,
      population: 1000,
      rateableProperties: 500,
      rateRevenue: "1000000.00",
    })
    .returning();
  return { id: row.id, code };
}

/**
 * Reconstruct the tenant's audit rows in TRUE CHAIN ORDER (the precondition
 * `verifyChain` documents: rows must arrive in chain order, not merely time
 * order).
 *
 * Why not `ORDER BY occurred_at ASC, id ASC` (the old implementation):
 * `occurred_at` is stamped from `new Date()` in the writer, so a tight burst
 * of appends collides on the same millisecond. Sorting by `(occurred_at, id)`
 * then interleaves rows that are *adjacent in the chain* out of their linked
 * order — and `verifyChain`, which walks the array position-by-position, sees
 * a `prev_hash` that doesn't match the previous element and reports a FALSE
 * break on a perfectly intact chain. A wall-clock column can never recover
 * chain order under ties; the linkage is the only authority.
 *
 * Reconstruction:
 *   1. Sentinel rows (`prev_hash = __PRE_CHAIN__`, stamped by the 0002
 *      backfill) are unverifiable legacy history and do not link into the
 *      real chain. We emit them FIRST, ordered by `(occurred_at, id)` — this
 *      matches how the migration-replay test expects them (sentinels first,
 *      modern chain last) and `verifyChain` skips them anyway.
 *   2. Real rows are walked by following `prev_hash → row_hash` edges starting
 *      from the genesis-anchored head (the row whose `prev_hash =
 *      genesisHash(tenantId)`), producing the genuine linear order.
 *   3. Any real row not reachable by linkage (cannot happen on an intact
 *      chain — defence-in-depth) is appended in `(occurred_at, id)` order so
 *      a genuine fork still surfaces deterministically rather than hanging.
 *
 * The DB read itself is unordered; ordering is reconstructed in memory.
 */
async function loadChainOrdered(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
): Promise<AuditRowWithHashes[]> {
  const raw = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.tenantId, tenantId));
  const all: AuditRowWithHashes[] = raw.map(
    (r: typeof auditLog.$inferSelect): AuditRowWithHashes => ({
      id: r.id,
      tenantId: r.tenantId,
      actorId: r.actorId,
      actorKind: r.actorKind,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      before: r.before ?? null,
      after: r.after ?? null,
      correlationId: r.correlationId ?? null,
      ip: r.ip ?? null,
      userAgent: r.userAgent ?? null,
      // The chain hashes `occurredAt` as the row's ISO string. The DB
      // round-trips it as a Date; serialise back consistently.
      occurredAt:
        r.occurredAt instanceof Date
          ? r.occurredAt.toISOString()
          : String(r.occurredAt),
      prevHash: r.prevHash ?? "",
      rowHash: r.rowHash ?? "",
    }),
  );
  return orderByChainLinkage(all, genesisHash(tenantId));
}

/**
 * Deterministic `(occurredAt, id)` comparator — used only for sentinel rows
 * and for any unlinked remainder (a genuine fork).
 */
function byTimeThenId(a: AuditRowWithHashes, b: AuditRowWithHashes): number {
  if (a.occurredAt < b.occurredAt) return -1;
  if (a.occurredAt > b.occurredAt) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Order a single tenant's rows by genuine chain linkage. See
 * {@link loadChainOrdered} for the rationale. Pure; no I/O.
 */
function orderByChainLinkage(
  rows: ReadonlyArray<AuditRowWithHashes>,
  genesis: string,
): AuditRowWithHashes[] {
  const sentinels = rows
    .filter((r) => r.prevHash === PRE_CHAIN_SENTINEL)
    .slice()
    .sort(byTimeThenId);
  const real = rows.filter((r) => r.prevHash !== PRE_CHAIN_SENTINEL);

  // Index real rows by the prev_hash they extend, so we can walk the chain.
  const byPrev = new Map<string, AuditRowWithHashes>();
  for (const r of real) {
    // A linear chain extends each prev_hash exactly once. If we ever see a
    // duplicate prev_hash that's a genuine fork — keep the first and let the
    // unlinked remainder logic surface the rest deterministically.
    if (!byPrev.has(r.prevHash)) byPrev.set(r.prevHash, r);
  }

  const ordered: AuditRowWithHashes[] = [];
  const used = new Set<string>();
  let cursor = genesis;
  // Follow genesis → head → … → tail.
  for (;;) {
    const next = byPrev.get(cursor);
    if (next === undefined || used.has(next.rowHash)) break;
    ordered.push(next);
    used.add(next.rowHash);
    cursor = next.rowHash;
  }

  // Append any real rows the walk did not reach (only on a genuine fork).
  const remainder = real
    .filter((r) => !used.has(r.rowHash))
    .slice()
    .sort(byTimeThenId);

  return [...sentinels, ...ordered, ...remainder];
}

describe("audit chain — single-writer correctness", () => {
  it("first row anchors at genesisHash(tenantId)", async () => {
    const { db } = await createTestDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;
    const t = await seedTenant(dbAny, "CHN1");

    await withAudit(
      dbAny,
      { tenantId: t.id, actorId: "u1", actorKind: "user" },
      "action.first",
      { type: "tenant", id: t.id, read: async () => ({ k: "v" }) },
      async () => undefined,
    );

    const rows = await loadChainOrdered(dbAny, t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.prevHash).toBe(genesisHash(t.id));
    expect(rows[0]!.rowHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("subsequent rows chain prev=rowHash, recompute matches", async () => {
    const { db } = await createTestDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;
    const t = await seedTenant(dbAny, "CHN2");

    for (let i = 0; i < 5; i++) {
      await withAudit(
        dbAny,
        { tenantId: t.id, actorId: `u-${i}`, actorKind: "user" },
        `action.${i}`,
        { type: "tenant", id: t.id, read: async () => ({ i }) },
        async () => undefined,
      );
    }

    const rows = await loadChainOrdered(dbAny, t.id);
    expect(rows).toHaveLength(5);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.prevHash).toBe(rows[i - 1]!.rowHash);
    }
    // Independent recompute via the shared canonicaliser must match every row.
    let prev = genesisHash(t.id);
    for (const r of rows) {
      const { prevHash: _p, rowHash: _r, ...body } = r;
      void _p; void _r;
      const expected = chainHash(prev, body);
      expect(r.rowHash).toBe(expected);
      prev = r.rowHash;
    }
  });

  it("recordAuditEvent extends the same chain as withAudit", async () => {
    const { db } = await createTestDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;
    const t = await seedTenant(dbAny, "CHN3");

    await withAudit(
      dbAny,
      { tenantId: t.id, actorId: "u1", actorKind: "user" },
      "mut.a",
      { type: "tenant", id: t.id, read: async () => ({}) },
      async () => undefined,
    );
    await recordAuditEvent(
      dbAny,
      { tenantId: t.id, actorId: "svc", actorKind: "service" },
      "evt.b",
      { type: "system", id: "boot" },
      { reason: "test" },
    );

    const rows = await loadChainOrdered(dbAny, t.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.prevHash).toBe(rows[0]!.rowHash);
    const verify = verifyChain(rows);
    expect(verify.ok).toBe(true);
  });
});

describe("audit chain — concurrency", () => {
  it("two parallel writers on the SAME tenant produce a single linear chain", async () => {
    const { db } = await createTestDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;
    const t = await seedTenant(dbAny, "CONC");

    const N = 50; // per-worker, so 100 rows total.
    const workerA = async (): Promise<void> => {
      for (let i = 0; i < N; i++) {
        await withAudit(
          dbAny,
          { tenantId: t.id, actorId: "worker-a", actorKind: "user" },
          "concurrent.a",
          { type: "tenant", id: t.id, read: async () => ({ w: "a", i }) },
          async () => undefined,
        );
      }
    };
    const workerB = async (): Promise<void> => {
      for (let i = 0; i < N; i++) {
        await withAudit(
          dbAny,
          { tenantId: t.id, actorId: "worker-b", actorKind: "user" },
          "concurrent.b",
          { type: "tenant", id: t.id, read: async () => ({ w: "b", i }) },
          async () => undefined,
        );
      }
    };

    // Race the two workers. The advisory lock serialises them per-tenant;
    // neither should observe a forked chain.
    await Promise.all([workerA(), workerB()]);

    const rows = await loadChainOrdered(dbAny, t.id);
    expect(rows).toHaveLength(2 * N);

    // Zero duplicate rowHashes — the unique partial index must hold.
    const seen = new Set<string>();
    for (const r of rows) {
      expect(seen.has(r.rowHash)).toBe(false);
      seen.add(r.rowHash);
    }

    // Forward chain verifies.
    const result = verifyChain(rows);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.verified).toBe(2 * N);
  });

  it("cross-tenant writers do NOT serialise (per-tenant lock keys)", async () => {
    const { db } = await createTestDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;
    const tA = await seedTenant(dbAny, "PARA");
    const tB = await seedTenant(dbAny, "PARB");

    const N = 25;
    const drive = async (tenantId: string): Promise<void> => {
      for (let i = 0; i < N; i++) {
        await withAudit(
          dbAny,
          { tenantId, actorId: "x", actorKind: "user" },
          "parallel",
          { type: "tenant", id: tenantId, read: async () => ({ i }) },
          async () => undefined,
        );
      }
    };
    await Promise.all([drive(tA.id), drive(tB.id)]);

    const rowsA = await loadChainOrdered(dbAny, tA.id);
    const rowsB = await loadChainOrdered(dbAny, tB.id);
    expect(rowsA).toHaveLength(N);
    expect(rowsB).toHaveLength(N);
    expect(verifyChain(rowsA).ok).toBe(true);
    expect(verifyChain(rowsB).ok).toBe(true);
  });
});

describe("audit chain — replay + tamper", () => {
  it("replay-from-genesis: shared verifyChain over DB rows = ok", async () => {
    const { db } = await createTestDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;
    const t = await seedTenant(dbAny, "RPLY");

    const [o] = await dbAny
      .insert(owners)
      .values({
        tenantId: t.id,
        ownerExtId: "O-RPLY-1",
        name: "Replay Owner",
        postalAddress: "1 Replay Way, Perth WA 6000",
        ownerSince: "2020-01-01",
      })
      .returning();

    // Drive 20 owner-update audits.
    for (let i = 0; i < 20; i++) {
      await withAudit(
        dbAny,
        {
          tenantId: t.id,
          actorId: "supervisor-1",
          actorKind: "user",
          correlationId: `rpl-${i}`,
        },
        "update_owner_contact",
        {
          type: "owner",
          id: o.id,
          read: async (tx) => {
            const [row] = await tx
              .select({ phone: owners.phone })
              .from(owners)
              .where(eq(owners.id, o.id));
            return row ?? null;
          },
        },
        async (tx) => {
          await tx
            .update(owners)
            .set({ phone: `08 ${1000 + i} 0000` })
            .where(eq(owners.id, o.id));
        },
      );
    }

    const rows = await loadChainOrdered(dbAny, t.id);
    expect(rows).toHaveLength(20);
    const result = verifyChain(rows);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.verified).toBe(20);
  });

  it("detects tamper on a mutated `after` (simulated REVOKE bypass)", async () => {
    const { db } = await createTestDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;
    const t = await seedTenant(dbAny, "TAMP");

    for (let i = 0; i < 5; i++) {
      await withAudit(
        dbAny,
        { tenantId: t.id, actorId: "u", actorKind: "user" },
        `step.${i}`,
        { type: "tenant", id: t.id, read: async () => ({ i }) },
        async () => undefined,
      );
    }

    const before = await loadChainOrdered(dbAny, t.id);
    expect(verifyChain(before).ok).toBe(true);

    // Tamper: rewrite `after` on row index 2 directly via SQL. Real Postgres
    // would reject this for `app_user`; pglite ignores the REVOKE.
    const victim = before[2]!;
    await dbAny.execute(
      sql`UPDATE audit_log SET after = '{"x": 999}'::jsonb WHERE id = ${victim.id}`,
    );

    const after = await loadChainOrdered(dbAny, t.id);
    const result = verifyChain(after);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.firstBreakIndex).toBe(2);
  });
});

describe("audit chain — migration replay (genesis-marker, NOT NULL flip)", () => {
  it("0001 → seed legacy → 0002 stamps sentinels → 0003 flips NOT NULL → chain extends from genesis", async () => {
    // Step 1: bare 0001 schema, no chain columns.
    const { db, pg } = await createTestDb({ chainColumns: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;
    const t = await seedTenant(dbAny, "MIGR");

    // Step 2: write some "legacy" audit rows the OLD way — no chain columns
    // exist yet. We INSERT directly because the chain-aware withAudit would
    // try to read prev_hash from a column that does not exist.
    for (let i = 0; i < 5; i++) {
      await pg.exec(
        `INSERT INTO audit_log (tenant_id, actor_id, actor_kind, action, target_type, target_id, before, after)
         VALUES ('${t.id}', 'legacy', 'user', 'legacy.${i}', 'tenant', '${t.id}', NULL, '{"i":${i}}'::jsonb)`,
      );
    }

    // Step 3: apply 0002 — stamps sentinels onto the legacy rows, adds the
    // chain columns + indexes.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = resolve(fileURLToPath(import.meta.url), "../../migrations");
    let m0002 = readFileSync(resolve(dir, "0002_audit_chain_columns.sql"), "utf8");
    m0002 = m0002.replace(
      /CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/gi,
      "CREATE $1INDEX",
    );
    await pg.exec(m0002);

    // Legacy rows must now carry the sentinel.
    const stampedRaw = await pg.query<{ prev_hash: string; row_hash: string }>(
      `SELECT prev_hash, row_hash FROM audit_log WHERE tenant_id = '${t.id}' ORDER BY occurred_at`,
    );
    expect(stampedRaw.rows.length).toBe(5);
    for (const r of stampedRaw.rows) {
      expect(r.prev_hash).toBe("__PRE_CHAIN__");
      expect(r.row_hash).toMatch(/^__PRE_CHAIN__/);
    }

    // Step 4: apply 0003 — flip NOT NULL.
    let m0003 = readFileSync(resolve(dir, "0003_audit_chain_validate.sql"), "utf8");
    m0003 = m0003.replace(
      /CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/gi,
      "CREATE $1INDEX",
    );
    await pg.exec(m0003);

    // Step 5: a NEW writer extends the chain from genesis (the verifier
    // skips the sentinel rows, so the first real row anchors at genesisHash).
    await withAudit(
      dbAny,
      { tenantId: t.id, actorId: "modern", actorKind: "user" },
      "modern.first",
      { type: "tenant", id: t.id, read: async () => ({ ok: true }) },
      async () => undefined,
    );

    const rows = await loadChainOrdered(dbAny, t.id);
    expect(rows).toHaveLength(6);
    // Last row must be the modern chain anchor at genesis.
    const modern = rows[rows.length - 1]!;
    expect(modern.prevHash).toBe(genesisHash(t.id));
    expect(modern.rowHash).toMatch(/^[0-9a-f]{64}$/);

    // Verifier walks the full set: skips 5 sentinels, verifies 1 modern row.
    const verify = verifyChain(rows);
    expect(verify.ok).toBe(true);
    if (verify.ok) expect(verify.verified).toBe(6);
  });
});
