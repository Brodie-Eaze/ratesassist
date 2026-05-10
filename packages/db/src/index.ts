/**
 * @ratesassist/db — public surface.
 *
 * Phase 2 scaffold: this package is built and tested in isolation. It is
 * NOT yet imported by apps/web or any other workspace. Wiring is Phase 2b.
 */

export * from "./schema.js";
export {
  getDb,
  withTenant,
  setDbForTesting,
  resetDbForTesting,
  type Db,
} from "./client.js";
export {
  withAudit,
  recordAuditEvent,
  type AuditCtx,
  type AuditTarget,
  type AuditActorKind,
} from "./audit.js";
