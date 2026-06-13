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
  const {
    ensureSchema,
    ensureSeeded,
    assertNonBypassRlsRole,
    getDb,
    getDriverKind,
  } = await import("@ratesassist/db");
  const db = getDb();
  try {
    // Apply migrations + seed on boot UNLESS the operator runs migrations out
    // of band (RA_MIGRATE_ON_BOOT=false). Default preserves current behaviour.
    // A real production deploy should run migrations via a provisioned task as
    // an admin role and serve as a separate NOBYPASSRLS app role — see
    // infra/terraform + AUDIT.md. In that split, ensureSchema/ensureSeeded
    // would fail (the app role lacks DDL grants), so this gate lets the app
    // boot read/write-only against an already-migrated schema.
    const migrateOnBoot = process.env["RA_MIGRATE_ON_BOOT"] !== "false";
    let seeded = false;
    if (migrateOnBoot) {
      await ensureSchema(db);
      seeded = await ensureSeeded(db);
    }
    // Seatbelt: refuse to serve if the production role can bypass RLS, which
    // would render every tenant-isolation policy inert. No-op for pglite /
    // non-production / RA_ALLOW_BYPASSRLS_DB=1. Runs AFTER migration so the
    // role check reflects the role that will actually serve traffic.
    await assertNonBypassRlsRole(db);
    bootstrapComplete = true;
    const duration = Date.now() - start;
    log.info({
      msg: "db.bootstrap",
      durationMs: duration,
      driver: getDriverKind() ?? "unknown",
      migrateOnBoot,
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

/**
 * Lightweight liveness ping — runs `select 1` against an already-bootstrapped
 * Drizzle instance. The `sql` tag is dynamically imported from
 * `@ratesassist/db` (which re-exports it from drizzle-orm) so the persistence
 * package — and its pglite/pg WASM payload — stays OUT of the caller's static
 * module graph, consistent with {@link getWebDb}'s lazy-import discipline. The
 * package is already in the module cache after bootstrap, so this import is
 * free. Throws if the query fails.
 */
export async function pingDb(db: Db): Promise<void> {
  const { sql } = await import("@ratesassist/db");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).execute(sql`select 1`);
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
