-- 0008_audit_log_truncate_lockdown.sql
--
-- Closes a gap in the append-only guarantee of the tamper-evident audit
-- chain.
--
-- 0001 and 0006 both `REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC` so the
-- recorded rows cannot be rewritten or removed one-by-one. But TRUNCATE is a
-- SEPARATE PostgreSQL privilege that those REVOKEs do NOT cover, and it is
-- uniquely dangerous to an audit chain:
--
--   * TRUNCATE removes EVERY row in a single statement — the entire chain,
--     all tenants at once.
--   * TRUNCATE BYPASSES Row-Level Security, so the per-tenant policies do not
--     contain its blast radius.
--   * TRUNCATE does NOT fire ROW-level (BEFORE DELETE) triggers, so the 0005
--     sentinel-lockdown trigger never sees it.
--
-- The result: a single `TRUNCATE audit_log` — from an injected statement, a
-- mis-scoped migration, or an ops fat-finger — silently destroys the headline
-- tamper-evidence claim with none of the existing controls firing.
--
-- This migration adds two layers, both idempotent:
--
--   1. REVOKE TRUNCATE ... FROM PUBLIC on audit_log AND audit_chain_genesis.
--      Defence in depth — matches the existing REVOKE UPDATE, DELETE pattern.
--      (TRUNCATE is not in PUBLIC by default, but app roles must never be
--      granted it; this makes the intent explicit and survives a careless
--      GRANT ... ON ALL TABLES.) audit_chain_genesis is included because
--      wiping the genesis markers would re-open the 0005 sentinel-forgery
--      path (that trigger keys off the presence of a genesis row).
--
--   2. A STATEMENT-LEVEL BEFORE TRUNCATE trigger on audit_log that raises
--      unconditionally. Unlike the REVOKE, this also stops the TABLE OWNER —
--      so an accidental or injected TRUNCATE is blocked even when it runs as
--      the role that owns the table. A superuser can still ALTER TABLE ...
--      DISABLE TRIGGER first, but that is itself an auditable DDL act and far
--      outside a casual mistake or an app-level injection. This is consistent
--      with the chain's stated threat model (audit-core protects against
--      post-hoc mutation, not a malicious operator who controls the database
--      superuser).
--
-- Rollback: DROP TRIGGER audit_log_block_truncate ON audit_log;
--           DROP FUNCTION audit_log_reject_truncate();
--           (the REVOKEs are safe to leave in place). Shipped inline here
--           rather than as a separate file because it is a single trigger.
--
-- pglite note: PG15-WASM supports statement-level TRUNCATE triggers, so this
-- applies in dev/test as well — the block is exercised by the same boot path.

BEGIN;

-- Layer 1 — explicit privilege removal (defence in depth).
REVOKE TRUNCATE ON audit_log FROM PUBLIC;
REVOKE TRUNCATE ON audit_chain_genesis FROM PUBLIC;

-- Layer 2 — hard block that also binds the table owner.
CREATE OR REPLACE FUNCTION audit_log_reject_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only: TRUNCATE is forbidden (tamper-evidence lockdown, migration 0008). To intentionally reset the chain, DISABLE this trigger explicitly as the owner.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_block_truncate ON audit_log;
CREATE TRIGGER audit_log_block_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_truncate();

COMMIT;
