/**
 * Regression: cross-tenant IDOR on the generic tool dispatcher
 * POST /api/tools/[name].
 *
 * The dispatcher historically forwarded `input` to `runTool` WITHOUT the
 * `scope` (5th) arg, so `applyToolScope` never ran. The body-level
 * `findTenantOverrideInTree` scrub only blocks the explicit tenant keys
 * (tenantId/council/code) — it does NOT cover identifiers that encode the
 * tenant by PREFIX (assessmentNumber / ownerId / parentAssessmentNumber).
 * A TPS officer could therefore read OR draft-write another council's data
 * by passing e.g. {"input":{"assessmentNumber":"KAL-4401-12"}} (ship-ready
 * full-platform Pass A — pen-tester + api-endpoint-auditor, confirmed).
 *
 * The fix passes `{ tenantId, roles }` as the scope so the dispatcher runs
 * the same per-tool policy chokepoint (assessmentGuard / ownerGuard / RBAC)
 * the chat surface uses. Cross-tenant reads are masked as `not_found` (not
 * `forbidden`) so the surface can't be an existence oracle.
 *
 * This test pins the SECURE behaviour: if the scope arg is ever dropped
 * again, the cross-tenant cases below start returning ok:true + data and
 * fail loudly.
 */

import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { bootstrapTestEnv, makeSession, sessionHeader } from "./setup";
import { _resetAuthSecretCacheForTests } from "../../lib/auth";

type ToolsPOST = (
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) => Promise<Response>;

let toolsPOST: ToolsPOST;

// TPS = caller's tenant (see makeSession default). KAL = a DIFFERENT
// council seeded in the demo data — the cross-tenant target.
const OWN_TENANT_ASSESSMENT = "TPS-1102-91";
const FOREIGN_TENANT_ASSESSMENT = "KAL-4401-12";

beforeAll(async () => {
  await bootstrapTestEnv();
  _resetAuthSecretCacheForTests();
  const toolsRoute = await import("../../app/api/tools/[name]/route");
  toolsPOST = toolsRoute.POST as ToolsPOST;
});

beforeEach(async () => {
  await bootstrapTestEnv();
});

function toolReq(
  name: string,
  input: Record<string, unknown>,
  session: ReturnType<typeof makeSession>,
): NextRequest {
  return new NextRequest(new URL(`http://localhost/api/tools/${name}`), {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      ...sessionHeader(session),
      origin: "http://localhost",
    }),
    body: JSON.stringify({ input }),
  });
}

async function callTool(
  name: string,
  input: Record<string, unknown>,
  session: ReturnType<typeof makeSession>,
): Promise<{ ok: boolean; code?: string; data?: unknown }> {
  const res = await toolsPOST(toolReq(name, input, session), {
    params: Promise.resolve({ name }),
  });
  return (await res.json()) as { ok: boolean; code?: string; data?: unknown };
}

describe("POST /api/tools/[name] — cross-tenant IDOR is closed (scope enforced)", () => {
  it("READ: a TPS officer reading a foreign (KAL) assessment is masked not_found", async () => {
    const tps = makeSession(["rates_officer"]); // tenantId defaults to TPS
    const body = await callTool(
      "get_property_detail",
      { assessmentNumber: FOREIGN_TENANT_ASSESSMENT },
      tps,
    );
    expect(body.ok).toBe(false);
    expect(body.code).toBe("not_found");
    // The foreign council's data must NOT be returned.
    expect(body.data).toBeUndefined();
  });

  it("READ control: the SAME officer reading their OWN (TPS) assessment still succeeds", async () => {
    const tps = makeSession(["rates_officer"]);
    const body = await callTool(
      "get_property_detail",
      { assessmentNumber: OWN_TENANT_ASSESSMENT },
      tps,
    );
    // Proves the scope fix did not break legitimate same-tenant reads.
    expect(body.ok).toBe(true);
  });

  it("WRITE: a TPS admin drafting a note on a foreign (KAL) assessment is masked not_found", async () => {
    const tps = makeSession(["council_admin"]);
    const body = await callTool(
      "add_property_note",
      {
        assessmentNumber: FOREIGN_TENANT_ASSESSMENT,
        note: "cross-tenant write attempt",
        confirm: false,
      },
      tps,
    );
    expect(body.ok).toBe(false);
    expect(body.code).toBe("not_found");
  });

  it("RBAC: an explicit tenantId override in the body is still refused (defence-in-depth scrub)", async () => {
    const tps = makeSession(["rates_officer"]);
    const res = await toolsPOST(
      toolReq("get_property_detail", {
        assessmentNumber: OWN_TENANT_ASSESSMENT,
        tenantId: "KAL",
      }, tps),
      { params: Promise.resolve({ name: "get_property_detail" }) },
    );
    // The findTenantOverrideInTree scrub returns a hard 403 before dispatch.
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; code?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("forbidden");
  });
});
