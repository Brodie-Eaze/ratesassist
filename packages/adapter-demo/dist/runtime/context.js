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
import { createAbnClient } from "@ratesassist/identity";
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
export const DEMO_USER_ROLE = "officer";
/**
 * Build a fresh per-request context. The evaluation snapshot indexes the
 * data store's current state; recovery handlers get a consistent view for
 * the lifetime of the dispatch.
 */
export function createRequestContext(args) {
    const evaluationContext = {
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
 */
export function createDefaultAbnClient() {
    return createAbnClient({ strict: false });
}
//# sourceMappingURL=context.js.map