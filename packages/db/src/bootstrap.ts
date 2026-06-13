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
  // 0006 — DB-enforced multi-tenant isolation. Adds RLS to the two
  // tenant-scoped tables 0001 missed (users, sessions) and re-asserts
  // every tenant policy with a hardened, explicitly fail-closed
  // predicate. Idempotent (DROP POLICY IF EXISTS + ENABLE/FORCE are
  // no-ops when already set). 0007 is the matching rollback — ship on
  // disk only, never applied on forward boot.
  "0006_rls_tenant_isolation.sql",
  // 0008 — append-only TRUNCATE lockdown on audit_log. REVOKE TRUNCATE
  // (the privilege REVOKE UPDATE, DELETE never covered) + a statement-level
  // BEFORE TRUNCATE trigger that blocks even the table owner. Closes the
  // single-statement chain-wipe path that bypasses RLS and row triggers.
  // Idempotent (REVOKE no-op when absent; CREATE OR REPLACE + DROP TRIGGER
  // IF EXISTS). No rollback file — drop trigger+function inline if needed.
  "0008_audit_log_truncate_lockdown.sql",
  // 0009 — durable JD-2 PDF integrity-receipt lookup table (RA-L3-01/04).
  // Keyed by globally-unique doc_id so /api/verify/pack works across ECS
  // tasks + restarts instead of a per-task in-memory buffer. Simple lookup
  // index (no RLS, no hash chain); the audit TRAIL still lives in audit_log.
  // Idempotent (CREATE TABLE/INDEX IF NOT EXISTS).
  "0009_pdf_integrity_receipt.sql",
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

// ---------------------------------------------------------------------------
// RLS serving-role seatbelt
// ---------------------------------------------------------------------------
//
// The multi-tenant isolation guarantee (migration 0006) is enforced entirely
// by PostgreSQL Row-Level Security. RLS has one fatal blind spot: it is
// SILENTLY BYPASSED for any role that is a SUPERUSER or carries the BYPASSRLS
// attribute. If the production app connects as such a role, every tenant
// policy is INERT and one council can read another council's ratepayer data —
// with no error, no log, nothing. The control looks present in the schema and
// is completely defeated at runtime.
//
// pglite makes this worse to detect in dev/CI: it runs everything as an
// implicit superuser, so RLS predicates are evaluated but role-level revokes
// are not, and a local test will never surface the misconfiguration.
//
// {@link assertNonBypassRlsRole} closes that gap at boot: on a real Postgres
// connection in production it refuses to serve a single request until it has
// confirmed the connected role is neither superuser nor BYPASSRLS. The check
// is a few-hundred-microsecond query run exactly once per process.

/** Inputs to the pure serving-role decision. Driver kept narrow on purpose. */
export interface ServingRoleInputs {
  /** Active driver. RLS role-revokes only matter for real Postgres. */
  readonly driver: "pg" | "pglite";
  /** `process.env.NODE_ENV` — the check only bites in production. */
  readonly nodeEnv: string | undefined;
  /** True when `RA_ALLOW_BYPASSRLS_DB=1` — documented break-glass override. */
  readonly allowBypassAck: boolean;
  /** `current_setting('is_superuser')` resolved to a boolean. */
  readonly isSuperuser: boolean;
  /** `pg_roles.rolbypassrls` for the connected role. */
  readonly bypassRls: boolean;
}

/**
 * Pure decision: should the app REFUSE to serve with this DB role?
 *
 * Refuses only when ALL of: real Postgres driver, production, no operator
 * acknowledgement, AND the role can defeat RLS (superuser or BYPASSRLS).
 * Everything else (pglite, non-prod, acknowledged) is allowed. Pure and
 * total so the full matrix is unit-testable without a live connection.
 */
export type ServingRoleVerdict =
  | { readonly refuse: false }
  | { readonly refuse: true; readonly cause: "superuser" | "bypassrls" };

export function shouldRefuseServingRole(
  inputs: ServingRoleInputs,
): ServingRoleVerdict {
  // pglite is the in-memory dev/test driver (gated separately by
  // RA_ALLOW_EPHEMERAL_DB); its superuser-by-design model is not a production
  // tenant-isolation risk because it never serves real council PII.
  if (inputs.driver !== "pg") return { refuse: false };
  // Owners legitimately connect as the table owner in dev/test/CI.
  if (inputs.nodeEnv !== "production") return { refuse: false };
  // Explicit, documented break-glass: operator accepts RLS may be inert.
  if (inputs.allowBypassAck) return { refuse: false };
  if (inputs.isSuperuser) return { refuse: true, cause: "superuser" };
  if (inputs.bypassRls) return { refuse: true, cause: "bypassrls" };
  return { refuse: false };
}

interface RoleProbeRow {
  readonly is_superuser?: unknown;
  readonly bypassrls?: unknown;
}

/** Normalise a drizzle/pg or pglite execute() result to its first row. */
function firstRow(raw: unknown): RoleProbeRow | null {
  if (raw === null || raw === undefined) return null;
  const rows =
    (raw as { rows?: ReadonlyArray<RoleProbeRow> }).rows ??
    (Array.isArray(raw) ? (raw as ReadonlyArray<RoleProbeRow>) : undefined);
  if (!rows || rows.length === 0) return null;
  return rows[0] ?? null;
}

/** Postgres reports booleans as the string 't'/'f' over the simple protocol. */
function toBool(v: unknown): boolean {
  return v === true || v === "t" || v === "true" || v === "on";
}

/**
 * Read the connected role's RLS-defeating privileges. Single round-trip;
 * `current_setting('is_superuser')` is a GUC ('on'/'off') and `rolbypassrls`
 * is the per-role attribute from `pg_roles`.
 */
async function readServingRolePrivileges(
  db: Db,
): Promise<{ isSuperuser: boolean; bypassRls: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await (db as any).execute(sql`
    SELECT current_setting('is_superuser') AS is_superuser,
           (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls
  `);
  const row = firstRow(raw);
  return {
    isSuperuser: toBool(row?.is_superuser),
    bypassRls: toBool(row?.bypassrls),
  };
}

/**
 * Boot seatbelt: refuse to serve when the production Postgres role can bypass
 * RLS. No-op for pglite, for non-production, and when the operator has set
 * `RA_ALLOW_BYPASSRLS_DB=1` (which is logged loudly on every boot). Call this
 * once during bootstrap, AFTER {@link getDb}.
 *
 * Throws a fail-closed Error (not a warning) on a real misconfiguration so the
 * process never begins serving cross-tenant-readable traffic.
 */
export async function assertNonBypassRlsRole(db: Db): Promise<void> {
  const driver = getDriverKind() ?? "pglite";
  const nodeEnv = process.env.NODE_ENV;
  const allowBypassAck = process.env["RA_ALLOW_BYPASSRLS_DB"] === "1";

  // Fast path: skip the round-trip whenever the verdict cannot be "refuse"
  // regardless of role privileges. Mirrors shouldRefuseServingRole's gates.
  if (driver !== "pg" || nodeEnv !== "production") return;
  if (allowBypassAck) {
    // Break-glass engaged — make it loud and auditable in CloudWatch.
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        level: "warn",
        scope: "db",
        event: "db.rls_serving_role_check_skipped",
        msg: "RA_ALLOW_BYPASSRLS_DB=1 — serving-role RLS check SKIPPED. Row-Level Security may be INERT if this role is superuser or has BYPASSRLS.",
      }),
    );
    return;
  }

  const { isSuperuser, bypassRls } = await readServingRolePrivileges(db);
  const verdict = shouldRefuseServingRole({
    driver,
    nodeEnv,
    allowBypassAck,
    isSuperuser,
    bypassRls,
  });
  if (!verdict.refuse) return;

  const detail =
    verdict.cause === "superuser"
      ? "the production database role is a SUPERUSER. PostgreSQL bypasses Row-Level Security for superusers"
      : "the production database role has the BYPASSRLS attribute. PostgreSQL bypasses Row-Level Security for this role";
  throw new Error(
    `[@ratesassist/db] REFUSING TO SERVE: ${detail}, so every tenant-isolation ` +
      "policy (migration 0006) is INERT and one council could read another " +
      "council's ratepayer data. Connect as a dedicated NOBYPASSRLS application " +
      "role (NOT the RDS master / table owner), or set RA_ALLOW_BYPASSRLS_DB=1 " +
      "to acknowledge an intentionally RLS-disabled boot.",
  );
}
