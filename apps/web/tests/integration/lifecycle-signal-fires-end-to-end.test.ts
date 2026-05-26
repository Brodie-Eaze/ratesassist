/**
 * Integration: lifecycle change-detection fires through to candidates.
 *
 * The demo fixtures pre-seed change-detection entries for several WA
 * assessments (see MOCK_CHANGE_DETECTION_BY_ASSESSMENT in
 * apps/web/lib/clients.ts). One of those entries on `KAL-4401-12` carries
 * a `commercial_use_observed` kind with `correctLandUse: "Mining"` — the
 * recovery engine should fire the matching `change.commercial_use` signal
 * and surface it on the candidate's evidence array.
 *
 * This test exercises the cross-layer path:
 *   1. Bootstrap the env (auto-seed pglite from fixtures, including the
 *      change-detection map).
 *   2. Hit /api/audit/log via the audit route → confirm at least one
 *      audit row is recorded for a mutation (audit infra alive).
 *   3. Hit /api/recovery/candidates → assert the candidate for the
 *      target assessment exposes a lifecycle/change signal with the
 *      expected reasoning string in its evidence.
 */

import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { bootstrapTestEnv, makeSession, sessionHeader } from "./setup";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../../lib/auth";

const ASSESSMENT = "KAL-4401-12";

let candidatesGET: (req: NextRequest) => Promise<Response>;
let auditGET: (req: NextRequest) => Promise<Response>;
let toolsPOST: (
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) => Promise<Response>;

beforeAll(async () => {
  await bootstrapTestEnv();
  _resetAuthSecretCacheForTests();
  const candidatesRoute = await import("../../app/api/recovery/candidates/route");
  candidatesGET = candidatesRoute.GET as typeof candidatesGET;
  const auditRoute = await import("../../app/api/audit/log/route");
  auditGET = auditRoute.GET as typeof auditGET;
  const toolsRoute = await import("../../app/api/tools/[name]/route");
  toolsPOST = toolsRoute.POST as typeof toolsPOST;
});

beforeEach(async () => {
  await bootstrapTestEnv();
});

describe("lifecycle signal fires end-to-end", () => {
  it("emits an audit row, then surfaces the change.commercial_use signal on a candidate", async () => {
    // ship-ready iter3: /api/recovery/candidates now scopes by the
    // session tenant (derived from the candidate's assessment-number
    // prefix). The test fixture KAL-4401-12 lives in the "KAL"
    // tenant scope, so the session must hit KAL or be platform_admin.
    // We use platform_admin so both the audit-log path (records under
    // demo-tenant) AND the candidates scoping (would otherwise filter
    // out KAL) both work.
    const admin = makeSession(["platform_admin"], "demo-tenant");
    const supervisor = makeSession(["platform_admin"], "demo-tenant");

    // 1. Generate one audit entry by previewing + confirming an
    //    add_property_note (a known fail-closed-tolerant mutation that
    //    writes through the audit ring buffer).
    const headers = new Headers({
      "content-type": "application/json",
      ...sessionHeader(admin),
      origin: "http://localhost",
    });

    const previewReq = new NextRequest(
      new URL("http://localhost/api/tools/add_property_note"),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          input: {
            assessmentNumber: ASSESSMENT,
            note: "Lifecycle-signal integration test marker.",
            confirm: false,
          },
        }),
      },
    );
    const preview = (await (
      await toolsPOST(previewReq, {
        params: Promise.resolve({ name: "add_property_note" }),
      })
    ).json()) as { ok: boolean; commitToken?: string };
    expect(preview.ok).toBe(true);

    const confirmReq = new NextRequest(
      new URL("http://localhost/api/tools/add_property_note"),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          input: {
            assessmentNumber: ASSESSMENT,
            note: "Lifecycle-signal integration test marker.",
            confirm: true,
            commitToken: preview.commitToken,
          },
        }),
      },
    );
    const confirm = await toolsPOST(confirmReq, {
      params: Promise.resolve({ name: "add_property_note" }),
    });
    expect(confirm.status).toBe(200);

    // 2. /api/audit/log should now show ≥1 row.
    const auditReq = new NextRequest(
      new URL("http://localhost/api/audit/log?limit=10"),
      {
        method: "GET",
        headers: new Headers({ [SESSION_HEADER]: JSON.stringify(supervisor) }),
      },
    );
    const auditRes = await auditGET(auditReq);
    expect(auditRes.status).toBe(200);
    const auditBody = (await auditRes.json()) as {
      ok: boolean;
      data: { entries: Array<{ action: string; targetId: string }> };
    };
    expect(auditBody.ok).toBe(true);
    expect(auditBody.data.entries.length).toBeGreaterThan(0);
    const matching = auditBody.data.entries.find(
      (e) => e.action === "add_property_note" && e.targetId === ASSESSMENT,
    );
    expect(matching).toBeDefined();

    // 3. Recovery sweep should produce a candidate for KAL-4401-12 with
    //    the change.commercial_use signal fired.
    const clients = await import("../../lib/clients");
    await clients.invalidateEvaluationContext();

    const candReq = new NextRequest(
      new URL("http://localhost/api/recovery/candidates?limit=200"),
      {
        method: "GET",
        headers: new Headers({ [SESSION_HEADER]: JSON.stringify(supervisor) }),
      },
    );
    const candRes = await candidatesGET(candReq);
    expect(candRes.status).toBe(200);
    const candBody = (await candRes.json()) as {
      ok: boolean;
      data: {
        candidates: Array<{
          assessmentNumber: string;
          signals: Array<{ id: string; evidence: string }>;
        }>;
      };
    };
    expect(candBody.ok).toBe(true);
    const target = candBody.data.candidates.find(
      (c) => c.assessmentNumber === ASSESSMENT,
    );
    expect(target).toBeDefined();
    const lifecycleSignal = target!.signals.find((s) =>
      s.id.startsWith("change."),
    );
    expect(lifecycleSignal).toBeDefined();
    // Reasoning from MOCK_CHANGE_DETECTION_BY_ASSESSMENT for KAL-4401-12:
    // mentions "Nearmap" and "ROM pad".
    expect(lifecycleSignal!.evidence).toMatch(/Nearmap|ROM pad/i);
  }, 30_000);
});
