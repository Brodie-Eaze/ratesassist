-- =============================================================================
-- provision-app-role.sql — the NOBYPASSRLS application role.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Migration 0006_rls_tenant_isolation.sql enforces tenant isolation via
-- PostgreSQL Row-Level Security, but RLS is INERT for a superuser or any role
-- holding BYPASSRLS. 0006's header states production traffic "connects as the
-- non-privileged `app_user` role (created at deploy time)" — this is that
-- artifact, made concrete, runnable, and reviewable. The boot seatbelt
-- `assertNonBypassRlsRole()` (packages/db/src/bootstrap.ts) refuses to serve if
-- the connected role can bypass RLS; this script creates the role that passes it.
--
-- This is NOT a forward migration. It is deliberately OUTSIDE the ordered
-- MIGRATIONS manifest (packages/db/src/bootstrap.ts) so ensureSchema() never
-- runs it — CREATE ROLE is a cluster-level op that pglite can't model and that
-- must run ONCE, as an admin, at deploy time. It is human-gated (sets a
-- password) and therefore lives in the /approve queue, not the autonomous loop.
--
-- HOW TO RUN (ops / queued step)
-- ------------------------------
--   # password comes from the app_user Secrets Manager secret Terraform creates
--   # (see infra/terraform/modules/database — RDS Proxy slice). Never echo it.
--   PW="$(aws secretsmanager get-secret-value \
--         --secret-id ratesassist-prod/app_user --query SecretString \
--         --output text | jq -r .password)"
--   psql "$ADMIN_DATABASE_URL" \
--        -v ON_ERROR_STOP=1 \
--        -v app_user_password="$PW" \
--        -f infra/sql/provision-app-role.sql
--
-- where ADMIN_DATABASE_URL connects as the migration/admin role (the RDS master
-- or table owner). Run AFTER migrations have created the schema, and re-run
-- safely after any migration that adds tables (the default-privileges grant +
-- the explicit grants below are idempotent).
--
-- WHAT app_user CAN AND CANNOT DO
-- -------------------------------
--   CAN : connect; SELECT/INSERT/UPDATE/DELETE on business tables (every row
--         still gated by the RLS policies — app_user is NOBYPASSRLS); SELECT +
--         INSERT on audit_log (append-only).
--   CANNOT : bypass RLS; UPDATE or DELETE audit_log (tamper-evident chain);
--            run DDL; create roles/databases; act as superuser.
-- =============================================================================

\set ON_ERROR_STOP on

-- 1) Create the role if absent (no password here so the literal never lands in
--    a dollar-quoted block where psql would not interpolate it), then ALTER to
--    set attributes + password. ALTER is idempotent and re-runnable.
SELECT 'CREATE ROLE app_user LOGIN'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')
\gexec

ALTER ROLE app_user
  WITH LOGIN
       NOSUPERUSER
       NOCREATEDB
       NOCREATEROLE
       NOBYPASSRLS
       PASSWORD :'app_user_password';

-- 2) Database + schema access (use current_database() so no db-name var needed).
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO app_user;

-- 3) DML on all existing tables, then pull back the audit_log invariant.
--    RLS (migration 0006, FORCE) scopes every row to the pinned tenant, so a
--    broad table-level grant is safe — the row filter is the real boundary.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- audit_log is append-only: SELECT + INSERT only. 0006 already REVOKEs
-- UPDATE/DELETE FROM PUBLIC; re-assert against app_user explicitly so a future
-- default-privileges change can never silently hand it rewrite rights.
REVOKE UPDATE, DELETE ON audit_log FROM app_user;

-- Sequences (BIGSERIAL commit ordering on audit_log, any others).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- 4) Default privileges so tables/sequences created by FUTURE migrations (run
--    by the admin/owner role) are automatically reachable by app_user without
--    re-running this script. Scoped to objects the CURRENT admin role creates.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- 5) Explicitly DENY the dangerous defaults (belt and suspenders).
REVOKE CREATE ON SCHEMA public FROM app_user;   -- no object creation
-- (No GRANT of CREATEROLE/CREATEDB/SUPERUSER/BYPASSRLS anywhere above.)

-- 6) Verify posture in-band so a misconfigured run fails loud.
DO $$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
    INTO r FROM pg_roles WHERE rolname = 'app_user';
  IF r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole THEN
    RAISE EXCEPTION 'app_user has a privilege that defeats RLS/least-privilege: %', row_to_json(r);
  END IF;
  RAISE NOTICE 'app_user provisioned: LOGIN, NOBYPASSRLS, NOSUPERUSER — RLS will apply.';
END $$;
