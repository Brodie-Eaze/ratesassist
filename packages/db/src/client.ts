/**
 * Postgres connection + per-request tenant context.
 *
 * Boot semantics
 * --------------
 * - If `RA_USE_DB=true` and `DATABASE_URL` is missing, we throw on the FIRST
 *   call to `getDb()`. We never silently fall back to in-memory.
 * - If `RA_USE_DB` is unset/false, `getDb()` still requires `DATABASE_URL`
 *   but defers the check to call time so this package can be imported
 *   without configuration during the Phase 2 scaffold.
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
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";

import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let cached: Db | null = null;

function buildPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.RA_USE_DB === "true") {
      throw new Error(
        "[@ratesassist/db] RA_USE_DB=true but DATABASE_URL is not set. Refusing to boot.",
      );
    }
    throw new Error(
      "[@ratesassist/db] DATABASE_URL is required to obtain a client.",
    );
  }

  const max = process.env.NODE_ENV === "production" ? 20 : 5;
  const p = new pg.Pool({
    connectionString: url,
    max,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 10_000,
  });
  return p;
}

/**
 * Returns a singleton Drizzle instance bound to a node-postgres pool.
 * Throws if `DATABASE_URL` is not configured.
 */
export function getDb(): Db {
  if (cached) return cached;
  pool = buildPool();
  cached = drizzle(pool, { schema });
  return cached;
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
  if (pool) {
    void pool.end();
    pool = null;
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
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${tenantId}, true)`,
    );
    return fn(tx as unknown as Db);
  });
}
