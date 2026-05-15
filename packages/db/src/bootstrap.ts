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
 * Resolve and read the migration SQL. Path is computed relative to the
 * source file so it works both from src/ (tests / tsx) and dist/ (compiled).
 */
export function loadMigrationSql(): string {
  // src/bootstrap.ts → ../migrations/0001_init.sql
  // dist/bootstrap.js → ../migrations/0001_init.sql (when shipped — symlink/copy)
  const candidates = [
    resolve(__dirname, "../migrations/0001_init.sql"),
    resolve(__dirname, "../../migrations/0001_init.sql"),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      // try next
    }
  }
  throw new Error(
    `[@ratesassist/db] could not locate migrations/0001_init.sql under ${candidates.join(", ")}`,
  );
}

/**
 * Apply the initial migration. Idempotent. For pglite we strip the
 * `CREATE EXTENSION IF NOT EXISTS pgcrypto;` line because pglite ships a
 * built-in `gen_random_uuid()` without needing the extension.
 */
export async function ensureSchema(db: Db): Promise<void> {
  let sqlText = loadMigrationSql();

  // pglite-specific tweaks: drop the pgcrypto extension line.
  const driver = getDriverKind();
  if (driver === "pglite") {
    sqlText = sqlText.replace(
      /CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/i,
      "",
    );
    // Use pglite's native multi-statement exec — drizzle's tagged execute
    // expects single statements and does not parse the `DO $$ ... $$`
    // dollar-quoted bodies correctly for our migration.
    const pg = getPgliteInstance();
    if (pg === null) {
      throw new Error(
        "[@ratesassist/db] driver kind 'pglite' but no PGlite instance — getDb() not called?",
      );
    }
    await pg.exec(sqlText);
    return;
  }

  // node-postgres: feed the whole script in a single query. Postgres handles
  // multi-statement input natively over the simple query protocol.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).execute(sql.raw(sqlText));
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
