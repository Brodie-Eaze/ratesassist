-- Phase 9 P0 — audit-log hash chain rollback (pre-written, sitting there).
--
-- Apply ONLY if the chain rollout produces unrecoverable production
-- impact. The intended runbook (design §6):
--
--   1. Disable the chain writer via feature flag (AUDIT_CHAIN_ENABLED=false);
--      legacy INSERTs still succeed because prev_hash / row_hash are
--      NULLABLE during the transition window — they revert to NULL.
--   2. Diagnose. Most likely defect is canonicaliser drift; fix in code.
--   3. Only if the chain itself is unrecoverable: run THIS file.
--
-- Lock impact: column drops require ACCESS EXCLUSIVE briefly; indexes are
-- dropped CONCURRENTLY so writers are not blocked.
--
-- Reversible: yes — re-apply 0002, then 0003. Existing audit rows survive;
-- chain data is lost.

-- Drop indexes first (CONCURRENTLY — no writer block).
DROP INDEX CONCURRENTLY IF EXISTS audit_log_tenant_chain_idx;
DROP INDEX CONCURRENTLY IF EXISTS audit_log_tenant_row_hash_unique;

BEGIN;

-- Drop CHECK constraints. Use guarded DO blocks so the rollback succeeds
-- even if a partial 0002/0003 left only some of them in place.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_prev_hash_present;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_row_hash_present;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_prev_hash_shape;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_row_hash_shape;

-- Drop the hash columns. Existing audit row content (action, before/after,
-- ts, etc.) is preserved — only the chain columns vanish.
ALTER TABLE audit_log
  DROP COLUMN IF EXISTS prev_hash,
  DROP COLUMN IF EXISTS row_hash;

-- Drop the genesis-marker table. It carries no business data — every row
-- is reconstructible from genesisHash(tenant_id) in code.
DROP TABLE IF EXISTS audit_chain_genesis;

COMMIT;
