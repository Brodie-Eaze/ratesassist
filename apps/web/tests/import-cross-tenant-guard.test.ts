/**
 * F-004 regression suite — cross-tenant WRITE IDOR.
 *
 * The pen-test showed a council_admin bound to tenant TPS could POST
 * `/api/councils/KAL/import` (and the rate-schedule / landgate / WC sibling
 * routes) to overwrite ANOTHER council's books while the audit trail recorded
 * the attacker's own tenant. The fix routes every `/api/councils/[code]/*`
 * mutator through the shared `assertSessionMayWriteCouncil` guard.
 *
 * This file pins that guard on ALL FOUR import routes at once, plus the
 * read-side `sessionMayAccessTenant` guard added to `/api/notify`. The intent
 * is that adding a fifth import route without the guard fails CI here.
 *
 * Design note — why empty `{}` bodies prove the fix:
 *   The guard fires BEFORE body parsing. So for an identical empty body:
 *     - cross-tenant  → 403 (guard refuses, never reaches body validation)
 *     - same-tenant   → 400 (guard passes, body validation rejects "csvText required")
 *     - platform_admin → 400 (admin bypass, body validation rejects)
 *   The 403-vs-400 contrast on the SAME payload is the assertion that the
 *   guard is tenant-scoped — and it avoids coupling the test to each route's
 *   specific CSV schema.
 */

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
process.env["RA_TOOL_TRANSPORT"] = "inproc";

import type { Role, Session } from "@ratesassist/contract";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../lib/auth";

vi.resetModules();

type CodePost = (
  req: NextRequest,
  ctx: { params: Promise<{ code: string }> },
) => Promise<Response>;
type PlainPost = (req: NextRequest) => Promise<Response>;

const importRoute = await import("../app/api/councils/[code]/import/route");
const rateScheduleRoute = await import(
  "../app/api/councils/[code]/import-rate-schedule/route"
);
const landgateRoute = await import(
  "../app/api/councils/[code]/import-landgate-title-data/route"
);
const wcRoute = await import(
  "../app/api/councils/[code]/import-wc-eligibility/route"
);
const notifyRoute = await import("../app/api/notify/route");

const IMPORT_ROUTES: { slug: string; post: CodePost }[] = [
  { slug: "import", post: importRoute.POST as unknown as CodePost },
  {
    slug: "import-rate-schedule",
    post: rateScheduleRoute.POST as unknown as CodePost,
  },
  {
    slug: "import-landgate-title-data",
    post: landgateRoute.POST as unknown as CodePost,
  },
  {
    slug: "import-wc-eligibility",
    post: wcRoute.POST as unknown as CodePost,
  },
];
const notifyPOST = notifyRoute.POST as unknown as PlainPost;

beforeAll(() => {
  _resetAuthSecretCacheForTests();
});

beforeEach(async () => {
  const inproc = await import("@ratesassist/adapter-demo/inproc");
  inproc._resetInproc();
  const audit = await import("@ratesassist/adapter-demo/audit");
  audit._resetForTests();
});

function session(roles: Role[], tenantId = "TPS"): Session {
  const now = Date.now();
  return {
    userId: "u1",
    email: "u1@example.com",
    displayName: "User One",
    tenantId,
    roles,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  };
}

function importReq(
  slug: string,
  code: string,
  body: unknown,
  s: Session | null,
): NextRequest {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (s) headers.set(SESSION_HEADER, JSON.stringify(s));
  return new NextRequest(
    new URL(`http://localhost/api/councils/${code}/${slug}`),
    { method: "POST", headers, body: JSON.stringify(body) },
  );
}

function withParams(code: string) {
  return { params: Promise.resolve({ code }) };
}

function notifyReq(body: unknown, s: Session | null): NextRequest {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (s) headers.set(SESSION_HEADER, JSON.stringify(s));
  return new NextRequest(new URL("http://localhost/api/notify"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

type Envelope = { ok: boolean; code?: string; message?: string };

for (const { slug, post } of IMPORT_ROUTES) {
  describe(`F-004 write guard — /api/councils/[code]/${slug}`, () => {
    it("401 when unauthenticated", async () => {
      const res = await post(importReq(slug, "TPS", {}, null), withParams("TPS"));
      expect(res.status).toBe(401);
    });

    it("403 for rates_officer (lacks write.user_management)", async () => {
      const res = await post(
        importReq(slug, "TPS", {}, session(["rates_officer"])),
        withParams("TPS"),
      );
      expect(res.status).toBe(403);
    });

    it("403 cross-tenant: TPS council_admin cannot write into KAL", async () => {
      // Guard fires before body parsing — the empty body never gets a chance
      // to 400, proving the refusal is tenant-scoped not input-driven.
      const res = await post(
        importReq(slug, "KAL", {}, session(["council_admin"], "TPS")),
        withParams("KAL"),
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as Envelope;
      expect(body.code).toBe("forbidden");
      // Message must name the attempted council so an operator hand-fixing a
      // misrouted import gets an honest "wrong tenant" error.
      expect(body.message ?? "").toContain("KAL");
    });

    it("same-tenant council_admin passes the guard (400 on empty body, not 403)", async () => {
      const res = await post(
        importReq(slug, "TPS", {}, session(["council_admin"], "TPS")),
        withParams("TPS"),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as Envelope;
      expect(body.code).toBe("invalid_input");
    });

    it("platform_admin bypasses the guard cross-tenant (400 on empty body, not 403)", async () => {
      const res = await post(
        importReq(slug, "KAL", {}, session(["platform_admin"], "TPS")),
        withParams("KAL"),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as Envelope;
      expect(body.code).toBe("invalid_input");
    });
  });
}

describe("F-004 read guard — POST /api/notify", () => {
  const validBody = (assessment: string) => ({
    recipientEmail: "clerk@tomprice.wa.gov.au",
    subject: "Recovery candidate review",
    candidateAssessmentNumber: assessment,
    severity: "high" as const,
  });

  it("401 when unauthenticated", async () => {
    const res = await notifyPOST(notifyReq(validBody("TPS-1102-91"), null));
    expect(res.status).toBe(401);
  });

  it("403 for ratepayer (lacks write.draft_mutation)", async () => {
    const res = await notifyPOST(
      notifyReq(validBody("TPS-1102-91"), session(["ratepayer"])),
    );
    expect(res.status).toBe(403);
  });

  it("404 (not 200/403) when TPS officer notifies about a KAL candidate", async () => {
    // Masked as 404 so the endpoint can't be an existence oracle for other
    // tenants' assessment numbers.
    const res = await notifyPOST(
      notifyReq(validBody("KAL-4401-12"), session(["rates_officer"], "TPS")),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as Envelope;
    expect(body.code).toBe("not_found");
  });

  it("200 when TPS officer notifies about their own TPS candidate", async () => {
    // Console transport (no RA_NOTIFY_PROVIDER) — dispatched, never sent.
    const res = await notifyPOST(
      notifyReq(validBody("TPS-1102-91"), session(["rates_officer"], "TPS")),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
