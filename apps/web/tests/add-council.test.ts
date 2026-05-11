/**
 * POST /api/tenants — add_council two-phase flow.
 *
 * Mirrors audit-route's test harness: forces in-proc tool transport so the
 * route and the test share one DataStore + audit buffer realm. Sessions are
 * stubbed directly via the `x-session` header.
 */

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
process.env["RA_TOOL_TRANSPORT"] = "inproc";

import type { Role, Session } from "@ratesassist/contract";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../lib/auth";

vi.resetModules();
const { POST: tenantsPOST } = await import("../app/api/tenants/route");

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

function req(body: unknown, s: Session | null): NextRequest {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (s) headers.set(SESSION_HEADER, JSON.stringify(s));
  return new NextRequest(new URL("http://localhost/api/tenants"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const VALID = {
  code: "ZZZ",
  name: "Shire of Test",
  state: "WA" as const,
  centerLat: -31.5,
  centerLng: 117.0,
  population: 1000,
  rateableProperties: 500,
  rateRevenue: 1_000_000,
};

describe("POST /api/tenants (add_council)", () => {
  it("401 when no session", async () => {
    const res = await tenantsPOST(req({ ...VALID, confirm: false }, null));
    expect(res.status).toBe(401);
  });

  it("403 for rates_officer", async () => {
    const res = await tenantsPOST(
      req({ ...VALID, confirm: false }, session(["rates_officer"])),
    );
    expect(res.status).toBe(403);
  });

  it("happy path two-phase for council_admin", async () => {
    const s = session(["council_admin"]);
    const previewRes = await tenantsPOST(req({ ...VALID, confirm: false }, s));
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as {
      ok: boolean;
      commitToken?: string;
      mutated?: boolean;
    };
    expect(preview.ok).toBe(true);
    expect(typeof preview.commitToken).toBe("string");
    expect(preview.mutated).toBe(false);

    const commitRes = await tenantsPOST(
      req(
        {
          ...VALID,
          confirm: true,
          commitToken: preview.commitToken!,
        },
        s,
      ),
    );
    expect(commitRes.status).toBe(200);
    const commit = (await commitRes.json()) as {
      ok: boolean;
      mutated?: boolean;
    };
    expect(commit.ok).toBe(true);
    expect(commit.mutated).toBe(true);
  });

  it("rejects duplicate code with 409", async () => {
    const s = session(["platform_admin"]);
    const res = await tenantsPOST(
      req({ ...VALID, code: "TPS", confirm: false }, s),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("conflict");
  });

  it("400 on malformed body", async () => {
    const s = session(["council_admin"]);
    const res = await tenantsPOST(
      req({ ...VALID, code: "lower", confirm: false }, s),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_input");
  });
});
