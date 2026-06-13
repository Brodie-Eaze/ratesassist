/**
 * @ratesassist/db — public surface.
 *
 * Phase 2b: this package is now wired into apps/web. {@link getDb} returns a
 * pglite-backed instance by default in dev (no DATABASE_URL required); a
 * `postgres://…` URL switches it to the real node-postgres pool.
 */

export * from "./schema.js";
export {
  getDb,
  withTenant,
  setDbForTesting,
  resetDbForTesting,
  getDriverKind,
  getPgliteInstance,
  type Db,
} from "./client.js";
export {
  withAudit,
  recordAuditEvent,
  type AuditCtx,
  type AuditTarget,
  type AuditActorKind,
} from "./audit.js";
export {
  ensureSchema,
  ensureSeeded,
  loadMigrationSql,
  loadMigrationSqlByName,
  assertNonBypassRlsRole,
  shouldRefuseServingRole,
  type ServingRoleInputs,
  type ServingRoleVerdict,
} from "./bootstrap.js";

// Re-export a thin set of drizzle-orm helpers so workspace consumers
// (`apps/web`) can build queries without a direct dep on drizzle-orm. The
// import surface is intentionally narrow — anything not exported here
// should not be reached from outside the persistence package.
export { eq, and, or, inArray, sql, desc, asc } from "drizzle-orm";
