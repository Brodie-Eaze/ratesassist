/**
 * /api/evidence/[file]/pdf route tests.
 *
 * Pilot acceptance criterion #6 requires the council to generate at least
 * one statutory rate certificate through the platform during the 60-day
 * pilot. The PDF route is that certificate. These tests pin:
 *
 *   - 200 + application/pdf for a tenant-scoped assessment with signals
 *     firing (the demo fixture TPS-1102-91).
 *   - 404 for cross-tenant (KAL session reading a TPS asset).
 *   - 401 without a session.
 *   - A `pdf.generated` row lands in the audit buffer after a successful
 *     download.
 *
 * The tests construct NextRequest objects directly with a stubbed
 * x-session header so they exercise the route handler in isolation from
 * middleware. They follow the pattern in audit-route.test.ts — drive
 * through the same code path the route uses, then assert audit state
 * from the same in-process module realm.
 */

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
// Force in-process transport — same reasoning as audit-route.test.ts.
process.env["RA_TOOL_TRANSPORT"] = "inproc";

import type { Role, Session } from "@ratesassist/contract";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../lib/auth";

vi.resetModules();
const { GET: pdfGET } = await import("../app/api/evidence/[file]/pdf/route");

beforeAll(() => {
  _resetAuthSecretCacheForTests();
});

beforeEach(async () => {
  // Reset the in-proc adapter store + audit buffer between cases so
  // assertions on row counts are deterministic.
  const inproc = await import("@ratesassist/adapter-demo/inproc");
  inproc._resetInproc();
  const audit = await import("@ratesassist/adapter-demo/audit");
  audit._resetForTests();
});

function freshSession(roles: Role[], tenantId = "TPS"): Session {
  const now = Date.now();
  return {
    userId: "u-pdf-1",
    email: "u-pdf-1@example.com",
    displayName: "PDF Test Operator",
    tenantId,
    roles,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(),
  };
}

function reqWith(
  session: Session | null,
  url = "http://localhost/api/evidence/TPS-1102-91/pdf",
): NextRequest {
  const headers = new Headers();
  if (session) headers.set(SESSION_HEADER, JSON.stringify(session));
  return new NextRequest(new URL(url), { method: "GET", headers });
}

describe("GET /api/evidence/[file]/pdf", () => {
  it("401 when no session", async () => {
    const res = await pdfGET(reqWith(null), {
      params: Promise.resolve({ file: "TPS-1102-91" }),
    });
    expect(res.status).toBe(401);
  });

  it("200 + application/pdf for a tenant-scoped assessment", async () => {
    const res = await pdfGET(reqWith(freshSession(["rates_officer"])), {
      params: Promise.resolve({ file: "TPS-1102-91" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    expect(res.headers.get("content-disposition")).toMatch(/\.pdf"$/);
    const body = Buffer.from(await res.arrayBuffer());
    // Sanity-check the magic bytes — every PDF starts with "%PDF-".
    expect(body.slice(0, 5).toString("utf8")).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(1000);
  });

  it("404s for cross-tenant access (KAL session reading a TPS asset)", async () => {
    const res = await pdfGET(
      reqWith(
        freshSession(["rates_officer"], "KAL"),
        "http://localhost/api/evidence/TPS-1102-91/pdf",
      ),
      { params: Promise.resolve({ file: "TPS-1102-91" }) },
    );
    expect(res.status).toBe(404);
    // Body shape — fail() returns the standard envelope.
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("not_found");
  });

  it("400s for an invalid assessment-number shape", async () => {
    const res = await pdfGET(
      reqWith(
        freshSession(["rates_officer"]),
        "http://localhost/api/evidence/lower-case-bad/pdf",
      ),
      { params: Promise.resolve({ file: "lower-case-bad" }) },
    );
    expect(res.status).toBe(400);
  });

  it("404s when the assessment has no firing signals", async () => {
    // Random unknown assessment within the TPS tenant prefix — the
    // engine returns no_property / no_signals; the route normalises both
    // to 404.
    const res = await pdfGET(
      reqWith(
        freshSession(["rates_officer"]),
        "http://localhost/api/evidence/TPS-9999-99/pdf",
      ),
      { params: Promise.resolve({ file: "TPS-9999-99" }) },
    );
    expect(res.status).toBe(404);
  });

  it("writes a pdf.generated audit row after a successful download", async () => {
    const session = freshSession(["rates_officer"]);
    const res = await pdfGET(reqWith(session), {
      params: Promise.resolve({ file: "TPS-1102-91" }),
    });
    expect(res.status).toBe(200);

    const audit = await import("@ratesassist/adapter-demo/audit");
    const rows = audit.readRecent("TPS", 50);
    const pdfRows = rows.filter((r) => r.action === "pdf.generated");
    expect(pdfRows.length).toBe(1);
    const row = pdfRows[0]!;
    expect(row.tenantId).toBe("TPS");
    expect(row.actorId).toBe(session.userId);
    expect(row.actorKind).toBe("user");
    expect(row.targetType).toBe("evidence_pack");
    // Pack id has the deterministic shape EP-<assessment>-<yyyymmdd>.
    expect(row.targetId).toMatch(/^EP-TPS-1102-91-\d{8}$/);
  });

  it("platform_admin can read a TPS asset from a non-TPS tenant", async () => {
    // Mirrors the cross-tenant exception in sessionMayAccessTenant —
    // platform_admin bypasses the prefix guard for support / audit.
    const res = await pdfGET(
      reqWith(
        freshSession(["platform_admin"], "OTHER"),
        "http://localhost/api/evidence/TPS-1102-91/pdf",
      ),
      { params: Promise.resolve({ file: "TPS-1102-91" }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });
});
