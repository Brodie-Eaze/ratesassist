/**
 * /api/audit/log route tests.
 *
 * Covers:
 *   - 401 when no session header is present (middleware would have rejected
 *     the request, but the route still self-checks for defence-in-depth).
 *   - 403 when the session lacks read.audit_log (rates_officer).
 *   - 200 + entries for rates_supervisor.
 *   - 403 cross-tenant read blocked unless platform_admin.
 *
 * The tests construct NextRequest objects directly with a stubbed x-session
 * header so they exercise the route handler in isolation from middleware.
 */

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
// Force in-process transport so the route's tool dispatch and our test's
// audit-buffer reads share the same module-instance buffer. The stdio
// child process would have its own buffer, defeating the integration check.
process.env["RA_TOOL_TRANSPORT"] = "inproc";

import type { Role, Session } from "@ratesassist/contract";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../lib/auth";

// mcp-client resolves the transport at module load and caches it. If a
// previous test file already imported mcp-client we're stuck with whatever
// transport it picked — so we explicitly drop the cache here and re-import
// the route + tools below. This matters when audit-route runs alongside
// other apps/web tests.
vi.resetModules();
const { GET: auditGET } = await import("../app/api/audit/log/route");
const { runTool } = await import("../lib/tools");

beforeAll(() => {
  _resetAuthSecretCacheForTests();
});

// Drive a real mutation through the same code path the route uses. This
// lands an audit row in the in-process buffer the route reads from, so the
// test exercises the full attribution flow rather than poking the buffer
// directly (which would create cross-realm module-instance issues).
async function seedAuditEntry(tenantId: string, actorId: string): Promise<void> {
  const preview = await runTool(
    "update_owner_contact",
    { ownerId: "O-WA-001", newPhone: `08 ${Math.floor(Math.random() * 9000 + 1000)} 0000` },
    `seed-${actorId}`,
    { tenantId, actorId, actorKind: "user" },
  );
  if (!preview.ok || !preview.commitToken) return;
  await runTool(
    "update_owner_contact",
    {
      ownerId: "O-WA-001",
      newPhone: `08 ${Math.floor(Math.random() * 9000 + 1000)} 0000`,
      confirm: true,
      commitToken: preview.commitToken,
    },
    `seed-confirm-${actorId}`,
    { tenantId, actorId, actorKind: "user" },
  );
}

beforeEach(async () => {
  // Reset the in-proc buffer via the inproc module. Importing it through
  // the route's same path keeps us pointing at the route's module instance.
  const inproc = await import("@ratesassist/adapter-demo/inproc");
  // _resetInproc clears the singleton store + commit tokens; we additionally
  // reset the audit buffer through the same module realm.
  inproc._resetInproc();
  const audit = await import("@ratesassist/adapter-demo/audit");
  audit._resetForTests();
});

function freshSession(roles: Role[], tenantId = "TPS"): Session {
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

function reqWith(session: Session | null, url = "http://localhost/api/audit/log"): NextRequest {
  const headers = new Headers();
  if (session) headers.set(SESSION_HEADER, JSON.stringify(session));
  return new NextRequest(new URL(url), { method: "GET", headers });
}

describe("GET /api/audit/log", () => {
  it("401 when no session", async () => {
    const res = await auditGET(reqWith(null));
    expect(res.status).toBe(401);
  });

  it("403 for rates_officer (no read.audit_log perm)", async () => {
    const res = await auditGET(reqWith(freshSession(["rates_officer"])));
    expect(res.status).toBe(403);
  });

  it("200 + entries for rates_supervisor", async () => {
    await seedAuditEntry("TPS", "user-x");
    const res = await auditGET(reqWith(freshSession(["rates_supervisor"])));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { entries: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.data.entries.length).toBeGreaterThanOrEqual(1);
  });

  it("403 cross-tenant for non-platform-admin", async () => {
    const res = await auditGET(
      reqWith(
        freshSession(["rates_supervisor"], "TPS"),
        "http://localhost/api/audit/log?tenantId=OTHER",
      ),
    );
    expect(res.status).toBe(403);
  });

  it("200 cross-tenant for platform_admin", async () => {
    await seedAuditEntry("OTHER", "user-cross");
    const res = await auditGET(
      reqWith(
        freshSession(["platform_admin"], "TPS"),
        "http://localhost/api/audit/log?tenantId=OTHER",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { entries: { tenantId: string }[] } };
    expect(body.data.entries.length).toBeGreaterThanOrEqual(1);
    expect(body.data.entries[0]!.tenantId).toBe("OTHER");
  });
});
