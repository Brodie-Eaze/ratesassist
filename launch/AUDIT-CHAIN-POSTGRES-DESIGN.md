# Audit Chain — Postgres Design (Phase 9 P0)

Owner: db-architect. Implementation: senior-eng. Authoritative chain algorithm
is `packages/adapter-demo/src/audit/hashChain.ts` — DO NOT change `canonicalise`
or `genesisHash`; Postgres rows must hash byte-identical to the in-memory path
so one verifier walks both. Lift `hashChain.ts` into a new shared package
`@ratesassist/audit-core`; both `adapter-demo` and `db` import from there.

## 1. Schema change

Drizzle (`packages/db/src/schema.ts`, `auditLog`): add two `text` columns
(sha256 hex = 64 chars; `text` matches the in-memory `string`):

```ts
prevHash: text("prev_hash").notNull(),
rowHash:  text("row_hash").notNull(),
tenantChainIdx: index("audit_log_tenant_chain_idx").on(
  t.tenantId, t.occurredAt, t.id,
),
tenantRowHashUnique: uniqueIndex("audit_log_tenant_row_hash_unique").on(
  t.tenantId, t.rowHash,
),
```

Migration `packages/db/migrations/0002_audit_chain.sql`:

```sql
BEGIN;
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS prev_hash text,
  ADD COLUMN IF NOT EXISTS row_hash  text,
  ADD CONSTRAINT audit_log_prev_hash_len
    CHECK (prev_hash IS NULL OR length(prev_hash) = 64),
  ADD CONSTRAINT audit_log_row_hash_len
    CHECK (row_hash  IS NULL OR length(row_hash)  = 64);
COMMIT;

CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_tenant_chain_idx
  ON audit_log (tenant_id, occurred_at, id);
-- Partial: enforces dedup only on populated rows so the migration ships
-- before backfill completes.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS audit_log_tenant_row_hash_unique
  ON audit_log (tenant_id, row_hash) WHERE row_hash IS NOT NULL;
```

Follow-up `0003_audit_chain_not_null.sql` (post-backfill) flips both columns to
`SET NOT NULL`. The existing `audit_log_tenant_occurred_idx` stays for "newest
N rows" UI reads; the new index is for forward chain walks (ASC).

## 2. Append flow — pseudocode

Inside the existing `withTenant(...)` callback, after capturing `after`:

```ts
const lockKey = bigintFromTenantUuid(ctx.tenantId);  // see §3
await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

const [head] = await tx.execute(sql`
  SELECT row_hash FROM audit_log
   WHERE tenant_id = ${ctx.tenantId}
     AND prev_hash <> '__PRE_CHAIN__'
   ORDER BY occurred_at DESC, id DESC LIMIT 1`);
const prevHash = head?.row_hash ?? genesisHash(ctx.tenantId);

const body: AuditRowWithoutHash = {
  id: randomUUID(), tenantId: ctx.tenantId,
  actorId: ctx.actorId, actorKind: ctx.actorKind, action,
  targetType: target.type, targetId: target.id,
  before: before ?? null, after: after ?? null,
  correlationId: ctx.correlationId ?? null,
  ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null,
  occurredAt: new Date().toISOString(),
};
const rowHash = computeRowHash(prevHash, body);
await tx.insert(auditLog).values({ ...body, prevHash, rowHash });
```

`recordAuditEvent` uses the same flow. Isolation stays `READ COMMITTED`; the
advisory lock serialises the critical section. `SERIALIZABLE` would add
false-positive retries for unrelated tenants.

## 3. Concurrency

| Option | Verdict |
|---|---|
| `SELECT ... FOR UPDATE` on chain head | Reject. Head row is moving — every writer locks a different row; deadlock-prone under burst. |
| Optimistic + retry on unique violation | **Reject — incorrect.** Two distinct concurrent appends both compute valid `row_hash` against the same `prev_hash`; neither violates `(tenant_id, row_hash)` and the chain forks silently. |
| **Postgres `pg_advisory_xact_lock` keyed on tenant_id** | **Adopt.** One lock per audit write, auto-released at commit/rollback, serialised per-tenant, fully parallel across tenants. |

Lock key: `BigInt('0x' + sha256(tenantId).slice(0, 16))` cast to signed int64.
Contention is per-tenant; 50 concurrent writers see microsecond queueing —
acceptable since audit is off the user hot path for non-`FAIL_CLOSED_ACTIONS`.

## 4. Verifier endpoint

`GET /api/audit/verify-chain?limit=10000&since=<ISO>` — auth-required, tenant
from session.

Algorithm:
1. Read rows: `SELECT ... FROM audit_log WHERE tenant_id=$1 [AND occurred_at >= $since] ORDER BY occurred_at ASC, id ASC LIMIT $limit` (uses new index).
2. Rehydrate as `AuditRowWithHashes`; call `verifyChain(rows)` from `hashChain.ts`.
3. Inspect row 0:
   - `prev_hash === genesisHash(tenantId)` → intact from creation; any later break is **tamper**.
   - `prev_hash !== genesisHash(...)` with `since` given → expected; flag `truncated: true`, derive `ok` from window-internal consistency.
   - `prev_hash !== genesisHash(...)` on full scan → **genuine break** (genesis row deleted in violation of `REVOKE DELETE` — compliance incident).

Response:
```ts
{ ok: boolean, totalRows: number, latestTs: string,
  brokenAt?: number, expectedHash?: string, actualHash?: string,
  truncated?: boolean, windowStart?: string }
```

**Records Act 2000 (WA) flag.** s28 requires preservation of state records.
The endpoint distinguishes:
- **Eviction-truncated** (`truncated: true`, window-internal `ok: true`) — legitimate caller-scoped window; not a breach.
- **Genuinely broken** (full-scan `ok: false`, or row 0 `prev_hash` mismatch on full scan) — chain tampered or row deleted. Endpoint returns HTTP 200 with `ok: false`; API layer ALSO writes an `audit_chain_break_detected` event (best-effort, chains forward from the break) and emits SEV1 ops alert. Wiring the alert path is senior-eng's call.

## 5. Migration risk — existing rows

**Recommend Option (b), genesis-marker per tenant.**

Existing rows were written without ever running the chain algorithm — there's
no canonical `prev_hash` they "should" have. Backfilling with computed hashes
(option a) **invents history**: hashes attest only that we ran the canonicaliser
today, not that originals are tamper-free. That's worse than no chain — it
gives false assurance.

Option (b) is honest: insert one `audit_chain_genesis` row per tenant at the
migration timestamp, with `prev_hash = genesisHash(tenantId)` and `row_hash =
computeRowHash(prev_hash, body)`. All subsequent appends chain from it.
Pre-migration rows are stamped sentinel `prev_hash='__PRE_CHAIN__'` and
`row_hash='__PRE_CHAIN__' || id` to satisfy NOT NULL — verifier skips them and
surfaces as "legacy, unverifiable". This matches the demo store's eviction
semantics.

Backfill script `packages/db/scripts/backfill-audit-chain.ts`:
1. `UPDATE audit_log SET prev_hash='__PRE_CHAIN__', row_hash='__PRE_CHAIN__'||id::text WHERE prev_hash IS NULL`.
2. For each tenant: compute genesis row in TS using the shared canonicaliser, INSERT it. Idempotent — skip if a genesis row already exists.

Then ship `0003_audit_chain_not_null.sql`.

Option (a) rejected: hours of writer downtime to produce hashes that prove
nothing about originals — unjustifiable.

## 6. Rollback

If `0002` breaks production:
1. **Stop the writer** via feature flag `AUDIT_CHAIN_ENABLED=false`; writers revert to legacy INSERT (columns nullable, partial unique index — legacy inserts still work).
2. **Leave columns nullable; do NOT drop.** Reads unaffected.
3. **Diagnose.** Most likely defect is canonicaliser drift (JSONB `null` round-trip, key ordering, timestamp formatting). Fix in code, redeploy, re-verify against in-memory store.
4. Only after the chain is proven, ship `0003` to enforce NOT NULL.

If unrecoverable, `0004_audit_chain_revert.sql` drops indexes CONCURRENTLY then
the constraints and columns.

Lock impact: `0002` **minor** (metadata column add; CHECK is `OR IS NULL`).
`0003` **major** at scale — use `NOT NULL NOT VALID` then `VALIDATE CONSTRAINT`
online. Windows: `0002` off-peak; `0003` maintenance. Reversible: yes.

## 7. Testing strategy — blockers

1. **Algorithm parity.** 100 rows through in-memory store + same payloads through new `withAudit`; assert `row_hash` byte-equal.
2. **Concurrent-write.** Two workers, same tenant, 1000 rows each. After: full-chain verify passes; row count = 2000 (+ genesis); zero forks; zero `(tenant_id, row_hash)` violations.
3. **Cross-tenant parallelism.** Two tenants, two workers, 1000 rows each. Wall-clock within 1.2x single-tenant baseline — proves advisory lock doesn't serialise across tenants.
4. **Verifier endpoint.**
   - Happy: 50 rows → `{ok:true, totalRows:51}`.
   - Tampered: `UPDATE audit_log SET after='{"x":1}' WHERE id=$3` (test DB; prod has REVOKE) → `{ok:false, brokenAt:3, expectedHash, actualHash}`.
   - Truncated: `since=` past genesis → `{ok:true, truncated:true}`.
5. **Migration-replay.** `0001` → seed 500 legacy rows → `0002` → backfill → `0003`; assert schema, sentinels, one genesis per tenant, forward chain verifies.
6. **Rollback dry-run.** Apply `0002`, write 100 chained rows, apply `0004`; rows survive, hash columns vanish.
7. **`FAIL_CLOSED_ACTIONS`.** Forced advisory-lock deadlock in `generate_statutory_certificate` must roll back the parent — auto-release on tx rollback is the guarantee; assert via test.

CI gate (merge): 1, 2, 4, 5. Deploy gate (prod): + 3, 6, 7.

## Files touched

- `/Users/Brodie/RatesAssist/packages/db/src/schema.ts`
- `/Users/Brodie/RatesAssist/packages/db/src/audit.ts`
- `/Users/Brodie/RatesAssist/packages/db/migrations/0002_audit_chain.sql` (new)
- `/Users/Brodie/RatesAssist/packages/db/migrations/0003_audit_chain_not_null.sql` (new, post-backfill)
- `/Users/Brodie/RatesAssist/packages/db/migrations/0004_audit_chain_revert.sql` (new, rollback only)
- `/Users/Brodie/RatesAssist/packages/db/scripts/backfill-audit-chain.ts` (new)
- `/Users/Brodie/RatesAssist/packages/audit-core/` (new shared package, lifted from `adapter-demo/src/audit/hashChain.ts`)
- `apps/api/.../audit/verify-chain.ts` (new route)
- `/Users/Brodie/RatesAssist/packages/db/tests/audit-chain.spec.ts` (new, all of §7)
