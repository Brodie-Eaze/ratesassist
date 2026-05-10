import type { Config } from "drizzle-kit";

/**
 * Drizzle Kit configuration.
 *
 * Generates SQL migrations from `src/schema.ts` into `migrations/`.
 * Driver pinned to node-postgres (`pg`); RDS Postgres is the production target
 * (Sydney region, KMS CMK, 35-day PITR — see DATA-CLASSIFICATION.md).
 */
export default {
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/ratesassist",
  },
  strict: true,
  verbose: true,
} satisfies Config;
