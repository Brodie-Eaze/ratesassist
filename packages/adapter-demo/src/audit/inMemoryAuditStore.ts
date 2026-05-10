/**
 * In-memory append-only audit ring buffer.
 *
 * Demo-mode audit log. Production switches to the Postgres-backed path in
 * @ratesassist/db (see {@link withAudit}); the row shape here is
 * schema-compatible so a downstream sink can copy these forward.
 *
 * - Append-only via {@link append}; no update/delete API.
 * - Capped at {@link MAX_ENTRIES} (10_000); oldest entries are evicted FIFO.
 * - In-memory only — entries vanish on process restart. Acceptable for the
 *   demo adapter; production must wire the DB sink.
 *
 * Best-effort writes: callers should never let a failed audit-write fail the
 * underlying mutation (except for fail-closed actions; see
 * {@link FAIL_CLOSED_ACTIONS}).
 */

import { randomUUID } from "node:crypto";

export const MAX_ENTRIES = 10_000;

/**
 * Actions that MUST have a successful audit write to be considered
 * complete. If the in-memory store ever throws (it shouldn't, but defensive)
 * the handler refuses to commit. Statutory certificate generation is the
 * canonical example: an unrecorded certificate creation is unacceptable.
 */
export const FAIL_CLOSED_ACTIONS: ReadonlySet<string> = new Set([
  "generate_statutory_certificate",
]);

export type AuditActorKind = "user" | "service" | "llm";

export interface AuditEntryInput {
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

export interface AuditEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly actorKind: AuditActorKind;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly correlationId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly occurredAt: string; // ISO-8601
}

/**
 * Module-scoped FIFO buffer. We keep insertion order via array push and
 * evict from the front when capacity is reached. Lookup-by-id uses a
 * Map mirror for O(1) reads.
 */
const buffer: AuditEntry[] = [];
const byId: Map<string, AuditEntry> = new Map();

function nowIso(now?: () => Date): string {
  return (now ?? (() => new Date()))().toISOString();
}

/**
 * Append one entry. Always succeeds (it would have to allocate fail to
 * throw). Returns the assigned id so callers can correlate downstream.
 */
export function append(
  input: AuditEntryInput,
  opts?: { readonly now?: () => Date },
): AuditEntry {
  const entry: AuditEntry = {
    id: randomUUID(),
    tenantId: input.tenantId,
    actorId: input.actorId,
    actorKind: input.actorKind,
    action: input.action,
    targetType: input.target.type,
    targetId: input.target.id,
    before: input.before ?? null,
    after: input.after ?? null,
    correlationId: input.correlationId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    occurredAt: nowIso(opts?.now),
  };
  buffer.push(entry);
  byId.set(entry.id, entry);
  if (buffer.length > MAX_ENTRIES) {
    const evicted = buffer.shift();
    if (evicted) byId.delete(evicted.id);
  }
  return entry;
}

/**
 * Read the most recent N entries for a tenant, newest first.
 */
export function readRecent(
  tenantId: string,
  limit: number,
  opts?: { readonly since?: Date },
): readonly AuditEntry[] {
  const sinceMs = opts?.since ? opts.since.getTime() : -Infinity;
  // Walk newest-first; break early when we have enough.
  const out: AuditEntry[] = [];
  for (let i = buffer.length - 1; i >= 0 && out.length < limit; i--) {
    const e = buffer[i]!;
    if (e.tenantId !== tenantId) continue;
    if (Date.parse(e.occurredAt) < sinceMs) continue;
    out.push(e);
  }
  return out;
}

export function readById(id: string): AuditEntry | undefined {
  return byId.get(id);
}

/** Total entries currently held (across tenants). For tests + diagnostics. */
export function size(): number {
  return buffer.length;
}

/** Test helper — clears the buffer between cases. */
export function _resetForTests(): void {
  buffer.length = 0;
  byId.clear();
}
