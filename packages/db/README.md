# @ratesassist/db

Phase 2 persistence scaffold for RatesAssist. Drizzle schema + migrations +
RLS-aware client + append-only audit helper. Not yet wired into `apps/web`
or any adapter — that is Phase 2b.

## Setup

```bash
# 1. Provision a Postgres 15+ instance (RDS Sydney recommended; see notes below).
export DATABASE_URL=postgres://app_user:…@host:5432/ratesassist
export RA_USE_DB=true

# 2. Apply the initial migration.
npm run -w @ratesassist/db migrate
#   …or, in dev, just psql -f packages/db/migrations/0001_init.sql

# 3. Seed demo fixtures (idempotent).
npm run -w @ratesassist/db seed
```

## RLS deploy notes

The migration enables and **forces** Row-Level Security on every business
table. The application MUST connect as a non-superuser role. Provision as:

```sql
CREATE ROLE app_user NOINHERIT NOSUPERUSER;
GRANT CONNECT ON DATABASE ratesassist TO app_user;
GRANT USAGE  ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
REVOKE UPDATE, DELETE ON audit_log FROM app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
```

The DBA / migration role applying `0001_init.sql` should be a separate role
(e.g. RDS `rds_superuser`); FORCE ROW LEVEL SECURITY does not apply to
`BYPASSRLS` roles, which is required for migrations and seeding.

Tenant context flows via the `app.tenant_id` Postgres GUC, set per
transaction by `withTenant(db, tenantId, fn)`. Direct queries that bypass
this helper will return zero rows under RLS — by design.

## Encryption-at-rest

Production deploy targets AWS RDS for Postgres in `ap-southeast-2` (Sydney):

- Storage encryption with a customer-managed KMS CMK (no AWS-managed default).
- Automated snapshots encrypted by the same CMK.
- 35-day PITR retention.
- TLS 1.3 enforced via `rds.force_ssl=1`.
- `OFFICIAL:Sensitive` columns (owner contact, transaction amounts,
  property balance/notes) get column-level pgcrypto envelopes in Phase 3.

See `/DATA-CLASSIFICATION.md` for per-field handling.

## Failure modes

This package fails closed:

- `RA_USE_DB=true` and `DATABASE_URL` missing → throws on first `getDb()`.
  Never silently falls back to in-memory.
- Audit insert failure inside `withAudit` rolls back the paired mutation.
- `audit_log` `UPDATE`/`DELETE` revoked at the SQL role level — attempts
  surface as `permission_denied` errors, not silent no-ops.

## Testing

`vitest` against an in-memory pglite database; no real Postgres required:

```bash
npm test --workspace=@ratesassist/db
```

Pglite does NOT enforce role-based privileges, so the audit-log
permission-denied assertion is gated to the real-Postgres staging
integration test.
