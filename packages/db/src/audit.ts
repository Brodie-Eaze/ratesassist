/**
 * Append-only audit helper with tamper-evident hash chain (Phase 9 P0).
 *
 * Every mutation that touches a tenant-scoped table MUST go through
 * {@link withAudit}. The helper:
 *
 *   1. Opens a transaction with the tenant GUC set (via `withTenant`).
 *   2. Calls `target.read(tx)` to capture the `before` snapshot.
 *   3. Runs the user-supplied mutation `fn(tx)`.
 *   4. Calls `target.read(tx)` again to capture the `after` snapshot.
 *   5. Acquires `pg_advisory_xact_lock(hashtext(tenant_id))` so concurrent
 *      writers for the SAME tenant serialise their chain extension. Lock
 *      is per-tenant; writers for different tenants run in parallel.
 *   6. Reads the tenant's chain head row hash (the most recent non-sentinel
 *      `row_hash`). If absent, falls back to `genesisHash(tenant_id)`.
 *   7. Computes `row_hash = chainHash(prev_hash, body)` via the shared
 *      `@ratesassist/audit-core` canonicaliser so the bytes match the
 *      in-memory store byte-identical.
 *   8. Inserts the audit_log row with `prev_hash` + `row_hash` populated.
 *   9. Commits — or rolls back EVERYTHING (mutation, audit row, lock) on
 *      error. The advisory lock auto-releases on commit/rollback.
 *
 * The audit_log table has UPDATE/DELETE revoked at the SQL role level (see
 * migrations/0001_init.sql). The chain columns add tamper-evidence on top:
 * any post-hoc mutation of `before` or `after` will surface as a break at
 * the affected row when the verifier walks the chain.
 *
 * Concurrency note: Postgres advisory locks operate on int64 keys. We
 * derive the key from `hashtext(tenant_id)` (signed int32) and pass it
 * directly to the single-argument `pg_advisory_xact_lock(bigint)`.
 * Collisions across tenants are astronomically rare and harmless (worst
 * case: two unrelated tenants briefly queue each other, then proceed).
 */

import { sql } from "drizzle-orm";

import {
  PRE_CHAIN_SENTINEL,
  chainHash,
  genesisHash,
  type AuditRowWithoutHash,
} from "@ratesassist/audit-core";

import { auditLog } from "./schema.js";
import type { Db } from "./client.js";
import { withTenant } from "./client.js";

export type AuditActorKind = "user" | "service" | "llm";

export interface AuditCtx {
  readonly tenantId: string;
  readonly actorId: string;
  readonly actorKind: AuditActorKind;
  readonly correlationId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
}

export interface AuditTarget<TBefore, TAfter = TBefore> {
  readonly type: string;
  readonly id: string;
  readonly read: (tx: Db) => Promise<TBefore | TAfter | null>;
}

/**
 * Stable v4 UUID generator usable in both Node and (future) Edge runtimes.
 * `crypto.randomUUID()` is built into Node 20 + modern browsers; we wrap it
 * so a future polyfill swap doesn't ripple through callers.
 */
function newAuditRowId(): string {
  return crypto.randomUUID();
}

/**
 * Result row from the chain-head SELECT. We accept either `rows` (pg / pglite
 * over drizzle) or a bare array (some pglite returns). Defensive shape — we
 * only ever read `.row_hash`.
 */
interface HeadRow {
  readonly row_hash: string | null;
}

interface ExecutionResult {
  readonly rows?: ReadonlyArray<HeadRow>;
}

function extractHeadHash(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  // drizzle/pg shape: { rows: [...] }
  const rows =
    (raw as ExecutionResult).rows ??
    (Array.isArray(raw) ? (raw as ReadonlyArray<HeadRow>) : undefined);
  if (!rows || rows.length === 0) return null;
  const head = rows[0]!;
  return head.row_hash ?? null;
}

/**
 * Build the chain-input body for the row about to be inserted. Mirrors the
 * shape that `@ratesassist/audit-core` canonicalises — any field added/removed
 * here MUST land in `AuditRowWithoutHash` first, or hashes diverge.
 */
function buildChainBody(args: {
  readonly id: string;
  readonly ctx: AuditCtx;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly occurredAt: string;
}): AuditRowWithoutHash {
  return {
    id: args.id,
    tenantId: args.ctx.tenantId,
    actorId: args.ctx.actorId,
    actorKind: args.ctx.actorKind,
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    before: args.before,
    after: args.after,
    correlationId: args.ctx.correlationId ?? null,
    ip: args.ctx.ip ?? null,
    userAgent: args.ctx.userAgent ?? null,
    occurredAt: args.occurredAt,
  };
}

/**
 * Guard: refuse sentinel-bearing values from any application writer.
 *
 * Closes pen-test F-010 (Wave 3 / iter4). The `__PRE_CHAIN__` sentinel
 * is stamped ONLY by the 0002 backfill UPDATE on legacy rows. Production
 * application writes through {@link withAudit} or {@link recordAuditEvent}
 * MUST emit a real 64-hex chainHash. If a future writer ever computes
 * the sentinel as a hash value (impossible today, but defence-in-depth)
 * or if a caller tries to forge one, we throw immediately rather than
 * silently inserting a row the verifier would skip.
 *
 * The 0005 migration adds a BEFORE INSERT trigger that catches this at
 * the DB layer as well; this is the application layer.
 */
function assertNotSentinel(prevHash: string, rowHash: string): void {
  if (prevHash === PRE_CHAIN_SENTINEL) {
    throw new Error(
      "audit: refusing to write row with sentinel prev_hash; this value is reserved for the 0002 legacy-row backfill (F-010 lockdown)",
    );
  }
  // The full sentinel shape stamped by 0002 is `__PRE_CHAIN__<uuid>`.
  // Application writers should never emit anything starting with the
  // sentinel prefix; we check the prefix and not the full shape so a
  // typo'd "near-sentinel" can't slip through either.
  if (rowHash.startsWith(PRE_CHAIN_SENTINEL)) {
    throw new Error(
      "audit: refusing to write row with sentinel-prefixed row_hash; this prefix is reserved for the 0002 legacy-row backfill (F-010 lockdown)",
    );
  }
}

/**
 * Acquire the per-tenant advisory lock. Released automatically when the
 * surrounding transaction commits or rolls back. Two calls within the same
 * transaction are idempotent — Postgres tracks advisory locks per-session
 * and reference-counts them.
 *
 * Lock key is derived from `hashtext(tenant_id)` server-side so the same
 * input maps to the same key across all callers (TypeScript would have to
 * reproduce Postgres' hashtext algorithm to derive it client-side; doing
 * it in SQL is one fewer thing to keep in sync).
 *
 * F-012 note (Wave 3, P2 deferred): `hashtext` is a signed int32 hash,
 * so the lock-key space is 2^32. Birthday-paradox math says collision
 * probability hits ~14% at 50k tenants and ~90% at 200k. At pilot scale
 * (≤200 tenants) the false-serialisation risk is negligible. Replace
 * with a 64-bit key when tenant count crosses ~5k.
 */
async function lockTenantChain(tx: Db, tenantId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (tx as any).execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId})::bigint)`,
  );
}

/**
 * Read the tenant's current chain head — the `row_hash` of the row that
 * terminates the chain (the tail). Returns null when no non-sentinel row
 * exists; the caller uses `genesisHash(tenantId)` as the seed in that case.
 *
 * Why NOT `ORDER BY occurred_at DESC, id DESC LIMIT 1` (the previous
 * implementation):
 *   `occurred_at` is stamped from `new Date()` in the application, so a
 *   tight loop of appends — sequential OR concurrent — routinely collides
 *   on the same millisecond. When N rows share the max `occurred_at`, the
 *   `id DESC` tiebreak returns the row with the largest *random* UUID,
 *   which is almost never the genuine chain tail. The next writer then
 *   anchors `prev_hash` to a mid-chain row, FORKING the chain. (Reproduced
 *   deterministically: a purely sequential writer forks ~15/15 at N=100.)
 *   No ORDER BY over a wall-clock or random column can identify the tail
 *   when timestamps tie.
 *
 * The chain itself is the only authority on order. The tail is the unique
 * non-sentinel row whose `row_hash` is referenced by NO sibling's
 * `prev_hash` within the same tenant — i.e. the row nobody chained onto.
 * That definition is independent of `occurred_at`, `id`, and insert order,
 * so it is immune to timestamp collisions.
 *
 * Correctness rests on two invariants this module already enforces under
 * the per-tenant advisory lock held by the caller:
 *   - The chain is linear (each `row_hash` is extended at most once), so
 *     exactly one non-sentinel row is unreferenced — the tail. The query
 *     therefore returns exactly one row (or zero before the first append).
 *   - Sentinel rows (`prev_hash = __PRE_CHAIN__…`, stamped only by the
 *     0002 backfill) are excluded from BOTH the candidate set (outer
 *     `prev_hash <> sentinel`) and the "referenced by" check, so a legacy
 *     sentinel row can never mask the real tail.
 *
 * `LIMIT 1` is defence-in-depth: under the linearity invariant the
 * NOT EXISTS already yields a single row.
 */
async function readChainHead(tx: Db, tenantId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await (tx as any).execute(sql`
    SELECT a.row_hash
      FROM audit_log a
     WHERE a.tenant_id = ${tenantId}
       AND a.prev_hash IS NOT NULL
       AND a.prev_hash <> ${PRE_CHAIN_SENTINEL}
       AND NOT EXISTS (
             SELECT 1
               FROM audit_log b
              WHERE b.tenant_id = a.tenant_id
                AND b.prev_hash = a.row_hash
           )
     LIMIT 1
  `);
  return extractHeadHash(raw);
}

/**
 * Wrap a mutation in a tenant-scoped transaction with before/after audit.
 *
 * Returns whatever `fn` returns. Throws (and rolls back the audit row) on
 * any failure inside `fn` or the audit insert itself. The advisory lock is
 * released automatically by Postgres at transaction end — no explicit
 * unlock call.
 */
export async function withAudit<TBefore, TAfter, TResult>(
  db: Db,
  ctx: AuditCtx,
  action: string,
  target: AuditTarget<TBefore, TAfter>,
  fn: (tx: Db) => Promise<TResult>,
): Promise<TResult> {
  return withTenant(db, ctx.tenantId, async (tx) => {
    const before = await target.read(tx);
    const result = await fn(tx);
    const after = await target.read(tx);

    // Serialise this writer against any other writer extending the SAME
    // tenant's chain. Cross-tenant writers are not blocked.
    await lockTenantChain(tx, ctx.tenantId);
    const head = await readChainHead(tx, ctx.tenantId);
    const prevHash = head ?? genesisHash(ctx.tenantId);

    const id = newAuditRowId();
    const occurredAt = new Date().toISOString();
    const body = buildChainBody({
      id,
      ctx,
      action,
      targetType: target.type,
      targetId: target.id,
      before: before === null ? null : (before as unknown),
      after: after === null ? null : (after as unknown),
      occurredAt,
    });
    const rowHash = chainHash(prevHash, body);

    // F-010 mitigation (Wave 3 pen-test). Belt-and-braces: the DB-level
    // migration 0005 already rejects sentinel-bearing inserts via a
    // trigger, but we also refuse here so the error surfaces with a
    // useful stack and the bad value never even leaves the writer. The
    // sentinel is ONLY stamped by the 0002 backfill UPDATE — production
    // application writes through this function must never emit it.
    assertNotSentinel(prevHash, rowHash);

    await tx.insert(auditLog).values({
      id,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorKind: ctx.actorKind,
      action,
      targetType: target.type,
      targetId: target.id,
      before: body.before === null ? null : (body.before as unknown as object),
      after: body.after === null ? null : (body.after as unknown as object),
      correlationId: ctx.correlationId ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      occurredAt: new Date(occurredAt),
      prevHash,
      rowHash,
    });

    return result;
  });
}

/**
 * Direct insert into the audit log without a paired mutation — for events
 * like "login", "policy decision", "system tick" that don't have a
 * before/after. Still tenant-scoped via {@link withTenant} and still
 * extends the per-tenant hash chain under the advisory lock.
 */
export async function recordAuditEvent(
  db: Db,
  ctx: AuditCtx,
  action: string,
  target: { type: string; id: string },
  payload?: Readonly<Record<string, unknown>>,
): Promise<void> {
  await withTenant(db, ctx.tenantId, async (tx) => {
    await lockTenantChain(tx, ctx.tenantId);
    const head = await readChainHead(tx, ctx.tenantId);
    const prevHash = head ?? genesisHash(ctx.tenantId);

    const id = newAuditRowId();
    const occurredAt = new Date().toISOString();
    const body = buildChainBody({
      id,
      ctx,
      action,
      targetType: target.type,
      targetId: target.id,
      before: null,
      after: payload ?? null,
      occurredAt,
    });
    const rowHash = chainHash(prevHash, body);

    // F-010 mitigation — see withAudit above. Same belt-and-braces.
    assertNotSentinel(prevHash, rowHash);

    await tx.insert(auditLog).values({
      id,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorKind: ctx.actorKind,
      action,
      targetType: target.type,
      targetId: target.id,
      before: null,
      after: payload ? (payload as unknown as object) : null,
      correlationId: ctx.correlationId ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      occurredAt: new Date(occurredAt),
      prevHash,
      rowHash,
    });
  });
}
