/**
 * Shared test scaffolding: a pglite-backed Drizzle instance with the initial
 * migration applied. Each suite gets a fresh in-memory database.
 *
 * Applies the migration files in order: 0001 (base schema) → 0002 (chain
 * columns + indexes). 0003 (validate NOT NULL) is opt-in via
 * `createTestDb({ chainValidate: true })` so chain-replay tests can exercise
 * the post-backfill state explicitly.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "../src/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../migrations");

function readMigration(name: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, name), "utf8");
}

function stripPgliteIncompatibilities(sqlText: string): string {
  // pglite does not ship `pgcrypto`; it ships gen_random_uuid() natively.
  let s = sqlText.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/i, "");
  // pglite refuses CREATE INDEX CONCURRENTLY when statements run inside an
  // implicit transaction (which `pg.exec()` opens for multi-statement input).
  // The CONCURRENTLY keyword is purely a lock-impact optimisation for real
  // Postgres — dropping it in tests preserves semantics (the index is
  // created either way).
  s = s.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/gi, "CREATE $1INDEX");
  s = s.replace(/DROP\s+INDEX\s+CONCURRENTLY/gi, "DROP INDEX");
  return s;
}

export interface CreateTestDbOpts {
  /** Apply 0002 (chain columns). Default true — every suite needs the chain. */
  readonly chainColumns?: boolean;
  /** Apply 0003 (chain NOT NULL). Default false — opt-in for replay tests. */
  readonly chainValidate?: boolean;
  /**
   * Apply 0005 (sentinel lockdown) then 0006 (DB-enforced RLS hardening), and
   * provision a non-superuser `app_user` role with table-level DML grants.
   * Default false. Opt-in for the RLS isolation suite.
   *
   * Why a dedicated role: pglite (like real Postgres) runs the implicit
   * `postgres` superuser, and superusers BYPASS RLS even under FORCE ROW LEVEL
   * SECURITY. To prove the policies actually DENY cross-tenant access we must
   * issue queries as a role that does NOT hold BYPASSRLS — exactly how
   * production app traffic connects (`app_user`, per 0001's header). Use
   * {@link withTenantAsAppUser} to run a tenant-scoped txn under that role.
   */
  readonly rls?: boolean;
}

/** Name of the non-superuser role provisioned when `rls: true`. */
export const APP_USER_ROLE = "app_user";

export async function createTestDb(opts: CreateTestDbOpts = {}): Promise<{
  pg: PGlite;
  db: ReturnType<typeof drizzle<typeof schema>>;
}> {
  const applyChainColumns = opts.chainColumns ?? true;
  const applyChainValidate = opts.chainValidate ?? false;
  const applyRls = opts.rls ?? false;

  const pg = new PGlite();
  await pg.exec(stripPgliteIncompatibilities(readMigration("0001_init.sql")));
  if (applyChainColumns) {
    await pg.exec(
      stripPgliteIncompatibilities(readMigration("0002_audit_chain_columns.sql")),
    );
  }
  if (applyChainValidate) {
    await pg.exec(
      stripPgliteIncompatibilities(readMigration("0003_audit_chain_validate.sql")),
    );
  }
  if (applyRls) {
    await pg.exec(
      stripPgliteIncompatibilities(
        readMigration("0005_audit_chain_sentinel_lockdown.sql"),
      ),
    );
    await pg.exec(
      stripPgliteIncompatibilities(
        readMigration("0006_rls_tenant_isolation.sql"),
      ),
    );
    // Provision the production-equivalent non-superuser role. NOBYPASSRLS is
    // the critical attribute: it is what makes the FORCE-d policies actually
    // apply to this role's queries. Grant DML on every table the app touches;
    // UPDATE/DELETE on audit_log remain revoked from PUBLIC by the migration.
    await pg.exec(`
      DO $$ BEGIN
        CREATE ROLE ${APP_USER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      GRANT USAGE ON SCHEMA public TO ${APP_USER_ROLE};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_USER_ROLE};
      REVOKE UPDATE, DELETE ON audit_log FROM ${APP_USER_ROLE};
    `);
  }

  const db = drizzle(pg, { schema });
  return { pg, db };
}

/**
 * Run `fn` inside a transaction that (a) assumes the non-superuser
 * {@link APP_USER_ROLE} via `SET LOCAL ROLE` and (b) pins `app.tenant_id` to
 * `tenantId` via `set_config(..., true)` — mirroring production
 * `withTenant()` but under the RLS-subject role so policies genuinely apply.
 *
 * Pass `tenantId = null` to set NO tenant GUC (fail-closed probe). Both the
 * role and the GUC reset automatically at COMMIT/ROLLBACK (txn-local), so no
 * state leaks to the next checkout.
 *
 * Operates on the raw PGlite handle (not Drizzle) so the test controls the
 * exact transaction/role/GUC sequence. Returns whatever `fn` returns.
 */
export async function withTenantAsAppUser<T>(
  pg: PGlite,
  tenantId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await pg.exec("BEGIN");
  try {
    await pg.exec(`SET LOCAL ROLE ${APP_USER_ROLE}`);
    if (tenantId !== null) {
      await pg.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    }
    const result = await fn();
    await pg.exec("COMMIT");
    return result;
  } catch (err) {
    await pg.exec("ROLLBACK");
    throw err;
  }
}
