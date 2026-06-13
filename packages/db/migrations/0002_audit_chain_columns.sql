-- Phase 9 P0 — audit-log tamper-evident hash chain.
-- STATUS: SHIPPED — applied on every boot via bootstrap.ts MIGRATIONS_IN_ORDER.
-- ("Phase 9 P0" is the authoring work-item tag, not a deployment gate; the
--  hash-chain compute + verify is live today. See SECURITY.md "Audit log".)
--
-- Step 1 of two-step deploy: add columns + indexes, leaving columns NULLABLE
-- so legacy writers continue to function while the verifier walks the new
-- chain on populated rows. Step 2 (0003_audit_chain_validate.sql) flips both
-- columns to NOT NULL after the genesis-marker rebuild verifier confirms.
--
-- Lock impact: minor.
--   - ALTER TABLE … ADD COLUMN with no DEFAULT is a metadata-only operation
--     on PG11+ (no table rewrite).
--   - CHECK constraints use IS NULL OR length(...) so they accept legacy
--     rows during the transition window.
--   - The two index creates use CONCURRENTLY so writers are not blocked.
--
-- Rollback: see 0004_audit_chain_rollback.sql.

-- DDL must live OUTSIDE the CONCURRENTLY block because CONCURRENTLY cannot
-- run inside a transaction. The column adds (no rewrite) are run in their
-- own transaction.
BEGIN;

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS prev_hash text,
  ADD COLUMN IF NOT EXISTS row_hash  text;

-- The CHECK constraints accept NULL (legacy rows during the transition) OR
-- a 64-char hex string (real SHA-256) OR a __PRE_CHAIN__ sentinel for
-- pre-migration rows that were stamped during backfill. Once 0003 lands the
-- IS NULL branch becomes unreachable, but the constraint stays put so any
-- future writer that fails to compute a hash crashes at INSERT time rather
-- than corrupting the chain.
DO $$ BEGIN
  ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_prev_hash_shape
      CHECK (
        prev_hash IS NULL
        OR prev_hash = '__PRE_CHAIN__'
        OR (length(prev_hash) = 64 AND prev_hash ~ '^[0-9a-f]{64}$')
      );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_row_hash_shape
      CHECK (
        row_hash IS NULL
        OR row_hash LIKE '__PRE_CHAIN__%'
        OR (length(row_hash) = 64 AND row_hash ~ '^[0-9a-f]{64}$')
      );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;

-- Forward-chain-walk index: (tenant_id, occurred_at ASC, id ASC). The
-- verifier reads rows in this exact order. The existing
-- audit_log_tenant_occurred_idx (DESC on occurred_at) stays — it serves the
-- "newest N rows" UI reads.
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_tenant_chain_idx
  ON audit_log (tenant_id, occurred_at, id);

-- Partial unique constraint on populated rows: prevents accidental duplicate
-- chain insertion (and any silent-fork bug) without blocking legacy rows
-- whose row_hash is still NULL during the transition. PostgreSQL ignores
-- NULLs in unique-index keys for `IS NULL` filtered indexes, but we keep the
-- WHERE clause explicit so the index purpose is unambiguous in pg_indexes.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS audit_log_tenant_row_hash_unique
  ON audit_log (tenant_id, row_hash)
  WHERE row_hash IS NOT NULL;

-- Genesis-marker table: one row per tenant inserted at migration time. The
-- verifier uses this as the anchor when no prior chain row exists — any
-- subsequent insert chains from genesis_hash(tenant_id). Storing the
-- timestamp makes "when did this tenant's chain start" trivially queryable
-- for compliance reviews.
--
-- Idempotent: re-running the migration is safe; the table is created once
-- and rows are inserted later by the backfill script (or by the first
-- writer that sees an empty chain — withAudit handles the seeding path).
CREATE TABLE IF NOT EXISTS audit_chain_genesis (
  tenant_id uuid PRIMARY KEY,
  genesis_hash text NOT NULL CHECK (length(genesis_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Best-effort: stamp existing audit rows with the __PRE_CHAIN__ sentinel so
-- the verifier knows to skip them. This UPDATE is bounded by the legacy
-- row count and runs in batches in the backfill script; the line below is
-- the safe in-migration fallback for fresh deployments where the table is
-- empty (the UPDATE is a no-op on an empty table).
--
-- Production deployers MUST run packages/db/scripts/backfill-audit-chain.ts
-- BEFORE applying 0003 to ensure no row remains with prev_hash = NULL.
UPDATE audit_log
   SET prev_hash = '__PRE_CHAIN__',
       row_hash  = '__PRE_CHAIN__' || id::text
 WHERE prev_hash IS NULL;
