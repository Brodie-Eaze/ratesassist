-- Phase 9 P0 — audit-log hash chain, step 2/2.
--
-- Runs AFTER:
--   1. 0002_audit_chain_columns.sql has applied.
--   2. The backfill verifier has confirmed every existing audit_log row
--      carries a non-NULL prev_hash / row_hash (sentinel or real).
--   3. The genesis-marker rows are present (one per tenant) in
--      audit_chain_genesis.
--
-- This file flips both columns to NOT NULL using NOT VALID + VALIDATE so
-- the table is not rewrite-locked. ALTER … SET NOT NULL on PG11+ requires
-- a full-table scan and an ACCESS EXCLUSIVE lock for the duration; the
-- NOT VALID escape hatch defers the scan to VALIDATE CONSTRAINT, which
-- only takes a SHARE UPDATE EXCLUSIVE lock.
--
-- Lock impact: SHARE UPDATE EXCLUSIVE for the duration of the VALIDATE
-- pass — concurrent reads/writes proceed; only DDL is blocked.
--
-- Rollback: see 0004_audit_chain_rollback.sql.

-- Step 1: add a NOT VALID NOT NULL surrogate via a CHECK constraint. SET
-- NOT NULL on a real column has no NOT VALID variant in current PG, so we
-- model it as a CHECK that the planner can later use to prove the column
-- nullability invariant for query plans.
DO $$ BEGIN
  ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_prev_hash_present
      CHECK (prev_hash IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_row_hash_present
      CHECK (row_hash IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Step 2: validate — bounded scan, SHARE UPDATE EXCLUSIVE only.
ALTER TABLE audit_log VALIDATE CONSTRAINT audit_log_prev_hash_present;
ALTER TABLE audit_log VALIDATE CONSTRAINT audit_log_row_hash_present;

-- Step 3: now that the CHECKs are validated, we can SET NOT NULL safely —
-- PG14+ uses the CHECK to skip the table scan. On PG <14 this still works
-- but reverts to a full scan; that's the trade-off.
ALTER TABLE audit_log ALTER COLUMN prev_hash SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN row_hash  SET NOT NULL;

-- Optional cleanup: drop the surrogate CHECKs once SET NOT NULL is in
-- place. Leaving them is harmless but the column-level NOT NULL is
-- sufficient. We keep them as belt-and-braces — a future operator who
-- runs `ALTER COLUMN … DROP NOT NULL` will still hit the CHECK and
-- crash on insert rather than silently inserting NULL into the chain.
--
-- (No ALTER … DROP CONSTRAINT lines on purpose.)
