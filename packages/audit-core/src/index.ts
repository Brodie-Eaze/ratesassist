/**
 * @ratesassist/audit-core — tamper-evident audit hash-chain primitives.
 *
 * Shared between the in-memory adapter store (packages/adapter-demo) and the
 * Postgres-backed sink (packages/db). Both callers MUST hash byte-identical
 * inputs — one verifier walks both stores.
 *
 * Do NOT change {@link canonicalise} or {@link genesisHash} without a
 * coordinated chain rebuild — every row stored under a different
 * canonicalisation is permanently unverifiable.
 *
 * Algorithm: SHA-256 only (node:crypto). HMAC and signature variants are
 * deliberately out of scope here — the chain protects against post-hoc
 * mutation of recorded rows, not against a malicious process that controls
 * the writer.
 *
 * Australian English throughout; no external dependencies beyond node:crypto.
 */

import { createHash } from "node:crypto";

/**
 * Shape of an audit row before its prevHash/rowHash are appended. This is
 * what {@link canonicalise} hashes — keep it stable across versions or the
 * verifier breaks for stored rows.
 *
 * Mirrors the Postgres `audit_log` row 1:1 minus the hash columns and the
 * in-memory `AuditEntry`. Adding fields here changes every future hash —
 * existing rows must be migrated via a genesis-marker rebuild (see
 * AUDIT-CHAIN-POSTGRES-DESIGN.md §5).
 */
export interface AuditRowWithoutHash {
  readonly id: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly actorKind: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly correlationId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly occurredAt: string;
}

export interface AuditRowWithHashes extends AuditRowWithoutHash {
  readonly prevHash: string;
  readonly rowHash: string;
}

/**
 * Sentinel `prevHash`/`rowHash` value used for rows that pre-date the chain
 * migration. The verifier explicitly skips rows whose prevHash matches this
 * sentinel — they are legacy, unverifiable history (see design §5).
 *
 * Stored as plain text (NOT a 64-char hex) so the unique partial index
 * `(tenant_id, row_hash) WHERE row_hash IS NOT NULL` does not treat them as
 * collisions with real hashes.
 */
export const PRE_CHAIN_SENTINEL = "__PRE_CHAIN__";

/** Genesis seed hash for the first row of a tenant's chain. */
export function genesisHash(tenantId: string): string {
  return createHash("sha256")
    .update(`RATESASSIST_AUDIT_CHAIN_GENESIS_${tenantId}`, "utf8")
    .digest("hex");
}

/**
 * Deterministic JSON canonicalisation: keys sorted alphabetically at every
 * object level, no insignificant whitespace, arrays preserve order.
 *
 * Pure-function recursion; safe for the row shape above (no cycles, no
 * functions, no Dates — occurredAt is already an ISO string).
 */
export function canonicalise(row: AuditRowWithoutHash): string {
  return stableStringify(row);
}

/** Back-compat alias for callers using the US-English spelling. */
export const canonicalize = canonicalise;

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
        .join(",") +
      "}"
    );
  }
  // undefined / function / bigint / symbol — coerce to null for stability.
  return "null";
}

/** Compute the next row hash given the previous hash and the row body. */
export function computeRowHash(
  prevHash: string,
  row: AuditRowWithoutHash,
): string {
  return createHash("sha256")
    .update(prevHash, "utf8")
    .update(canonicalise(row), "utf8")
    .digest("hex");
}

/**
 * Back-compat alias matching the design-doc terminology. Semantically
 * identical to {@link computeRowHash}.
 */
export const chainHash = computeRowHash;

export type VerifyChainResult =
  | { readonly ok: true; readonly verified: number }
  | {
      readonly ok: false;
      readonly firstBreakIndex: number;
      readonly expectedHash: string;
      readonly actualHash: string;
    };

/**
 * Walk the rows in reading order and recompute each hash. The caller is
 * responsible for passing rows already sorted by (occurredAt ASC, id ASC).
 *
 * Rows whose `prevHash` equals {@link PRE_CHAIN_SENTINEL} are SKIPPED —
 * they are pre-migration history (see design §5). The verifier treats the
 * first non-sentinel row as the start of the verifiable window for that
 * tenant; its expected `prevHash` is {@link genesisHash} for the tenant.
 *
 * The first non-sentinel row's expected prevHash is {@link genesisHash} for
 * its tenant. If two adjacent rows belong to different tenants the verifier
 * treats each tenant's segment as its own chain — practical for multi-tenant
 * dumps. Rows are grouped by tenantId and verified in arrival order within
 * each tenant.
 */
export function verifyChain(
  rows: ReadonlyArray<AuditRowWithHashes>,
): VerifyChainResult {
  // Track per-tenant expected prev hash; first time we see a tenant we seed
  // with the genesis hash. The break index is the global row index so the
  // caller can locate the offending row in their original list.
  const expectedPrevByTenant = new Map<string, string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    // Pre-chain rows are not verifiable; skip them but do NOT advance the
    // per-tenant expectation — the next non-sentinel row anchors against
    // genesis (or the previously-verified head, whichever applies).
    if (row.prevHash === PRE_CHAIN_SENTINEL) continue;

    const expectedPrev =
      expectedPrevByTenant.get(row.tenantId) ?? genesisHash(row.tenantId);
    if (row.prevHash !== expectedPrev) {
      return {
        ok: false,
        firstBreakIndex: i,
        expectedHash: expectedPrev,
        actualHash: row.prevHash,
      };
    }
    const { prevHash: _p, rowHash: _r, ...body } = row;
    void _p;
    void _r;
    const expectedRowHash = computeRowHash(expectedPrev, body);
    if (row.rowHash !== expectedRowHash) {
      return {
        ok: false,
        firstBreakIndex: i,
        expectedHash: expectedRowHash,
        actualHash: row.rowHash,
      };
    }
    expectedPrevByTenant.set(row.tenantId, row.rowHash);
  }
  return { ok: true, verified: rows.length };
}

/**
 * Deterministic `(occurredAt, id)` comparator. Used ONLY as a tiebreak for
 * sentinel rows and for any unlinked remainder — never as the primary chain
 * order. Wall-clock cannot recover chain order under same-instant ties.
 */
function byOccurredThenId(
  a: AuditRowWithHashes,
  b: AuditRowWithHashes,
): number {
  if (a.occurredAt < b.occurredAt) return -1;
  if (a.occurredAt > b.occurredAt) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Reconstruct ONE tenant's audit rows into genuine CHAIN order by following
 * `prevHash → rowHash` linkage, so {@link verifyChain} never raises a FALSE
 * break when two chain-adjacent rows share an `occurredAt` millisecond.
 *
 * Why this exists: callers fetch audit rows with `ORDER BY occurred_at, id`.
 * `occurredAt` comes from `new Date()`, so a burst of writes collides on the
 * same millisecond; the wall-clock sort then interleaves chain-adjacent rows
 * out of linked order and `verifyChain` — which walks position-by-position —
 * reports a break on a perfectly intact chain. The hash linkage is the only
 * authority on order; this function recovers it before verification.
 *
 * Handles the three real shapes:
 *   1. Full chain — the head is the row anchored at `genesis` (its `prevHash`
 *      is produced by no other in-set row).
 *   2. Eviction-truncated window (`since=` queries) — the genesis-anchored row
 *      is NOT present; the head is instead the earliest row whose `prevHash`
 *      is produced by no in-set row. Linearises correctly from there.
 *   3. Genuine fork / deleted row / tamper — cannot be fully linearised; the
 *      unreachable rows are appended in `(occurredAt, id)` order so the break
 *      still surfaces deterministically rather than being masked.
 *
 * Sentinel rows (`prevHash === PRE_CHAIN_SENTINEL`) are legacy, unverifiable
 * history; emitted FIRST (verifyChain skips them) in `(occurredAt, id)` order.
 *
 * Pure; single-tenant input — group by tenantId before calling.
 *
 * @param rows    one tenant's rows, in any order
 * @param genesis optional `genesisHash(tenantId)`; when supplied AND present in
 *                the set it is preferred as the walk anchor (the common full-
 *                chain case). Omit (or absent) → head is discovered structurally.
 */
export function orderByChainLinkage(
  rows: ReadonlyArray<AuditRowWithHashes>,
  genesis?: string,
): AuditRowWithHashes[] {
  const sentinels = rows
    .filter((r) => r.prevHash === PRE_CHAIN_SENTINEL)
    .slice()
    .sort(byOccurredThenId);
  const real = rows.filter((r) => r.prevHash !== PRE_CHAIN_SENTINEL);

  // Index real rows by the prevHash they extend so we can walk the chain. A
  // linear chain extends each prevHash exactly once; on a fork keep the first
  // and let the remainder logic surface the rest deterministically.
  const byPrev = new Map<string, AuditRowWithHashes>();
  const producedHashes = new Set<string>();
  for (const r of real) {
    if (!byPrev.has(r.prevHash)) byPrev.set(r.prevHash, r);
    producedHashes.add(r.rowHash);
  }

  // Pick the walk anchor. Prefer the genesis-anchored head (full chain). If
  // genesis isn't present (eviction window), the head is the row whose prevHash
  // no in-set row produced — i.e. the earliest unanchored row. A well-formed
  // window has exactly one such head.
  let start: string | undefined;
  if (genesis !== undefined && byPrev.has(genesis)) {
    start = genesis;
  } else {
    const heads = real
      .filter((r) => !producedHashes.has(r.prevHash))
      .slice()
      .sort(byOccurredThenId);
    start = heads.length > 0 ? heads[0]!.prevHash : undefined;
  }

  const ordered: AuditRowWithHashes[] = [];
  const used = new Set<string>();
  if (start !== undefined) {
    let cursor = start;
    for (;;) {
      const next = byPrev.get(cursor);
      if (next === undefined || used.has(next.rowHash)) break;
      ordered.push(next);
      used.add(next.rowHash);
      cursor = next.rowHash;
    }
  }

  // Anything the walk did not reach (only on a genuine fork / deletion) is
  // appended deterministically so verifyChain still reports the break.
  const remainder = real
    .filter((r) => !used.has(r.rowHash))
    .slice()
    .sort(byOccurredThenId);

  return [...sentinels, ...ordered, ...remainder];
}
