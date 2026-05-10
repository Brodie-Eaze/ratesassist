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

## Tamper-evidence

Out of scope for Round 5. The Phase 9 plan adds a hash chain over rows in
occurrence order, with periodic publication of the chain head. The schema
is already compatible: a `prev_hash` + `row_hash` pair will be added
without a backfill (treat NULL as "before the chain head").

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
