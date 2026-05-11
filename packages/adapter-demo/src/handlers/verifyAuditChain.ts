/**
 * `verify_audit_chain` handler.
 *
 * Reads recent audit rows for the bound tenant (or all tenants if the caller
 * is a platform admin) and runs {@link verifyChain} over them. Returns a
 * structured ok/break result. RBAC (read.audit_log) is enforced at the HTTP
 * boundary in apps/web; this handler is RBAC-trusting but does enforce tenant
 * scope: cross-tenant verification is only honoured for actorKind="service"
 * acting on a tenantId override (the route layer's platform_admin path).
 *
 * In-memory eviction will surface as a break at index 0 — by design, see
 * the file-level comment in ./audit/inMemoryAuditStore.ts.
 */

import type { schemas } from "@ratesassist/contract";

import {
  readChainOrdered,
  readChainOrderedAllTenants,
  verifyChain,
  type AuditRowWithHashes,
} from "../audit/index.js";
import type { RequestContext } from "../runtime/context.js";

export async function verifyAuditChainHandler(
  input: schemas.ToolInputs["verify_audit_chain"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const tenantId = input.tenantId ?? ctx.tenantId;
  const allTenants =
    tenantId === "*" && ctx.actorKind === "service";
  const rows: ReadonlyArray<AuditRowWithHashes> = allTenants
    ? (readChainOrderedAllTenants(input.limit) as ReadonlyArray<AuditRowWithHashes>)
    : (readChainOrdered(tenantId, input.limit) as ReadonlyArray<AuditRowWithHashes>);

  const result = verifyChain(rows);
  if (result.ok) {
    return {
      ok: true,
      output: `Verified ${result.verified} audit row${result.verified === 1 ? "" : "s"} for tenant ${tenantId}. Chain intact.`,
      data: {
        tenantId,
        verified: result.verified,
        allOk: true,
      },
      mutated: false,
    };
  }
  return {
    ok: true,
    output:
      `Chain break detected at row index ${result.firstBreakIndex} for tenant ${tenantId}. ` +
      `Expected hash ${result.expectedHash.slice(0, 12)}…, got ${result.actualHash.slice(0, 12)}…. ` +
      `In-memory store: this may reflect ring-buffer eviction rather than tampering.`,
    data: {
      tenantId,
      verified: result.firstBreakIndex,
      allOk: false,
      breakIndex: result.firstBreakIndex,
      expectedHash: result.expectedHash,
      actualHash: result.actualHash,
    },
    mutated: false,
  };
}
