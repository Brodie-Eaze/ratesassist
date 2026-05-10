/**
 * Append-only audit helper.
 *
 * Every mutation that touches a tenant-scoped table MUST go through
 * {@link withAudit}. The helper:
 *
 *   1. Opens a transaction with the tenant GUC set (via `withTenant`).
 *   2. Calls `target.read(tx)` to capture the `before` snapshot.
 *   3. Runs the user-supplied mutation `fn(tx)`.
 *   4. Calls `target.read(tx)` again to capture the `after` snapshot.
 *   5. Inserts an audit_log row in the SAME transaction.
 *   6. Commits — or rolls back everything (including the audit row) on error.
 *
 * The audit_log table has `UPDATE` and `DELETE` revoked at the SQL role
 * level (see migrations/0001_init.sql). This file does not perform either
 * operation; doing so would surface as a permission_denied error in prod.
 */

import { sql } from "drizzle-orm";

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
 * Wrap a mutation in a tenant-scoped transaction with before/after audit.
 *
 * Returns whatever `fn` returns. Throws (and rolls back the audit row) on
 * any failure inside `fn` or the audit insert itself.
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

    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorKind: ctx.actorKind,
      action,
      targetType: target.type,
      targetId: target.id,
      before: before === null ? null : (before as unknown as object),
      after: after === null ? null : (after as unknown as object),
      correlationId: ctx.correlationId ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    return result;
  });
}

/**
 * Direct insert into the audit log without a paired mutation — for events
 * like "login", "policy decision", "system tick" that don't have a before/after.
 * Still tenant-scoped via {@link withTenant}.
 */
export async function recordAuditEvent(
  db: Db,
  ctx: AuditCtx,
  action: string,
  target: { type: string; id: string },
  payload?: Readonly<Record<string, unknown>>,
): Promise<void> {
  await withTenant(db, ctx.tenantId, async (tx) => {
    await tx.insert(auditLog).values({
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
    });
    // Touch sql to keep the import used in case future tx-level checks land here.
    void sql;
  });
}
