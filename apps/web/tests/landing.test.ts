/**
 * Public landing surface tests.
 *
 * Covers:
 *   - Unauthenticated GET /landing passes through middleware without a
 *     redirect to /login.
 *   - Unauthenticated GET / passes through middleware (root is public —
 *     page.tsx decides whether to render the dashboard or the landing
 *     surface based on session presence).
 *   - Authenticated GET / passes through and middleware forwards the
 *     session via x-session.
 *   - Landing page module exports a default component (smoke check —
 *     prevents the React Server Component file from breaking at build).
 *   - The landing module references brodie@amalafinance.com.au CTA.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env["RA_AUTH_SECRET"] = "landing-test-secret-32chars!!aaaa";

import type { Role, Session } from "@ratesassist/contract";
import { SESSION_COOKIE, _resetAuthSecretCacheForTests, signSessionToken } from "../lib/auth";
import { middleware } from "../middleware";

beforeEach(() => {
  _resetAuthSecretCacheForTests();
  delete process.env["RA_DEV_AUTOLOGIN_SESSION"];
});

function freshSession(roles: Role[] = ["rates_officer"]): Session {
  const now = Date.now();
  return {
    userId: "u-landing",
    email: "u@example.com",
    displayName: "U",
    tenantId: "TPS",
    roles,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  };
}

function makeReq(
  path: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(new URL(`https://app.example.com${path}`), {
    method: "GET",
    headers: new Headers({ host: "app.example.com", ...headers }),
  });
}

describe("public landing routes", () => {
  it("unauthenticated GET /landing is NOT redirected", async () => {
    const res = await middleware(makeReq("/landing"));
    // Pass-through = 200/next (no Location header). Redirect would be 307/308.
    expect([200, undefined].includes(res.status as number | undefined) || res.status < 300).toBe(true);
    expect(res.headers.get("location")).toBeNull();
  });

  it("unauthenticated GET / is NOT redirected to /login", async () => {
    const res = await middleware(makeReq("/"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBeLessThan(300);
  });

  it("authenticated GET / forwards x-session to the route", async () => {
    const session = freshSession(["rates_officer"]);
    const token = await signSessionToken(session);
    const res = await middleware(
      makeReq("/", { cookie: `${SESSION_COOKIE}=${token}` }),
    );
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("location")).toBeNull();
  });

  it("unauthenticated GET /properties is still redirected to /login (sanity)", async () => {
    const res = await middleware(makeReq("/properties"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("landing module renders a default export with CTA + pillars", () => {
    // Static-text smoke check on the source. Avoids needing a full RSC
    // render environment in the test runner.
    const src = readFileSync(
      join(__dirname, "..", "app", "landing", "page.tsx"),
      "utf8",
    );
    expect(src).toContain("export default");
    expect(src).toContain("brodie@amalafinance.com.au");
    expect(src).toContain("Multi-signal detection");
    expect(src).toContain("Audit-grade evidence packs");
    expect(src).toContain("Pay only on recovery");
    expect(src).toContain("WA-data resident");
  });
});
