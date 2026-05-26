/**
 * Schema + seed bootstrap helpers.
 *
 * Two responsibilities:
 *
 *   1. {@link ensureSchema}: applies the initial migration SQL. Idempotent —
 *      every CREATE statement is wrapped in `IF NOT EXISTS` (tables/indexes)
 *      or `DO $$ … duplicate_object … $$` (enums). Safe to call on every
 *      process boot.
 *
 *   2. {@link ensureSeeded}: idempotent seed. Checks whether the `tenants`
 *      table has any rows; if not, loads demo fixtures and inserts them. If
 *      the table already has data, it is a no-op.
 *
 * Both helpers are driver-agnostic — they work with the pglite-backed and
 * node-postgres-backed Drizzle instances returned by {@link getDb}.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sql } from "drizzle-orm";

import { getDriverKind, getPgliteInstance, type Db } from "./client.js";
import { tenants } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve and read a migration SQL file by name. Path is computed relative
 * to the source file so it works both from src/ (tests / tsx) and dist/
 * (compiled). Throws if the file cannot be found.
 */
export function loadMigrationSqlByName(name: string): string {
  // src/bootstrap.ts → ../migrations/<name>
  // dist/bootstrap.js → ../migrations/<name> (when shipped — symlink/copy)
  const candidates = [
    resolve(__dirname, "../migrations", name),
    resolve(__dirname, "../../migrations", name),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      // try next
    }
  }
  throw new Error(
    `[@ratesassist/db] could not locate migrations/${name} under ${candidates.join(", ")}`,
  );
}

/** @deprecated Prefer {@link loadMigrationSqlByName}. Kept for back-compat. */
export function loadMigrationSql(): string {
  return loadMigrationSqlByName("0001_init.sql");
}

/**
 * Ordered list of forward-only migrations applied by {@link ensureSchema}.
 * Index order is the apply order. Adding a migration here means it ships
 * with every fresh boot; deployers running real Postgres should mirror the
 * order via their migration runner.
 *
 * 0003 (NOT NULL flip) is included so dev/test envs always run with the
 * fully-validated chain. Production deployers MUST run the genesis-marker
 * backfill BEFORE 0003 — see AUDIT.md.
 */
const MIGRATIONS_IN_ORDER: ReadonlyArray<string> = [
  "0001_init.sql",
  "0002_audit_chain_columns.sql",
  "0003_audit_chain_validate.sql",
  // 0004 is the pre-written rollback for 0002+0003 — never apply on
  // forward boot; ship on disk only.
  // 0005 (iter4 / F-010 lockdown) — tightens row_hash CHECK to the
  // exact `__PRE_CHAIN__<uuid>` shape and adds a BEFORE INSERT
  // trigger that refuses sentinel rows after the tenant's chain has
  // been opened. Idempotent on a fresh DB or one that already ran
  // 0002+0003.
  "0005_audit_chain_sentinel_lockdown.sql",
];

function stripPgliteIncompatibilities(sqlText: string): string {
  // pglite does not ship `pgcrypto`; it ships gen_random_uuid() natively.
  let s = sqlText.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/i, "");
  // pglite refuses CREATE INDEX CONCURRENTLY when the implicit
  // multi-statement transaction it wraps around `pg.exec()` is open. The
  // keyword is purely a lock-impact optimisation for real Postgres — the
  // index is created either way. Strip it for pglite so dev/test boots.
  s = s.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/gi, "CREATE $1INDEX");
  s = s.replace(/DROP\s+INDEX\s+CONCURRENTLY/gi, "DROP INDEX");
  return s;
}

/**
 * Apply every migration in order. Idempotent. For pglite we strip:
 *   - `CREATE EXTENSION IF NOT EXISTS pgcrypto;` (pglite has gen_random_uuid()
 *     built-in)
 *   - `CONCURRENTLY` (pglite executes multi-statement input inside one tx,
 *     and CONCURRENTLY refuses to run inside a tx; the keyword is a real-
 *     Postgres lock-impact optimisation only).
 *
 * Production deployers should NOT use this helper to apply chain migrations
 * — run the SQL files through your migration tool of choice so the lock
 * impact is auditable. This helper exists for dev/test/CI boots.
 */
export async function ensureSchema(db: Db): Promise<void> {
  const driver = getDriverKind();

  if (driver === "pglite") {
    // Use pglite's native multi-statement exec — drizzle's tagged execute
    // expects single statements and does not parse the `DO $$ ... $$`
    // dollar-quoted bodies correctly for our migration.
    const pg = getPgliteInstance();
    if (pg === null) {
      throw new Error(
        "[@ratesassist/db] driver kind 'pglite' but no PGlite instance — getDb() not called?",
      );
    }
    for (const name of MIGRATIONS_IN_ORDER) {
      await pg.exec(stripPgliteIncompatibilities(loadMigrationSqlByName(name)));
    }
    return;
  }

  // node-postgres: feed each script in a single query. Postgres handles
  // multi-statement input natively over the simple query protocol.
  for (const name of MIGRATIONS_IN_ORDER) {
    const sqlText = loadMigrationSqlByName(name);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).execute(sql.raw(sqlText));
  }
}

/**
 * Idempotent seed. No-op when {@link tenants} already has at least one row.
 * Otherwise loads demo fixtures from `@ratesassist/adapter-demo/data` and
 * inserts everything via the shared {@link runSeed} routine.
 *
 * Returns true when the seed was applied; false when it was a no-op.
 */
export async function ensureSeeded(db: Db): Promise<boolean> {
  const rows = await db.select({ id: tenants.id }).from(tenants).limit(1);
  if (rows.length > 0) return false;

  // Resolve scripts/seed relative to this source file. Two layouts:
  //   - source (vitest / tsx): src/bootstrap.ts + scripts/seed.ts (siblings)
  //   - compiled dist: dist/bootstrap.js + dist/scripts/seed.js (mirrored)
  // In both cases the path is "../scripts/seed.{ts,js}". We try the .js
  // form first (works in compiled dist + with the typescript loader), then
  // fall back to a path that includes the .ts extension which tsx accepts.
  //
  // The webpack-ignore comments below are critical: without them, Next.js
  // tries to statically resolve the dynamic-import URL at bundle time,
  // emits a "Critical dependency" warning, and disables vendor-chunk
  // splitting which breaks pino's worker-thread spawn (see SHIPCHECK).
  const tryPaths = [
    resolve(__dirname, "../scripts/seed.js"),
    resolve(__dirname, "../scripts/seed.ts"),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let seed: any | null = null;
  let lastErr: unknown = null;
  for (const p of tryPaths) {
    const url = pathToFileURL(p).href;
    try {
      seed = await import(
        /* webpackIgnore: true */ /* @vite-ignore */ url
      );
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (seed === null || typeof seed.runSeed !== "function") {
    const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(
      `[@ratesassist/db] runSeed not loadable from scripts/seed (${errMsg})`,
    );
  }
  await seed.runSeed(db);
  return true;
}
