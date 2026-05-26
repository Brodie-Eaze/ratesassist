# Audit Log

This document describes the audit-log shape, retention, classification, and the
two backing implementations. The shape is identical across both — a downstream
sink can copy entries between them without translation.

## Implementations

| Mode | Backing store | Selected by | Durability |
|------|---------------|-------------|-----------|
| Demo | In-memory FIFO ring buffer (`packages/adapter-demo/src/audit/inMemoryAuditStore.ts`), capped at 10,000 entries | Default; the demo adapter has no DB dependency | Process-lifetime only |
| Production | Postgres `audit_log` table (`packages/db/src/schema.ts`), via `withAudit()` | `RA_USE_DB=true` | Postgres durability + WAL + logical backup |

Both write the same row shape. The Postgres variant additionally:

- Writes the audit row in the **same transaction** as the mutation (atomic).
- Has `UPDATE` and `DELETE` revoked at the SQL role level (see migrations).
- Is tenant-scoped via the Postgres GUC `app.tenant_id` set inside `withTenant`.

## Captured fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `tenantId` | UUID (prod) / string (demo) | Tenant scope; required |
| `actorId` | string | Stable principal id; from session in production |
| `actorKind` | enum: `user` \| `service` \| `llm` | `service` for system tools / health probes |
| `action` | string | Tool name (`update_owner_contact`, `add_property_note`, `generate_statutory_certificate`, `draft_payment_reminder`, `draft_chase_all_overdue`) |
| `targetType` | string | `owner` \| `property` \| `certificate` \| `council` |
| `targetId` | string | Stable id within `targetType` |
| `before` | JSONB \| null | Pre-mutation snapshot; `null` for events without a prior state |
| `after` | JSONB \| null | Post-mutation snapshot |
| `correlationId` | string \| null | Request correlation id; threaded through dispatcher |
| `ip` | string \| null | Originating IP (from `x-forwarded-for` chain) |
| `userAgent` | string \| null | Originating User-Agent header |
| `occurredAt` | timestamptz | Server clock at write time; defaults to `now()` |

## Audited actions (Round 5)

| Action | Mutates state? | Fail-closed? | Target |
|--------|----------------|--------------|--------|
| `update_owner_contact` | Yes (on confirm) | No | `owner` |
| `add_property_note` | Yes (on confirm) | No | `property` |
| `generate_statutory_certificate` | No (read-only output) | **Yes** | `certificate` |
| `draft_payment_reminder` | No (preview only) | No | `property` |
| `draft_chase_all_overdue` | No (batch preview) | No | `council` |

**Read paths are NOT audited in this round.** Read auditing is a Phase 3 deliverable.

## Fail-closed actions

Some mutations are too consequential to silently lose audit attribution.
For those, the handler **refuses to commit** if the audit write fails:

- `generate_statutory_certificate` — emitting an unrecorded statutory document
  is unacceptable; the tool returns `internal_error` if the audit sink is
  unavailable.

All other audited actions are best-effort: a failed audit write is logged at
error level (`audit.write.failed` scope) but does not cascade into a
user-visible mutation failure. This keeps a degraded audit subsystem from
taking down rates operations.

## Retention

- **Demo (in-memory):** process lifetime, capped at 10,000 entries with FIFO
  eviction. Suitable only for development and demo flows.
- **Production (Postgres):** 7 years (target). Backed by daily logical
  backups + a separate write-once archival sink (planned for Phase 2
  finalisation). Configured via the operational runbooks, not in this code.

## Tamper-evidence (Phase 9 P0)

Every audit row carries `prev_hash` and `row_hash` columns, a per-tenant
SHA-256 hash chain. The canonicaliser lives in `@ratesassist/audit-core`
and is shared with the in-memory demo store — both stores produce
byte-identical hashes for the same row body.

- `prev_hash` = the previous row's `row_hash`, or `genesisHash(tenantId)`
  for the first row of a tenant's chain.
- `row_hash`  = SHA-256(prev_hash || canonical(row_without_hashes)).
- Pre-migration rows carry the sentinel `__PRE_CHAIN__`; the verifier
  explicitly skips them and surfaces them as unverifiable legacy history.

### Concurrency

`withAudit()` and `recordAuditEvent()` acquire
`pg_advisory_xact_lock(hashtext(tenant_id))` BEFORE reading the chain
head and inserting the new row. The lock is per-tenant, scoped to the
transaction, and auto-released on commit/rollback. Cross-tenant writers
do not serialise.

### Verifier

`GET /api/audit/verify-chain[?tenantId=…&since=…&limit=…]` walks the
chain forward (using the `audit_log_tenant_chain_idx` index) and
recomputes every hash via the shared canonicaliser. Returns:

- `ok: true, totalRows, latestTs, evictionTruncated: false` — clean chain.
- `ok: true, totalRows, latestTs, evictionTruncated: true` — `since=`
  window cut past genesis; the chain is intact, just not visible from
  this window.
- `ok: false, brokenAt, expectedHash, actualHash, evictionTruncated: false`
  — GENUINE break. Handler logs `audit.chain_break` at error level and
  best-effort captures to Sentry. SEV1 ops alert.

### Migrations

| File | Purpose | Lock impact |
|------|---------|------------|
| `0002_audit_chain_columns.sql` | Add columns (NULLABLE) + indexes (CONCURRENTLY) + sentinel stamp on legacy rows | Minor (metadata adds; no table rewrite) |
| `0003_audit_chain_validate.sql` | NOT NULL via `NOT VALID` + `VALIDATE CONSTRAINT` (no table-rewrite lock) | Moderate (SHARE UPDATE EXCLUSIVE for the validate scan) |
| `0004_audit_chain_rollback.sql` | Pre-written rollback. Drops indexes CONCURRENTLY then columns + constraints. | Brief ACCESS EXCLUSIVE for the column drops |

Deploy order: `0001` → `0002` → backfill verifier confirms the legacy
rows are stamped + a `audit_chain_genesis` row exists per tenant → `0003`.
The chain-aware writer (`withAudit`) is gated behind a feature flag
(`AUDIT_CHAIN_ENABLED`) so it can be disabled while `0002` columns are
nullable; rollback to legacy INSERTs is a feature-flag flip, not a
schema change.

## Data classification

Audit rows are classified **PROTECTED**. They contain:

- Owner & property identifiers (PROTECTED)
- Phone/email values in `before`/`after` snapshots (PROTECTED)
- IP and User-Agent (PROTECTED — pseudonymous identifiers)

Access is gated by the `read.audit_log` permission (rates_supervisor,
council_admin, platform_admin). The `/api/audit/log` route enforces tenant
isolation: only `platform_admin` may read another tenant's entries.

## Read API

```
GET /api/audit/log?limit=50&since=<ISO-8601>&tenantId=<tenant>
```

- **Auth:** session required (middleware-enforced)
- **RBAC:** `read.audit_log` (supervisor or above)
- **Tenant scoping:** `tenantId` query-param override allowed only for
  `platform_admin`
- **Pagination:** `limit` clamped to [1, 500]
- **ETag:** weak ETag based on `(tenantId, count, latestId)`; clients can
  poll with `If-None-Match` for cheap diff detection
- **Returns:** `{ ok: true, data: { entries: AuditEntry[] } }`, newest-first

## Tooling

The same surface is also exposed as the `list_audit_log` MCP tool (see
`packages/contract/src/schemas.ts`). The tool is intentionally not
RBAC-aware — it trusts its caller. The HTTP route is the canonical
authorisation boundary.
