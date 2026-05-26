-- 0005_audit_chain_sentinel_lockdown.sql
--
-- Closes pen-test F-010 (Wave 3 / iter4).
--
-- The original migration 0002 introduced `__PRE_CHAIN__` as a sentinel
-- prev_hash / row_hash value to mark legacy audit rows that pre-date the
-- chain. The CHECK constraints accepted the sentinel for any row — which
-- means any future writer (or any directly-issued INSERT against the
-- table) could stamp NEW rows with the sentinel and have them silently
-- skipped by the verifier. That defeats the headline tamper-evidence
-- claim of the chain entirely.
--
-- This migration locks the sentinel down in two ways:
--
--   1. The CHECK on `row_hash` is tightened from `LIKE '__PRE_CHAIN__%'`
--      to the exact legitimate shape stamped by 0002:
--      `'__PRE_CHAIN__' || <uuid>`. Random strings starting with the
--      sentinel are now rejected.
--
--   2. A BEFORE INSERT trigger refuses any sentinel-bearing row for a
--      tenant that already has an `audit_chain_genesis` entry — i.e.
--      after the chain has been opened for that tenant, no new row may
--      claim sentinel status. The 0002 backfill is the only legitimate
--      writer of sentinel rows; it runs BEFORE genesis is seeded.
--
-- Defence in depth: the application-level `withAudit` writer also
-- refuses to emit sentinel values (see packages/db/src/audit.ts). The
-- DB trigger catches the case where a future writer bypasses withAudit
-- entirely.
--
-- Rollback path: drop the trigger + function + tightened CHECK; the
-- original 0002 CHECKs remain in place under a different name. See
-- 0006_audit_chain_sentinel_lockdown_rollback.sql (placeholder — not yet
-- written; the rollback is straightforward but currently undocumented).

BEGIN;

-- Drop the loose row_hash check from 0002 and replace with the tight one.
ALTER TABLE audit_log
  DROP CONSTRAINT IF EXISTS audit_log_row_hash_shape;

-- New tight check: row_hash is EITHER the literal sentinel followed by a
-- UUID (the exact shape 0002 stamps) OR a 64-hex hash. Random strings
-- starting with the sentinel prefix (e.g. '__PRE_CHAIN__attacker') are
-- now rejected by the constraint.
DO $$ BEGIN
  ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_row_hash_shape
      CHECK (
        row_hash IS NULL
        OR row_hash ~ '^__PRE_CHAIN__[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR (length(row_hash) = 64 AND row_hash ~ '^[0-9a-f]{64}$')
      );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Trigger function: refuse sentinel-bearing inserts when the tenant's
-- chain has already been opened (i.e. an audit_chain_genesis row exists
-- for the tenant). The 0002 backfill UPDATE bypasses BEFORE INSERT
-- triggers because it's an UPDATE — so the legitimate sentinel stamping
-- in 0002 still works.
CREATE OR REPLACE FUNCTION audit_log_reject_sentinel_after_genesis()
RETURNS trigger AS $$
BEGIN
  IF NEW.prev_hash = '__PRE_CHAIN__'
     OR (NEW.row_hash IS NOT NULL AND NEW.row_hash LIKE '\___PRE_CHAIN\____%' ESCAPE '\') THEN
    IF EXISTS (SELECT 1 FROM audit_chain_genesis WHERE tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION
        'audit_log: cannot insert sentinel-marked row for tenant % after chain genesis (F-010 lockdown)',
        NEW.tenant_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_sentinel_lockdown ON audit_log;
CREATE TRIGGER audit_log_sentinel_lockdown
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_sentinel_after_genesis();

COMMIT;
