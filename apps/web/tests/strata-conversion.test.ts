/**
 * Strata-conversion wizard + page — regression tests.
 *
 * The wizard is a client component and the apps/web vitest harness is
 * Node-only with no DOM. So we exercise:
 *
 *   - The wizard's source declares all five lifecycle states and the
 *     orthogonal `withdrawn` exit.
 *   - The page's source wires the wizard to the two-phase commit API
 *     (POST /api/strata/:assessment/request-conversion).
 *   - The API route enforces RBAC (write.commit_mutation), input shape,
 *     and rejects non-JSON bodies.
 *
 * Rendering and clicks are covered upstream by Playwright; here we lock
 * the wizard's lifecycle-state map, the page's API contract, and the
 * route's RBAC + validation behaviour at the unit level.
 */

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
process.env["RA_TOOL_TRANSPORT"] = "inproc";

import type { Role, Session } from "@ratesassist/contract";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../lib/auth";

vi.resetModules();
const { POST: strataPOST } = await import(
  "../app/api/strata/[assessment]/request-conversion/route"
);

beforeAll(() => {
  _resetAuthSecretCacheForTests();
});

beforeEach(async () => {
  const inproc = await import("@ratesassist/adapter-demo/inproc");
  inproc._resetInproc();
  const audit = await import("@ratesassist/adapter-demo/audit");
  audit._resetForTests();
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function session(roles: Role[], tenantId = "KAL"): Session {
  const now = Date.now();
  return {
    userId: "u-strata",
    email: "u@example.com",
    displayName: "User",
    tenantId,
    roles,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  };
}

function req(
  assessment: string,
  body: unknown,
  s: Session | null,
): NextRequest {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (s) headers.set(SESSION_HEADER, JSON.stringify(s));
  return new NextRequest(
    new URL(`http://localhost/api/strata/${assessment}/request-conversion`),
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
}

function ctx(assessment: string): { params: Promise<{ assessment: string }> } {
  return { params: Promise.resolve({ assessment }) };
}

// ----------------------------------------------------------------------------
// Component-source contract
// ----------------------------------------------------------------------------

describe("StrataConversionWizard — component source declares the state machine", () => {
  const src = readFileSync(
    join(__dirname, "..", "components", "StrataConversionWizard.tsx"),
    "utf8",
  );

  it("exports the StrataConversionWizard component and ChildCt type", () => {
    expect(src).toContain("export function StrataConversionWizard");
    expect(src).toContain("export type ChildCt");
  });

  it("declares every lifecycle state vertex (5 pipeline + withdrawn)", () => {
    expect(src).toContain("parent_strata_detected");
    expect(src).toContain("strata_plan_uploaded");
    expect(src).toContain("children_previewed");
    expect(src).toContain("children_imported");
    expect(src).toContain("parent_superseded");
    expect(src).toContain("withdrawn");
  });

  it("renders Step1 (parent confirmation) for parent_strata_detected", () => {
    expect(src).toContain("Step 1");
    expect(src).toContain("Confirm parent title");
  });

  it("renders Step2 (upload or paste) accepting <= 2 row min", () => {
    expect(src).toContain("Step 2");
    expect(src).toContain("Upload plan or paste");
    expect(src).toContain("At least 2 child CTs are required");
  });

  it("renders Step3 (preview proposed children) before import", () => {
    expect(src).toContain("Step 3");
    expect(src).toContain("Preview proposed children");
  });

  it("renders Step4 (done) and Step5 (superseded)", () => {
    expect(src).toContain("Child properties imported");
    expect(src).toContain("Parent record superseded");
  });

  it("renders a Withdraw card with required-reason gating", () => {
    expect(src).toContain("Reason is required to withdraw");
    expect(src).toContain("strata-withdraw-submit");
  });

  it("renders a lifecycle progress bar with role=progressbar", () => {
    expect(src).toContain('role="progressbar"');
    expect(src).toContain("Strata conversion lifecycle");
  });

  it("uses Australian English (Strata conversion, Upload plan, Confirm and import)", () => {
    expect(src).toContain("Strata conversion");
    expect(src).toContain("Upload plan");
    expect(src).toContain("Confirm and import");
  });

  it("carries aria-labels on interactive elements", () => {
    expect(src).toContain("aria-label=");
    expect(src).toMatch(/aria-labelledby="step1-heading"/);
    expect(src).toMatch(/aria-labelledby="step2-heading"/);
    expect(src).toMatch(/aria-labelledby="step3-heading"/);
  });
});

describe("/strata/[assessment] page — wires the wizard to the two-phase commit API", () => {
  const src = readFileSync(
    join(__dirname, "..", "app", "strata", "[assessment]", "page.tsx"),
    "utf8",
  );

  it("imports the StrataConversionWizard", () => {
    expect(src).toContain("StrataConversionWizard");
    expect(src).toContain("@/components/StrataConversionWizard");
  });

  it("POSTs against /api/strata/:assessment/request-conversion", () => {
    expect(src).toContain("/api/strata/${assessment}/request-conversion");
  });

  it("drives the lifecycle through the documented state vertices", () => {
    expect(src).toContain('toState: "strata_plan_uploaded"');
    expect(src).toContain('toState: "children_previewed"');
    expect(src).toContain('toState: "children_imported"');
    expect(src).toContain('toState: "withdrawn"');
  });

  it("uses two-phase commit (preview then confirm)", () => {
    expect(src).toContain("confirm: false");
    expect(src).toContain("confirm: true");
    expect(src).toContain("commitToken");
  });

  it("links back to /recovery?signal=strata_conversion", () => {
    expect(src).toContain("/recovery?signal=strata_conversion");
  });
});

// ----------------------------------------------------------------------------
// API route — RBAC + input validation + happy-path two-phase commit
// ----------------------------------------------------------------------------

describe("POST /api/strata/:assessment/request-conversion — RBAC + validation", () => {
  it("401 without a session", async () => {
    const r = await strataPOST(
      req("KAL-7777-01", { toState: "strata_plan_uploaded", confirm: false }, null),
      ctx("KAL-7777-01"),
    );
    expect(r.status).toBe(401);
  });

  it("403 for a plain rates_officer (write.commit_mutation required)", async () => {
    const s = session(["rates_officer"]);
    const r = await strataPOST(
      req("KAL-7777-01", { toState: "strata_plan_uploaded", confirm: false }, s),
      ctx("KAL-7777-01"),
    );
    expect(r.status).toBe(403);
  });

  it("rejects an unknown toState as 400", async () => {
    const s = session(["rates_supervisor"]);
    const r = await strataPOST(
      req("KAL-7777-01", { toState: "fictional_state", confirm: false }, s),
      ctx("KAL-7777-01"),
    );
    expect(r.status).toBe(400);
    const body = (await r.json()) as { code: string };
    expect(body.code).toBe("invalid_input");
  });

  it("rejects an invalid assessment number in the path as 400", async () => {
    const s = session(["rates_supervisor"]);
    const r = await strataPOST(
      req("kal_777*", { toState: "strata_plan_uploaded", confirm: false }, s),
      ctx("kal_777*"),
    );
    expect(r.status).toBe(400);
  });

  it("rejects a non-JSON body as 400", async () => {
    const s = session(["rates_supervisor"]);
    const headers = new Headers();
    headers.set("content-type", "application/json");
    headers.set(SESSION_HEADER, JSON.stringify(s));
    const r = await strataPOST(
      new NextRequest(
        new URL(
          "http://localhost/api/strata/KAL-7777-01/request-conversion",
        ),
        { method: "POST", headers, body: "not-json" },
      ),
      ctx("KAL-7777-01"),
    );
    expect(r.status).toBe(400);
  });

  it("rejects withdrawn without a reason at 400", async () => {
    const s = session(["rates_supervisor"]);
    // No reason supplied — handler returns invalid_input.
    const r = await strataPOST(
      req("KAL-7777-01", { toState: "withdrawn", confirm: false }, s),
      ctx("KAL-7777-01"),
    );
    expect(r.status).toBe(400);
  });

  it("happy path two-phase: preview returns a commit token; confirm imports", async () => {
    const s = session(["rates_supervisor"]);
    // Lift parent_strata_detected → strata_plan_uploaded (preview + confirm).
    const preview1 = await strataPOST(
      req(
        "KAL-7777-01",
        {
          toState: "strata_plan_uploaded",
          childCts: [
            { volume: "3801", folio: "211" },
            { volume: "3801", folio: "211A" },
          ],
          confirm: false,
        },
        s,
      ),
      ctx("KAL-7777-01"),
    );
    expect(preview1.status).toBe(200);
    const previewBody1 = (await preview1.json()) as {
      ok: boolean;
      commitToken?: string;
      mutated?: boolean;
    };
    expect(previewBody1.ok).toBe(true);
    expect(typeof previewBody1.commitToken).toBe("string");
    expect(previewBody1.mutated).toBe(false);

    const commit1 = await strataPOST(
      req(
        "KAL-7777-01",
        {
          toState: "strata_plan_uploaded",
          childCts: [
            { volume: "3801", folio: "211" },
            { volume: "3801", folio: "211A" },
          ],
          confirm: true,
          commitToken: previewBody1.commitToken!,
        },
        s,
      ),
      ctx("KAL-7777-01"),
    );
    expect(commit1.status).toBe(200);
    const commitBody1 = (await commit1.json()) as {
      ok: boolean;
      mutated?: boolean;
    };
    expect(commitBody1.ok).toBe(true);
    expect(commitBody1.mutated).toBe(true);
  });

  it("404 on unknown parent assessment", async () => {
    const s = session(["rates_supervisor"]);
    const r = await strataPOST(
      req("ZZZ-9999-99", { toState: "strata_plan_uploaded", confirm: false }, s),
      ctx("ZZZ-9999-99"),
    );
    expect(r.status).toBe(404);
  });

  it("does not skip states — children_imported from detected is rejected", async () => {
    const s = session(["rates_supervisor"]);
    const r = await strataPOST(
      req(
        "KAL-7777-01",
        {
          toState: "children_imported",
          childCts: [
            { volume: "3801", folio: "211" },
            { volume: "3801", folio: "211A" },
          ],
          confirm: false,
        },
        s,
      ),
      ctx("KAL-7777-01"),
    );
    expect(r.status).toBe(400);
  });

  it("withdrawn happy path requires a reason and returns ok", async () => {
    const s = session(["rates_supervisor"]);
    const preview = await strataPOST(
      req(
        "KAL-7777-01",
        {
          toState: "withdrawn",
          reason: "Landgate clarified this is a re-titling, not a subdivision.",
          confirm: false,
        },
        s,
      ),
      ctx("KAL-7777-01"),
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      ok: boolean;
      commitToken?: string;
    };
    expect(previewBody.ok).toBe(true);
    expect(typeof previewBody.commitToken).toBe("string");

    const commit = await strataPOST(
      req(
        "KAL-7777-01",
        {
          toState: "withdrawn",
          reason: "Landgate clarified this is a re-titling, not a subdivision.",
          confirm: true,
          commitToken: previewBody.commitToken!,
        },
        s,
      ),
      ctx("KAL-7777-01"),
    );
    expect(commit.status).toBe(200);
    const commitBody = (await commit.json()) as {
      ok: boolean;
      mutated?: boolean;
    };
    expect(commitBody.ok).toBe(true);
    expect(commitBody.mutated).toBe(true);
  });

  it("confirm without a commitToken returns 400/invalid_input", async () => {
    const s = session(["rates_supervisor"]);
    const r = await strataPOST(
      req(
        "KAL-7777-01",
        {
          toState: "strata_plan_uploaded",
          childCts: [
            { volume: "3801", folio: "211" },
            { volume: "3801", folio: "211A" },
          ],
          confirm: true,
        },
        s,
      ),
      ctx("KAL-7777-01"),
    );
    expect(r.status).toBe(400);
  });
});
