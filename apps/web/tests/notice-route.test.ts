/**
 * /api/evidence/[file]/notice route tests (JD-1).
 *
 * The notice route drafts a formal DRAFT rate-reclassification notice from
 * the same evidence pack the PDF route uses. These tests pin the same
 * auth / tenant / audit guarantees as the PDF route plus the notice-specific
 * behaviour:
 *
 *   - 200 + application/pdf (magic bytes) for a tenant-scoped assessment.
 *   - filename is the deterministic notice ref RN-<assessment>-<yyyymmdd>.
 *   - 404 cross-tenant, 401 no session, 400 bad shape.
 *   - a statutory_notice.drafted audit row lands after a successful draft.
 *   - platform_admin cross-tenant read works.
 *
 * Mirrors evidence-pdf-route.test.ts; drives the handler directly with a
 * stubbed x-session header.
 */

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
process.env["RA_TOOL_TRANSPORT"] = "inproc";

import type { Role, Session } from "@ratesassist/contract";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../lib/auth";

vi.resetModules();
const { GET: noticeGET } = await import("../app/api/evidence/[file]/notice/route");

beforeAll(() => {
  _resetAuthSecretCacheForTests();
});

beforeEach(async () => {
  const inproc = await import("@ratesassist/adapter-demo/inproc");
  inproc._resetInproc();
  const audit = await import("@ratesassist/adapter-demo/audit");
  audit._resetForTests();
  // The notice route carries a 5/min composite rate limit; reset buckets so
  // the multi-case suite never trips it.
  const rl = await import("../lib/rate-limit");
  rl.__resetRateLimitBucketsForTests();
});

function freshSession(roles: Role[], tenantId = "TPS"): Session {
  const now = Date.now();
  return {
    userId: "u-notice-1",
    email: "u-notice-1@example.com",
    displayName: "Notice Test Officer",
    tenantId,
    roles,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(),
  };
}

function reqWith(
  session: Session | null,
  url = "http://localhost/api/evidence/TPS-1102-91/notice",
): NextRequest {
  const headers = new Headers();
  if (session) headers.set(SESSION_HEADER, JSON.stringify(session));
  return new NextRequest(new URL(url), { method: "GET", headers });
}

describe("GET /api/evidence/[file]/notice", () => {
  it("401 when no session", async () => {
    const res = await noticeGET(reqWith(null), {
      params: Promise.resolve({ file: "TPS-1102-91" }),
    });
    expect(res.status).toBe(401);
  });

  it("200 + application/pdf with a DRAFT notice filename", async () => {
    const res = await noticeGET(reqWith(freshSession(["rates_officer"])), {
      params: Promise.resolve({ file: "TPS-1102-91" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/attachment/);
    // Filename is the deterministic notice ref RN-<assessment>-<yyyymmdd>.
    expect(cd).toMatch(/filename="RN-TPS-1102-91-\d{8}\.pdf"/);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.slice(0, 5).toString("utf8")).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(1000);
  });

  it("404s for cross-tenant access (KAL session reading a TPS asset)", async () => {
    const res = await noticeGET(
      reqWith(
        freshSession(["rates_officer"], "KAL"),
        "http://localhost/api/evidence/TPS-1102-91/notice",
      ),
      { params: Promise.resolve({ file: "TPS-1102-91" }) },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("not_found");
  });

  it("400s for an invalid assessment-number shape", async () => {
    const res = await noticeGET(
      reqWith(
        freshSession(["rates_officer"]),
        "http://localhost/api/evidence/lower-case-bad/notice",
      ),
      { params: Promise.resolve({ file: "lower-case-bad" }) },
    );
    expect(res.status).toBe(400);
  });

  it("writes a statutory_notice.drafted audit row after a successful draft", async () => {
    const session = freshSession(["rates_officer"]);
    const res = await noticeGET(reqWith(session), {
      params: Promise.resolve({ file: "TPS-1102-91" }),
    });
    expect(res.status).toBe(200);

    const audit = await import("@ratesassist/adapter-demo/audit");
    const rows = audit.readRecent("TPS", 50);
    const noticeRows = rows.filter((r) => r.action === "statutory_notice.drafted");
    expect(noticeRows.length).toBe(1);
    const row = noticeRows[0]!;
    expect(row.tenantId).toBe("TPS");
    expect(row.actorId).toBe(session.userId);
    expect(row.actorKind).toBe("user");
    expect(row.targetType).toBe("statutory_notice");
    expect(row.targetId).toMatch(/^RN-TPS-1102-91-\d{8}$/);
  });

  it("platform_admin can draft a notice for a TPS asset from a non-TPS tenant", async () => {
    const res = await noticeGET(
      reqWith(
        freshSession(["platform_admin"], "OTHER"),
        "http://localhost/api/evidence/TPS-1102-91/notice",
      ),
      { params: Promise.resolve({ file: "TPS-1102-91" }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });
});
