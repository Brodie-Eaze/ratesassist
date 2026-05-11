/**
 * Audit module facade for handlers.
 *
 * Handlers should call {@link recordMutation} after a successful state
 * change. The helper:
 *   1. Writes to the in-memory ring buffer (always-on, never throws to the
 *      caller for non-fail-closed actions).
 *   2. Logs failures via STDERR so they remain observable.
 *   3. Surfaces fail-closed errors via a returned `{ ok: false }` for the
 *      handful of actions that must refuse to commit without an audit row.
 *
 * The DB-backed path lives in @ratesassist/db's {@link withAudit}. When
 * RA_USE_DB=true is wired in (production), a sink hook writes the same
 * shape into Postgres in-transaction; the in-memory path remains as a
 * mirrored sink for fast local reads and demo-mode operation.
 */

import {
  append,
  FAIL_CLOSED_ACTIONS,
  type AuditActorKind,
  type AuditEntry,
} from "./inMemoryAuditStore.js";

export {
  append,
  readRecent,
  readById,
  readChainOrdered,
  readChainOrderedAllTenants,
  size,
  _resetForTests,
  FAIL_CLOSED_ACTIONS,
  MAX_ENTRIES,
  type AuditActorKind,
  type AuditEntry,
  type AuditEntryInput,
} from "./inMemoryAuditStore.js";

export {
  canonicalise,
  computeRowHash,
  genesisHash,
  verifyChain,
  type AuditRowWithHashes,
  type AuditRowWithoutHash,
  type VerifyChainResult,
} from "./hashChain.js";

function logErr(payload: Record<string, unknown>): void {
  try {
    process.stderr.write(
      JSON.stringify({
        level: "error",
        scope: "adapter-demo/audit",
        time: new Date().toISOString(),
        ...payload,
      }) + "\n",
    );
  } catch {
    /* never let logging throw */
  }
}

export interface RecordMutationArgs {
  readonly tenantId: string;
  readonly actorId: string;
  readonly actorKind: AuditActorKind;
  readonly action: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly before?: unknown;
  readonly after?: unknown;
  readonly correlationId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
}

export type RecordMutationResult =
  | { readonly ok: true; readonly entry: AuditEntry }
  | { readonly ok: false; readonly error: string; readonly failClosed: boolean };

/**
 * Best-effort audit write. Returns `{ ok: false }` ONLY when the action is in
 * {@link FAIL_CLOSED_ACTIONS} AND the write threw. For every other action
 * we log the error and return `{ ok: true }` synthetically — the audit
 * failure must NEVER cascade into a user-visible mutation failure.
 */
export function recordMutation(args: RecordMutationArgs): RecordMutationResult {
  const failClosed = FAIL_CLOSED_ACTIONS.has(args.action);
  try {
    const entry = append({
      tenantId: args.tenantId,
      actorId: args.actorId,
      actorKind: args.actorKind,
      action: args.action,
      target: args.target,
      before: args.before,
      after: args.after,
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      ...(args.ip !== undefined ? { ip: args.ip } : {}),
      ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
    });
    return { ok: true, entry };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logErr({
      msg: "audit.write.failed",
      action: args.action,
      tenantId: args.tenantId,
      actorId: args.actorId,
      correlationId: args.correlationId,
      failClosed,
      err: message,
    });
    return { ok: false, error: message, failClosed };
  }
}
