/**
 * Per-request context for handlers.
 *
 * Built once per dispatch and threaded through every handler. Bundles:
 *   - tenant + user identity (placeholder values in the demo adapter; in
 *     production these come from the authenticated MCP session).
 *   - a stable correlation id used in audit logging and error responses.
 *   - an injectable clock for deterministic tests.
 *   - a recovery-engine `EvaluationContext` snapshot, so the handlers that
 *     hit `findMismatches` / `buildEvidencePack` see a consistent state for
 *     the lifetime of one request.
 *   - the configured ABN client (mock-mode in the demo).
 *   - the commit-token store for two-phase mutating tools.
 *
 * The tenancy fields are placeholders: the demo adapter does not yet enforce
 * tenant isolation. Phase 2 of `PRODUCTION-PLAN.md` introduces real per-
 * tenant scoping via Postgres RLS — this struct is the surface where those
 * fields land.
 */

import { randomUUID } from "node:crypto";

import { createAbnClient, type AbnClient } from "@ratesassist/identity";
import type { EvaluationContext } from "@ratesassist/recovery-engine";

import type { DataStore } from "../data/index.js";
import { CommitTokenStore } from "./commitTokens.js";

/** RBAC role surface used by the contract's audit log. */
export type UserRole =
  | "officer"
  | "senior_officer"
  | "manager"
  | "admin";

/**
 * Demo tenant id — single hardcoded value because the adapter does not yet
 * enforce per-tenant isolation. Phase 2 replaces this with the
 * authenticated session's tenant.
 */
export const DEMO_TENANT_ID = "demo-tenant";

/**
 * Demo user identity. Replaced by Entra-issued claims in Phase 3
 * (authentication).
 */
export const DEMO_USER_ID = "demo-user";

/** Demo user role — least-privileged for the read-only demo flows. */
export const DEMO_USER_ROLE: UserRole = "officer";

/**
 * Per-request context. Immutable; constructed by
 * {@link createRequestContext} and threaded through handler invocations.
 */
export type RequestContext = {
  /** Tenant identifier the request is bound to. */
  readonly tenantId: string;
  /** Identifier of the user who initiated the request. */
  readonly userId: string;
  /** RBAC role of the initiating user. */
  readonly userRole: UserRole;
  /** Correlation id propagated to logs and error responses. */
  readonly correlationId: string;
  /** Injectable wall clock. Always call `ctx.now()` in handlers. */
  readonly now: () => Date;
  /** Recovery-engine evaluation snapshot. Built once per request. */
  readonly evaluationContext: EvaluationContext;
  /** ABN client. Demo mode = no GUID, mock-only. */
  readonly abnClient: AbnClient;
  /** Backing data store. Read here, mutate via {@link DataStore} only. */
  readonly store: DataStore;
  /** Commit-token store for two-phase mutating tools. */
  readonly commitTokens: CommitTokenStore;
};

/**
 * Build a fresh per-request context. The evaluation snapshot indexes the
 * data store's current state; recovery handlers get a consistent view for
 * the lifetime of the dispatch.
 */
export function createRequestContext(args: {
  readonly store: DataStore;
  readonly commitTokens: CommitTokenStore;
  readonly abnClient: AbnClient;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly userRole?: UserRole;
  readonly correlationId?: string;
  readonly now?: () => Date;
}): RequestContext {
  const evaluationContext: EvaluationContext = {
    properties: args.store.snapshotProperties(),
    ownersById: args.store.snapshotOwnersById(),
    tenementsByAssessment: args.store.snapshotTenementsByAssessment(),
  };
  return {
    tenantId: args.tenantId ?? DEMO_TENANT_ID,
    userId: args.userId ?? DEMO_USER_ID,
    userRole: args.userRole ?? DEMO_USER_ROLE,
    correlationId: args.correlationId ?? randomUUID(),
    now: args.now ?? (() => new Date()),
    evaluationContext,
    abnClient: args.abnClient,
    store: args.store,
    commitTokens: args.commitTokens,
  };
}

/**
 * Build the default ABN client used by the demo adapter. Mock-mode (no
 * GUID); strict mode is OFF because demos run offline. Real adapters
 * configure this from per-tenant secrets in the production wiring.
 *
 * Lazily initialised once per process and memoised in a module-scoped
 * variable. Constructing a fresh client per request would be harmless for
 * correctness (the underlying ABR cache in @ratesassist/identity is
 * module-level, so cache hits survive client churn), but a singleton keeps
 * any future per-instance state (rate limiters, telemetry counters) from
 * being silently reset on every dispatch.
 */
let _defaultAbnClient: AbnClient | undefined;

export function createDefaultAbnClient(): AbnClient {
  if (_defaultAbnClient === undefined) {
    _defaultAbnClient = createAbnClient({ strict: false });
  }
  return _defaultAbnClient;
}
