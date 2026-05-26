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
}

export async function createTestDb(opts: CreateTestDbOpts = {}): Promise<{
  pg: PGlite;
  db: ReturnType<typeof drizzle<typeof schema>>;
}> {
  const applyChainColumns = opts.chainColumns ?? true;
  const applyChainValidate = opts.chainValidate ?? false;

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

  const db = drizzle(pg, { schema });
  return { pg, db };
}
