/**
 * Tamper-evident audit hash chain.
 *
 * Every audit row carries two derived fields:
 *   - prevHash: the rowHash of the immediately preceding row (per tenant), or
 *     {@link genesisHash} for the first row in the chain.
 *   - rowHash:  sha256(prevHash + canonical(row_without_hash_fields)).
 *
 * The verifier walks rows in append/reading order (the caller-provided
 * sequence — typically insertion order, which is the canonical chain order
 * since occurredAt may tie at sub-ms resolution). The first divergence
 * surfaces both the expected and the actual hash so the caller can pinpoint
 * the tamper site.
 *
 * Algorithm: SHA-256 only (node:crypto). HMAC and signature variants are
 * deliberately out of scope here — the chain protects against post-hoc
 * mutation of recorded rows, not against a malicious process that controls
 * the writer. Production tamper-evidence requires the row to be sealed into
 * an append-only persistent store (Phase 9); the in-memory variant supports
 * verification only over the un-evicted prefix.
 *
 * Australian English throughout; no external dependencies.
 */

import { createHash } from "node:crypto";

/**
 * Shape of an audit row before its prevHash/rowHash are appended. This is
 * what {@link canonicalise} hashes — keep it stable across versions or the
 * verifier breaks for stored rows.
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
 * The first row's expected prevHash is {@link genesisHash} for its tenant.
 * If two adjacent rows belong to different tenants the verifier treats
 * each tenant's segment as its own chain — practical for multi-tenant
 * dumps. Rows are grouped by tenantId and verified in arrival order
 * within each tenant.
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
