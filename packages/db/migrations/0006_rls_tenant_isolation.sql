-- 0006_rls_tenant_isolation.sql
--
-- Hardens multi-tenant isolation from APP-enforced to DB-ENFORCED via
-- PostgreSQL Row-Level Security (RLS). Closes the #1 structural security gap
-- from the ship-readiness audit: today tenant separation relies on every
-- query remembering to filter by tenant_id; after this migration the database
-- itself refuses cross-tenant access even when application code forgets.
--
-- WHAT THIS ADDS OVER 0001_init.sql
-- ---------------------------------
-- 0001 already ENABLE/FORCE RLS + tenant_isolation policies on the eight
-- tenant-columned business tables (properties, owners, transactions,
-- signal_hits, mismatch_candidates, audit_log, commit_tokens, api_keys).
-- This migration:
--
--   1. Closes the two tables 0001 missed: `users` (tenant-columned) and
--      `sessions` (tenant-derived through its FK to users).
--   2. Re-asserts EVERY tenant-scoped policy with a HARDENED, explicitly
--      fail-closed predicate (see "Fail-closed" below). 0001's predicate
--      `tenant_id::text = current_setting('app.tenant_id', true)` is already
--      fail-closed (NULL = anything -> NULL -> no match), but it does not
--      reject an EMPTY-STRING GUC and the intent is implicit. We rewrite each
--      policy to require the GUC be present AND non-empty AND matching, so the
--      deny semantics are unambiguous and survive a future careless edit.
--   3. Is fully idempotent: DROP POLICY IF EXISTS before each CREATE, and
--      ENABLE/FORCE ROW LEVEL SECURITY are no-ops when already set. Safe to
--      re-run on every ensureSchema() boot.
--
-- FAIL-CLOSED SEMANTICS
-- ---------------------
-- `current_setting('app.tenant_id', true)` returns NULL when the GUC is unset
-- (the `true` = "missing_ok"). A fresh pooled connection / a forgotten
-- withTenant() therefore has NULL (or '' after a prior set_config reset). The
-- policy predicate is:
--
--     current_setting('app.tenant_id', true) IS NOT NULL
--     AND current_setting('app.tenant_id', true) <> ''
--     AND tenant_id::text = current_setting('app.tenant_id', true)
--
-- => NULL GUC  -> first clause false  -> row invisible (SELECT) / rejected
--    '' GUC    -> second clause false -> row invisible / rejected
--    wrong GUC -> third clause false  -> row invisible / rejected
--
-- The DENY is the default. A session only ever sees/writes rows for the exact
-- tenant it has pinned via `set_config('app.tenant_id', <uuid>, true)` inside
-- withTenant(). There is no NULL -> "all rows" path.
--
-- SESSIONS (no tenant_id column)
-- ------------------------------
-- `sessions` has no tenant_id of its own; its tenant is whatever tenant owns
-- the user it points at. We scope it transitively: a session row is visible/
-- writable iff its `user_id` resolves to a row in `users` that is itself
-- visible under the current GUC. Because `users` is RLS-FORCED, the EXISTS
-- subquery only matches same-tenant users -> sessions inherit the same
-- isolation. (Verified under a non-superuser role: a session for tenant B's
-- user is invisible and undeletable from a tenant-A session.)
--
-- ROLE MODEL / WHO BYPASSES (seed, migration, audit chain)
-- --------------------------------------------------------
-- RLS (even FORCE) is bypassed by superusers and roles holding BYPASSRLS.
-- We rely on this deliberately for the privileged paths:
--
--   * MIGRATION RUNNER: applies this file as the owner/admin role (holds
--     BYPASSRLS on managed Postgres; is the implicit superuser under pglite).
--     ALTER/CREATE POLICY apply regardless of RLS.
--
--   * SEED (scripts/seed.ts): runs as that same privileged role. It inserts
--     the cross-tenant `tenants` directory directly (tenants is intentionally
--     NOT RLS-enabled) and inserts every tenant-scoped fixture INSIDE
--     withTenant(), so even if it were subject to RLS the WITH CHECK would
--     pass. It does not touch users/sessions. No seed change required.
--
--   * AUDIT CHAIN: withAudit()/recordAuditEvent() already run inside
--     withTenant(), so the audit_log SELECT/INSERT policies (from 0001, and
--     the chain-head read in audit.ts) operate within the pinned tenant. The
--     0005 sentinel-lockdown trigger reads `audit_chain_genesis` by
--     NEW.tenant_id; that table is left NON-RLS on purpose (see below) so the
--     trigger sees genesis markers for the row being inserted regardless of
--     the session GUC. The chain verifier reads audit_log per-tenant under the
--     GUC, which is correct.
--
-- PRODUCTION APP TRAFFIC connects as the non-privileged `app_user` role
-- (created at deploy time per 0001's header) which does NOT hold BYPASSRLS, so
-- every app query is subject to these policies. See README.md "Tenant
-- isolation (RLS)" for the deploy-time role setup and the apps/web cutover.
--
-- TABLES DELIBERATELY LEFT WITHOUT RLS
-- ------------------------------------
--   * `tenants`              — the tenant directory; read before a GUC is
--                              established. Gated at the app auth layer + the
--                              explicit GRANTs on app_user. (Same as 0001.)
--   * `tenements`            — mining-register reference data; not tenant-
--                              scoped in the contract (no tenant_id; seeded
--                              outside withTenant).
--   * `property_owners`,
--     `tenement_properties`  — pure join tables with no tenant_id. Every row
--                              references a tenant-scoped parent
--                              (properties/owners/tenements) whose own RLS
--                              gates reachability; they carry no tenant data
--                              themselves. (Promote to RLS if a tenant_id is
--                              ever denormalised onto them.)
--   * `audit_chain_genesis`  — per-tenant SHA-256 anchor only (no PII). The
--                              0005 BEFORE INSERT trigger must read it
--                              cross-tenant to enforce the sentinel lockdown,
--                              so it stays non-RLS by design.
--
-- LOCK IMPACT: NONE of consequence. ALTER TABLE ... ENABLE/FORCE ROW LEVEL
-- SECURITY takes a brief ACCESS EXCLUSIVE lock to flip a catalog flag (no
-- table rewrite, no data scan); CREATE/DROP POLICY is catalog-only. All
-- statements are metadata operations. Safe to deploy any time.
--
-- REVERSIBLE: YES. See 0007_rls_tenant_isolation_rollback.sql (shipped on disk
-- alongside this file; never applied on forward boot). It DROPs the new
-- policies and DISABLEs RLS on users/sessions, restoring the 0001 baseline.

BEGIN;

-- ===========================================================================
-- Re-assert hardened policies on the eight tables already RLS-enabled in 0001.
-- DROP IF EXISTS makes this safe whether or not 0001's policies are present.
-- ===========================================================================

-- ---- properties ----------------------------------------------------------
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON properties;
CREATE POLICY tenant_isolation_select ON properties FOR SELECT
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );
DROP POLICY IF EXISTS tenant_isolation_modify ON properties;
CREATE POLICY tenant_isolation_modify ON properties FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );

-- ---- owners --------------------------------------------------------------
ALTER TABLE owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE owners FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON owners;
CREATE POLICY tenant_isolation_select ON owners FOR SELECT
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );
DROP POLICY IF EXISTS tenant_isolation_modify ON owners;
CREATE POLICY tenant_isolation_modify ON owners FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );

-- ---- transactions --------------------------------------------------------
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON transactions;
CREATE POLICY tenant_isolation_select ON transactions FOR SELECT
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );
DROP POLICY IF EXISTS tenant_isolation_modify ON transactions;
CREATE POLICY tenant_isolation_modify ON transactions FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );

-- ---- signal_hits ---------------------------------------------------------
ALTER TABLE signal_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_hits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON signal_hits;
CREATE POLICY tenant_isolation_select ON signal_hits FOR SELECT
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );
DROP POLICY IF EXISTS tenant_isolation_modify ON signal_hits;
CREATE POLICY tenant_isolation_modify ON signal_hits FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );

-- ---- mismatch_candidates -------------------------------------------------
ALTER TABLE mismatch_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE mismatch_candidates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON mismatch_candidates;
CREATE POLICY tenant_isolation_select ON mismatch_candidates FOR SELECT
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );
DROP POLICY IF EXISTS tenant_isolation_modify ON mismatch_candidates;
CREATE POLICY tenant_isolation_modify ON mismatch_candidates FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );

-- ---- audit_log -----------------------------------------------------------
-- SELECT + INSERT are tenant-scoped; UPDATE/DELETE stay REVOKED (0001) so the
-- append-only tamper-evident chain cannot be rewritten. We re-REVOKE here for
-- idempotent safety (REVOKE of an already-absent privilege is a no-op).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON audit_log;
CREATE POLICY tenant_isolation_select ON audit_log FOR SELECT
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );
DROP POLICY IF EXISTS tenant_isolation_insert ON audit_log;
CREATE POLICY tenant_isolation_insert ON audit_log FOR INSERT
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

-- ---- commit_tokens -------------------------------------------------------
ALTER TABLE commit_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE commit_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON commit_tokens;
CREATE POLICY tenant_isolation_select ON commit_tokens FOR SELECT
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );
DROP POLICY IF EXISTS tenant_isolation_modify ON commit_tokens;
CREATE POLICY tenant_isolation_modify ON commit_tokens FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );

-- ---- api_keys ------------------------------------------------------------
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON api_keys;
CREATE POLICY tenant_isolation_select ON api_keys FOR SELECT
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );
DROP POLICY IF EXISTS tenant_isolation_modify ON api_keys;
CREATE POLICY tenant_isolation_modify ON api_keys FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );

-- ===========================================================================
-- NEW: tables 0001 missed.
-- ===========================================================================

-- ---- users (tenant-columned) ---------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON users;
CREATE POLICY tenant_isolation_select ON users FOR SELECT
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );
DROP POLICY IF EXISTS tenant_isolation_modify ON users;
CREATE POLICY tenant_isolation_modify ON users FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND tenant_id::text = current_setting('app.tenant_id', true)
  );

-- ---- sessions (tenant-derived via users) ---------------------------------
-- No tenant_id column; scope transitively through the (RLS-forced) users
-- table. A session is visible/writable only when its user is visible under
-- the current GUC. The WITH CHECK uses the same predicate so a session can
-- never be inserted/repointed onto a user outside the current tenant.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON sessions;
CREATE POLICY tenant_isolation_select ON sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = sessions.user_id
        AND current_setting('app.tenant_id', true) IS NOT NULL
        AND current_setting('app.tenant_id', true) <> ''
        AND u.tenant_id::text = current_setting('app.tenant_id', true)
    )
  );
DROP POLICY IF EXISTS tenant_isolation_modify ON sessions;
CREATE POLICY tenant_isolation_modify ON sessions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = sessions.user_id
        AND current_setting('app.tenant_id', true) IS NOT NULL
        AND current_setting('app.tenant_id', true) <> ''
        AND u.tenant_id::text = current_setting('app.tenant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = sessions.user_id
        AND current_setting('app.tenant_id', true) IS NOT NULL
        AND current_setting('app.tenant_id', true) <> ''
        AND u.tenant_id::text = current_setting('app.tenant_id', true)
    )
  );

COMMIT;
