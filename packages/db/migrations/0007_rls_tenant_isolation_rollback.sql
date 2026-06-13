-- 0007_rls_tenant_isolation_rollback.sql
--
-- Pre-written rollback for 0006_rls_tenant_isolation.sql. SHIP ON DISK ONLY —
-- this file is NOT in bootstrap.ts MIGRATIONS_IN_ORDER and is never applied on
-- a forward boot. Apply it manually (as the owner/admin role) only to revert
-- the 0006 hardening.
--
-- Effect:
--   * Drops RLS entirely from the two tables 0006 introduced it on
--     (users, sessions), returning them to the 0001 baseline (no RLS).
--   * Restores the ORIGINAL, looser 0001 policy predicate on the eight tables
--     0001 first RLS-enabled. This does NOT disable RLS on those tables —
--     0001 shipped them RLS-FORCED and that protection is retained; we only
--     revert the predicate from the hardened (IS NOT NULL AND <> '' AND =)
--     form back to 0001's plain (tenant_id::text = current_setting(...)) form.
--
-- Both forms are fail-closed (NULL GUC -> no match). The rollback exists so an
-- operator can return to a byte-for-byte 0001 policy definition if 0006 is
-- implicated in an incident; it is not expected to be needed.
--
-- Lock impact: NONE of consequence (catalog-only, as with 0006).

BEGIN;

-- ---- revert hardened predicates on 0001's eight tables -> 0001 originals ---

DROP POLICY IF EXISTS tenant_isolation_select ON properties;
CREATE POLICY tenant_isolation_select ON properties FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON properties;
CREATE POLICY tenant_isolation_modify ON properties FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_select ON owners;
CREATE POLICY tenant_isolation_select ON owners FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON owners;
CREATE POLICY tenant_isolation_modify ON owners FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_select ON transactions;
CREATE POLICY tenant_isolation_select ON transactions FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON transactions;
CREATE POLICY tenant_isolation_modify ON transactions FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_select ON signal_hits;
CREATE POLICY tenant_isolation_select ON signal_hits FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON signal_hits;
CREATE POLICY tenant_isolation_modify ON signal_hits FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_select ON mismatch_candidates;
CREATE POLICY tenant_isolation_select ON mismatch_candidates FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON mismatch_candidates;
CREATE POLICY tenant_isolation_modify ON mismatch_candidates FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_select ON audit_log;
CREATE POLICY tenant_isolation_select ON audit_log FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_insert ON audit_log;
CREATE POLICY tenant_isolation_insert ON audit_log FOR INSERT
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_select ON commit_tokens;
CREATE POLICY tenant_isolation_select ON commit_tokens FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON commit_tokens;
CREATE POLICY tenant_isolation_modify ON commit_tokens FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_select ON api_keys;
CREATE POLICY tenant_isolation_select ON api_keys FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON api_keys;
CREATE POLICY tenant_isolation_modify ON api_keys FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- ---- drop RLS that 0006 introduced on users + sessions --------------------

DROP POLICY IF EXISTS tenant_isolation_select ON sessions;
DROP POLICY IF EXISTS tenant_isolation_modify ON sessions;
ALTER TABLE sessions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON users;
DROP POLICY IF EXISTS tenant_isolation_modify ON users;
ALTER TABLE users NO FORCE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

COMMIT;
