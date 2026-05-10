/**
 * Auth & RBAC tests (Round 4).
 *
 * Covers:
 *   - signSessionToken / verifySessionToken roundtrip + tamper rejection
 *   - getSession returns null for missing/invalid/expired
 *   - hasPermission across role × permission grid
 *   - assertTenant cross-tenant blocking, platform_admin bypass
 *   - middleware: PUBLIC_PATHS bypass, /api/* unauth → 401, redirect for HTML
 *   - /api/auth/login (dev) issues a working cookie
 *   - /api/me reads injected x-session header
 */

import { describe, expect, it, beforeEach, beforeAll } from "vitest";
import { NextRequest } from "next/server";

// Force a deterministic secret BEFORE the auth module loads.
process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";

import {
  RBAC,
  type Permission,
  type Role,
  type Session,
  ALL_ROLES,
} from "@ratesassist/contract";
import {
  SESSION_COOKIE,
  SESSION_HEADER,
  assertTenant,
  buildSessionCookie,
  effectivePermissions,
  getSession,
  getSessionFromRequest,
  hasPermission,
  signSessionToken,
  verifySessionToken,
  _resetAuthSecretCacheForTests,
} from "../lib/auth";
import { issueStubSession, parseDevAutologin } from "../lib/auth-stub";
import { middleware } from "../middleware";
import { POST as loginPOST } from "../app/api/auth/login/route";
import { POST as logoutPOST } from "../app/api/auth/logout/route";
import { GET as meGET } from "../app/api/me/route";

beforeAll(() => {
  _resetAuthSecretCacheForTests();
});

function makeReq(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
): NextRequest {
  // NextRequest's init type is slightly stricter than the global RequestInit.
  // Build via a plain object literal to keep TS happy in both runtimes.
  const init = {
    method,
    headers: new Headers(headers),
    ...(body !== undefined
      ? { body: typeof body === "string" ? body : JSON.stringify(body) }
      : {}),
  };
  return new NextRequest(new URL(url), init);
}

function freshSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    userId: "u1",
    email: "u1@example.com",
    displayName: "User One",
    tenantId: "TPS",
    roles: ["rates_officer"],
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    ...overrides,
  };
}

// ---------- token roundtrip ------------------------------------------------

describe("signSessionToken / verifySessionToken", () => {
  it("roundtrips a valid session", async () => {
    const s = freshSession();
    const token = await signSessionToken(s);
    const back = await verifySessionToken(token);
    expect(back).not.toBeNull();
    expect(back?.userId).toBe(s.userId);
    expect(back?.tenantId).toBe(s.tenantId);
    expect(back?.roles).toEqual(s.roles);
  });

  it("rejects a tampered payload", async () => {
    const s = freshSession();
    const token = await signSessionToken(s);
    const [h, p, sig] = token.split(".");
    // Flip a byte in the payload section.
    const tampered = `${h}.${p?.slice(0, -1)}A.${sig}`;
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it("rejects garbage / wrong-shape tokens", async () => {
    expect(await verifySessionToken("nope")).toBeNull();
    expect(await verifySessionToken("a.b.c")).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const past = freshSession({
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const token = await signSessionToken(past);
    expect(await verifySessionToken(token)).toBeNull();
  });
});

// ---------- getSession -----------------------------------------------------

describe("getSession", () => {
  it("returns null when no cookie / header present", async () => {
    const req = makeReq("GET", "https://app.example.com/api/data", {
      host: "app.example.com",
    });
    expect(await getSession(req)).toBeNull();
  });

  it("reads valid cookie", async () => {
    const { token } = await issueStubSession({ tenantId: "TPS", roles: ["rates_officer"] });
    const req = makeReq("GET", "https://app.example.com/api/data", {
      host: "app.example.com",
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    });
    const s = await getSession(req);
    expect(s?.tenantId).toBe("TPS");
  });

  it("reads Authorization Bearer", async () => {
    const { token } = await issueStubSession({});
    const req = makeReq("GET", "https://app.example.com/api/data", {
      host: "app.example.com",
      authorization: `Bearer ${token}`,
    });
    const s = await getSession(req);
    expect(s).not.toBeNull();
  });

  it("returns null on invalid cookie", async () => {
    const req = makeReq("GET", "https://app.example.com/api/data", {
      host: "app.example.com",
      cookie: `${SESSION_COOKIE}=garbage`,
    });
    expect(await getSession(req)).toBeNull();
  });
});

// ---------- RBAC -----------------------------------------------------------

describe("hasPermission across the role × permission grid", () => {
  const allPerms: Permission[] = [
    "read.public",
    "read.tenant_data",
    "read.audit_log",
    "write.draft_mutation",
    "write.commit_mutation",
    "write.user_management",
    "write.platform_admin",
  ];

  for (const role of ALL_ROLES) {
    for (const perm of allPerms) {
      const expected = RBAC[role].includes(perm);
      it(`${role} ${expected ? "has" : "lacks"} ${perm}`, () => {
        const s = freshSession({ roles: [role] });
        expect(hasPermission(s, perm)).toBe(expected);
      });
    }
  }

  it("ratepayer cannot draft mutations", () => {
    expect(hasPermission(freshSession({ roles: ["ratepayer"] }), "write.draft_mutation")).toBe(false);
  });

  it("platform_admin can do everything", () => {
    const s = freshSession({ roles: ["platform_admin"] });
    for (const p of allPerms) expect(hasPermission(s, p)).toBe(true);
  });
});

describe("assertTenant", () => {
  it("allows same-tenant access", () => {
    const s = freshSession({ tenantId: "TPS" });
    expect(() => assertTenant(s, "TPS")).not.toThrow();
  });

  it("blocks cross-tenant for non-admin", () => {
    const s = freshSession({ tenantId: "TPS", roles: ["rates_officer"] });
    expect(() => assertTenant(s, "AC")).toThrow();
  });

  it("allows cross-tenant for platform_admin", () => {
    const s = freshSession({ tenantId: "TPS", roles: ["platform_admin"] });
    expect(() => assertTenant(s, "AC")).not.toThrow();
  });
});

describe("effectivePermissions", () => {
  it("unions across multiple roles, dedupes", () => {
    const s = freshSession({ roles: ["rates_officer", "rates_supervisor"] });
    const perms = effectivePermissions(s);
    expect(perms).toContain("write.commit_mutation");
    expect(perms).toContain("read.tenant_data");
    expect(new Set(perms).size).toBe(perms.length);
  });
});

// ---------- middleware -----------------------------------------------------

describe("middleware auth gate", () => {
  beforeEach(() => {
    delete process.env.RA_CSRF_EXEMPT_PATHS;
    delete process.env.RA_DEV_AUTOLOGIN_SESSION;
  });

  it("PUBLIC: /api/health bypasses auth", async () => {
    const req = makeReq("GET", "https://app.example.com/api/health", {
      host: "app.example.com",
    });
    const res = await middleware(req);
    // Pass-through emits 200/next; our middleware returns NextResponse.next
    // which has status 200.
    expect(res.status).toBe(200);
  });

  it("PUBLIC: /api/auth/login bypasses auth", async () => {
    const req = makeReq("POST", "https://app.example.com/api/auth/login", {
      host: "app.example.com",
      origin: "https://app.example.com",
      "content-type": "application/json",
    }, { tenantId: "TPS", role: "rates_officer" });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("blocks unauth GET to /api/data with 401", async () => {
    const req = makeReq("GET", "https://app.example.com/api/data", {
      host: "app.example.com",
    });
    const res = await middleware(req);
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ ok: false, code: "unauthorized" });
  });

  it("blocks unauth POST to /api/data with 401 (origin already matched)", async () => {
    const req = makeReq("POST", "https://app.example.com/api/data", {
      host: "app.example.com",
      origin: "https://app.example.com",
    });
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it("allows authed GET to /api/data", async () => {
    const { token } = await issueStubSession({});
    const req = makeReq("GET", "https://app.example.com/api/data", {
      host: "app.example.com",
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("redirects unauth HTML route to /login", async () => {
    const req = makeReq("GET", "https://app.example.com/properties", {
      host: "app.example.com",
    });
    const res = await middleware(req);
    expect(res.status).toBe(307); // NextResponse.redirect default
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).toContain("next=%2Fproperties");
  });

  it("/login itself is public", async () => {
    const req = makeReq("GET", "https://app.example.com/login", {
      host: "app.example.com",
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("autologin env mints a session in dev", async () => {
    process.env["RA_DEV_AUTOLOGIN_SESSION"] = "default";
    try {
      const req = makeReq("GET", "https://app.example.com/api/data", {
        host: "app.example.com",
      });
      const res = await middleware(req);
      expect(res.status).toBe(200);
      // set-cookie should carry the freshly-minted session
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain(SESSION_COOKIE);
    } finally {
      delete process.env.RA_DEV_AUTOLOGIN_SESSION;
    }
  });
});

// ---------- /api/me --------------------------------------------------------

describe("/api/me", () => {
  it("returns 401 when middleware did not inject x-session", () => {
    const req = makeReq("GET", "https://app.example.com/api/me", {
      host: "app.example.com",
    });
    const res = meGET(req);
    expect(res.status).toBe(401);
  });

  it("returns the session injected by middleware", async () => {
    const session = freshSession();
    const req = makeReq("GET", "https://app.example.com/api/me", {
      host: "app.example.com",
      [SESSION_HEADER]: JSON.stringify(session),
    });
    const res = meGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.session.userId).toBe(session.userId);
    expect(Array.isArray(body.permissions)).toBe(true);
  });
});

// ---------- /api/auth/login (dev) -----------------------------------------

describe("/api/auth/login (dev)", () => {
  it("rejects bad body", async () => {
    const req = makeReq("POST", "https://app.example.com/api/auth/login", {
      host: "app.example.com",
      origin: "https://app.example.com",
      "content-type": "application/json",
    }, { role: "rates_officer" }); // missing tenantId
    const res = await loginPOST(req);
    expect(res.status).toBe(400);
  });

  it("rejects unknown role", async () => {
    const req = makeReq("POST", "https://app.example.com/api/auth/login", {
      host: "app.example.com",
      origin: "https://app.example.com",
      "content-type": "application/json",
    }, { tenantId: "TPS", role: "wizard" });
    const res = await loginPOST(req);
    expect(res.status).toBe(400);
  });

  it("issues a verifiable session cookie on success", async () => {
    const req = makeReq("POST", "https://app.example.com/api/auth/login", {
      host: "app.example.com",
      origin: "https://app.example.com",
      "content-type": "application/json",
    }, { tenantId: "TPS", role: "rates_officer" });
    const res = await loginPOST(req);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    // Pull the token back out and verify it.
    const m = /ra_session=([^;]+)/.exec(setCookie);
    expect(m).toBeTruthy();
    const token = decodeURIComponent(m![1]!);
    const verified = await verifySessionToken(token);
    expect(verified?.tenantId).toBe("TPS");
    expect(verified?.roles).toContain("rates_officer");
  });
});

describe("/api/auth/logout", () => {
  it("clears the cookie", () => {
    const res = logoutPOST();
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
  });
});

// ---------- parseDevAutologin ---------------------------------------------

describe("parseDevAutologin", () => {
  beforeEach(() => {
    delete process.env.RA_DEV_AUTOLOGIN_SESSION;
  });

  it("returns null when unset", () => {
    expect(parseDevAutologin()).toBeNull();
  });

  it('treats "default" as the demo principal', () => {
    process.env["RA_DEV_AUTOLOGIN_SESSION"] = "default";
    expect(parseDevAutologin()).toEqual({});
  });

  it("parses JSON config", () => {
    process.env["RA_DEV_AUTOLOGIN_SESSION"] = JSON.stringify({
      tenantId: "AC",
      roles: ["rates_supervisor"],
    });
    const r = parseDevAutologin();
    expect(r?.tenantId).toBe("AC");
    expect(r?.roles).toEqual(["rates_supervisor"]);
  });

  it("rejects unknown roles", () => {
    process.env["RA_DEV_AUTOLOGIN_SESSION"] = JSON.stringify({
      roles: ["wizard"],
    });
    expect(parseDevAutologin()).toBeNull();
  });
});

// ---------- buildSessionCookie --------------------------------------------

describe("buildSessionCookie", () => {
  it("includes HttpOnly + SameSite=Lax", () => {
    const c = buildSessionCookie("token");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
  });
});

// ---------- getSessionFromRequest -----------------------------------------

describe("getSessionFromRequest", () => {
  it("reads a session injected by middleware", () => {
    const s = freshSession();
    const req = makeReq("GET", "https://app.example.com/api/me", {
      [SESSION_HEADER]: JSON.stringify(s),
    });
    expect(getSessionFromRequest(req)?.userId).toBe(s.userId);
  });

  it("returns null on absent header", () => {
    const req = makeReq("GET", "https://app.example.com/api/me");
    expect(getSessionFromRequest(req)).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    const req = makeReq("GET", "https://app.example.com/api/me", {
      [SESSION_HEADER]: "{not json",
    });
    expect(getSessionFromRequest(req)).toBeNull();
  });
});
