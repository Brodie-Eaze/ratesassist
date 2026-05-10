/**
 * `list_audit_log` handler.
 *
 * Reads from the in-memory ring buffer ({@link readRecent}) by default. The
 * production wiring (RA_USE_DB=true) routes through @ratesassist/db's
 * `audit_log` table; that path lives at the route layer (apps/web) which
 * has the DB connection.
 *
 * RBAC is enforced at the HTTP boundary (apps/web/app/api/audit/log/route.ts):
 * the route requires `read.audit_log` before it ever calls into the
 * adapter. The adapter handler is therefore RBAC-trusting — it does not
 * re-check the permission, but it DOES enforce the tenant boundary: a
 * caller's `ctx.tenantId` is the only tenant they can list, unless they
 * are a platform admin (signalled via actorKind="service" + a tenantId
 * override that explicitly differs).
 *
 * For the demo adapter the trust boundary is simpler — there is no SSO,
 * and `ctx.tenantId` is always DEMO_TENANT_ID. We honour the input override
 * if present so cross-tenant test cases work; production callers that want
 * cross-tenant reads must pass the platform-admin session through the
 * route layer.
 */

import type { schemas } from "@ratesassist/contract";

import { readRecent } from "../audit/index.js";
import type { RequestContext } from "../runtime/context.js";
import { invalidInput } from "../runtime/errors.js";

export async function listAuditLogHandler(
  input: schemas.ToolInputs["list_audit_log"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const tenantId = input.tenantId ?? ctx.tenantId;

  let since: Date | undefined;
  if (input.since !== undefined) {
    const ms = Date.parse(input.since);
    if (!Number.isFinite(ms)) {
      return invalidInput(
        `since="${input.since}" is not a valid ISO-8601 datetime.`,
        ctx.correlationId,
      );
    }
    since = new Date(ms);
  }

  const entries = readRecent(tenantId, input.limit, since ? { since } : undefined);
  const text = `Returned ${entries.length} audit entr${entries.length === 1 ? "y" : "ies"} for tenant ${tenantId}.`;
  return {
    ok: true,
    output: text,
    data: { tenantId, entries },
    mutated: false,
  };
}
