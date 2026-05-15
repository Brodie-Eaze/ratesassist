/**
 * Postgres connection + per-request tenant context.
 *
 * Boot semantics
 * --------------
 * - If `DATABASE_URL` is unset OR starts with `pglite://`, we instantiate an
 *   in-memory pglite driver (WASM Postgres). The instance persists across
 *   requests within a single dev process; state is lost on process restart.
 *   Documented behaviour — see PRODUCTION-PLAN.md Phase 2.
 * - If `DATABASE_URL` starts with `postgres://` or `postgresql://`, we use a
 *   real node-postgres pool.
 * - `RA_USE_DB=true` with no `DATABASE_URL` is permitted in development
 *   (defaults to pglite). In production (`NODE_ENV=production`), the same
 *   condition still allows pglite — gate the production-pg requirement at
 *   the app deployment layer rather than here so we keep a single boot path.
 *
 * Pool sizing
 * -----------
 * - Production (`NODE_ENV=production`): 20 connections.
 * - Otherwise: 5 connections.
 * - statement_timeout = 15s; idle_in_transaction_session_timeout = 10s.
 *
 * Tenant isolation
 * ----------------
 * RLS policies key off `current_setting('app.tenant_id')`. The {@link withTenant}
 * helper opens a transaction, sets that GUC for the txn, runs the callback,
 * commits, and resets the GUC. Always use this helper for tenant-scoped
 * work — direct `db.execute` calls bypass the GUC and will return zero rows
 * (or fail) once RLS is enabled in the deployment role.
 *
 * pglite caveats
 * --------------
 * - pglite does not ship the `pgcrypto` extension. The migration loader in
 *   {@link ensureSeeded} strips the CREATE EXTENSION line; pglite's built-in
 *   `gen_random_uuid()` works without it.
 * - pglite runs everything as the implicit superuser — RLS is enforced but
 *   role-based revokes (e.g. UPDATE/DELETE revoked on audit_log) are not.
 *   These must be re-verified against real Postgres in CI.
 */

import { drizzle as drizzleNodePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

type DriverKind = "pg" | "pglite";

let pool: pg.Pool | null = null;
let pglite: PGlite | null = null;
let cached: Db | null = null;
let driverKind: DriverKind | null = null;

function classifyUrl(url: string | undefined): DriverKind {
  if (url === undefined || url === "" || url.startsWith("pglite://")) {
    return "pglite";
  }
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return "pg";
  }
  // Unknown shape — assume pglite for safety in dev. Production deployers
  // should always set a postgres:// URL explicitly.
  return "pglite";
}

function buildPgPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "[@ratesassist/db] postgres driver requires DATABASE_URL.",
    );
  }
  const max = process.env.NODE_ENV === "production" ? 20 : 5;
  return new pg.Pool({
    connectionString: url,
    max,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 10_000,
  });
}

function buildPglite(): PGlite {
  // pglite supports a `dataDir` for persistence; we deliberately use the
  // in-memory variant here so dev sessions are deterministic and don't
  // accumulate state on disk. Future: honour pglite://path/to/dir to opt
  // into persistence.
  return new PGlite();
}

/**
 * Returns a singleton Drizzle instance bound to either node-postgres or
 * pglite. Selection is driven by DATABASE_URL — see the module-level
 * comment for the boot rules.
 */
export function getDb(): Db {
  if (cached !== null) return cached;
  const kind = classifyUrl(process.env.DATABASE_URL);
  driverKind = kind;
  if (kind === "pg") {
    pool = buildPgPool();
    cached = drizzleNodePg(pool, { schema });
    return cached;
  }
  pglite = buildPglite();
  cached = drizzlePglite(pglite, { schema });
  return cached;
}

/**
 * Returns the active driver kind (or null if {@link getDb} has not been
 * called yet). Useful for tests that want to assert which driver is in
 * play, and for handlers that need driver-specific SQL (e.g. for `LISTEN`).
 */
export function getDriverKind(): DriverKind | null {
  return driverKind;
}

/**
 * Returns the underlying PGlite instance when the pglite driver is active.
 * Returns null for the node-postgres driver. Used by {@link ensureSchema}
 * to apply the schema migration via PGlite's multi-statement exec API.
 */
export function getPgliteInstance(): PGlite | null {
  return pglite;
}

/**
 * For tests: inject an externally-managed Drizzle instance (e.g. one backed
 * by pglite). Bypasses pool construction entirely.
 */
export function setDbForTesting(db: Db): void {
  cached = db;
}

/** For tests: clear the cached client. */
export function resetDbForTesting(): void {
  cached = null;
  driverKind = null;
  if (pool !== null) {
    void pool.end();
    pool = null;
  }
  if (pglite !== null) {
    void pglite.close();
    pglite = null;
  }
}

/**
 * Run `fn` inside a transaction with `app.tenant_id` set to `tenantId`.
 * RLS policies on every business table key off this GUC. This helper is the
 * ONLY supported way to perform tenant-scoped reads or writes.
 *
 * The GUC is set with `set_config(..., true)` so it is automatically reset
 * at txn commit/rollback — no leakage to the next pool checkout.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).transaction(async (tx: Db) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${tenantId}, true)`,
    );
    return fn(tx);
  });
}
