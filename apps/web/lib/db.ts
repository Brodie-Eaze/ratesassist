/**
 * Web-app DB client factory.
 *
 * Singleton, lazy-initialised. On first call:
 *   1. Resolves the shared {@link getDb} from `@ratesassist/db`. The package
 *      defaults to an in-memory pglite driver when `DATABASE_URL` is unset
 *      or starts with `pglite://`; a real postgres URL opts into the
 *      production node-postgres pool.
 *   2. Applies the initial migration ({@link ensureSchema}). Idempotent —
 *      every CREATE statement is guarded.
 *   3. Seeds the demo fixtures ({@link ensureSeeded}) when the `tenants`
 *      table is empty. Idempotent — re-runs are no-ops.
 *
 * Subsequent calls return the cached Drizzle instance without re-checking
 * the migration or seed. Tests can reset the singleton via the underlying
 * package helpers.
 *
 * Module-load semantics
 * ---------------------
 * `@ratesassist/db` is dynamically imported here. The package transitively
 * loads pglite (WASM Postgres) and pg (the node-postgres driver); pulling
 * either into the synchronous module graph confuses Next.js's webpack
 * jest-worker compile pipeline. Lazy import keeps every route handler
 * boot-time-cheap and only pays the cost when something actually needs
 * the DB.
 *
 * Logging
 * -------
 * The bootstrap emits exactly one `{level: "info", msg: "db.bootstrap", ...}`
 * log line per process, recording the duration in milliseconds and which
 * driver was selected. Subsequent calls are silent.
 */

import { scoped } from "./logger";

// Use the package's Db type purely as a type-only import so the runtime
// module graph stays clean. The actual implementation is imported lazily
// inside the bootstrap.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type Db = import("@ratesassist/db").Db;

let bootstrapped: Promise<Db> | null = null;

/** True when the DB has finished bootstrapping at least once. */
let bootstrapComplete = false;

/**
 * Returns the package-singleton Drizzle instance, bootstrapped on first call.
 *
 * Safe to call concurrently — the bootstrap promise is memoised so only one
 * migration + seed pass runs per process.
 */
export async function getWebDb(): Promise<Db> {
  if (bootstrapped !== null) return bootstrapped;
  bootstrapped = bootstrapOnce();
  return bootstrapped;
}

async function bootstrapOnce(): Promise<Db> {
  const log = scoped("apps/web/db");
  const start = Date.now();
  const { ensureSchema, ensureSeeded, getDb, getDriverKind } = await import(
    "@ratesassist/db"
  );
  const db = getDb();
  try {
    await ensureSchema(db);
    const seeded = await ensureSeeded(db);
    bootstrapComplete = true;
    const duration = Date.now() - start;
    log.info({
      msg: "db.bootstrap",
      durationMs: duration,
      driver: getDriverKind() ?? "unknown",
      seeded,
    });
    return db;
  } catch (e) {
    // Clear the cached promise so a subsequent call retries. If the user has
    // misconfigured DATABASE_URL the second attempt will throw too, which is
    // honest behaviour.
    bootstrapped = null;
    throw e;
  }
}

/** True when {@link getWebDb} has completed at least one bootstrap pass. */
export function isDbBootstrapped(): boolean {
  return bootstrapComplete;
}

/** Test hook: discard the cached bootstrap promise. */
export function resetWebDbForTesting(): void {
  bootstrapped = null;
  bootstrapComplete = false;
}

/**
 * Returns whether the web app should route reads/writes through the DB.
 * Defaults to true in development; false in production until a real DB is
 * provisioned. Override with `RA_USE_DB=true|false`.
 */
export function isDbWired(): boolean {
  const raw = process.env["RA_USE_DB"];
  if (raw === "true") return true;
  if (raw === "false" || raw === "0") return false;
  // Default by NODE_ENV.
  return process.env.NODE_ENV !== "production";
}
