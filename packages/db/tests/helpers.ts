/**
 * Shared test scaffolding: a pglite-backed Drizzle instance with the initial
 * migration applied. Each suite gets a fresh in-memory database.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "../src/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolve(__dirname, "../migrations/0001_init.sql");

export async function createTestDb(): Promise<{
  pg: PGlite;
  db: ReturnType<typeof drizzle<typeof schema>>;
}> {
  const pg = new PGlite();
  let sqlText = readFileSync(MIGRATION_PATH, "utf8");

  // pglite does not ship the `pgcrypto` extension; it does ship a built-in
  // `gen_random_uuid()` so we can simply skip the CREATE EXTENSION line.
  sqlText = sqlText.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/i, "");

  // pglite executes a string of multiple statements via .exec.
  await pg.exec(sqlText);

  const db = drizzle(pg, { schema });
  return { pg, db };
}
