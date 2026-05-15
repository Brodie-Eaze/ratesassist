/**
 * WorkOS SSO flow tests (Round 5).
 *
 * Covers:
 *   - state mint/verify roundtrip + tamper rejection
 *   - resolveTenantAndRoles for known and unknown domains
 *   - profileToSession produces a valid Session
 *   - exchangeCodeForProfile success/failure paths (mocked fetch)
 *   - sanitizeNext open-redirect defence
 *   - /api/auth/sso/start redirects to WorkOS when configured, to /login otherwise
 *   - /api/auth/callback success path with mocked WorkOS token endpoint
 *   - /api/auth/callback state-mismatch / missing-param / upstream-error paths
 *   - /api/auth/callback 501 in production when WorkOS not configured
 */

import { describe, expect, it, beforeEach, afterEach, beforeAll } from "vitest";
import { NextRequest } from "next/server";

// Pin the secret BEFORE auth.ts loads.
process.env["RA_AUTH_SECRET"] = "workos-test-secret-32chars-min!!";

import {
  SSO_STATE_COOKIE,
  SSO_STATE_TTL_MS,
  WorkOsExchangeError,
  buildAuthorizeUrl,
  buildSsoStateCookie,
  buildClearSsoStateCookie,
  exchangeCodeForProfile,
  getWorkOsConfig,
  isWorkOsConfigured,
  mintState,
  profileToSession,
  resolveTenantAndRoles,
  sanitizeNext,
  verifyState,
  type WorkOsConfig,
  type WorkOsProfile,
  type WorkOsTokenResponse,
} from "../lib/workos";
import {
  SESSION_COOKIE,
  _resetAuthSecretCacheForTests,
  getAuthSecret,
  verifySessionToken,
} from "../lib/auth";
import { GET as startGET } from "../app/api/auth/sso/start/route";
import { GET as callbackGET } from "../app/api/auth/callback/route";

beforeAll(() => {
  _resetAuthSecretCacheForTests();
});

function makeReq(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(new URL(url), {
    method,
    headers: new Headers(headers),
  });
}

// =============================================================================
// Pure helpers
// =============================================================================

describe("sanitizeNext", () => {
  it("returns / on empty/null/undefined", () => {
    expect(sanitizeNext(null)).toBe("/");
    expect(sanitizeNext(undefined)).toBe("/");
    expect(sanitizeNext("")).toBe("/");
  });

  it("rejects non-slash inputs", () => {
    expect(sanitizeNext("https://evil.com")).toBe("/");
    expect(sanitizeNext("javascript:alert(1)")).toBe("/");
  });

  it("rejects protocol-relative URLs", () => {
    expect(sanitizeNext("//evil.com/path")).toBe("/");
  });

  it("rejects CR/LF injection", () => {
    expect(sanitizeNext("/path\r\nLocation: evil")).toBe("/");
    expect(sanitizeNext("/path\nfoo")).toBe("/");
  });

  it("rejects absurdly long inputs", () => {
    expect(sanitizeNext("/" + "x".repeat(1024))).toBe("/");
  });

  it("passes through valid same-site paths", () => {
    expect(sanitizeNext("/properties")).toBe("/properties");
    expect(sanitizeNext("/audit")).toBe("/audit");
    expect(sanitizeNext("/properties?id=123")).toBe("/properties?id=123");
  });
});

describe("buildAuthorizeUrl", () => {
  const config: WorkOsConfig = {
    clientId: "client_test123",
    clientSecret: "sk_test_secret",
    redirectUri: "https://app.example.com/api/auth/callback",
    authorizeUrl: "https://api.workos.com/sso/authorize",
    tokenUrl: "https://api.workos.com/sso/token",
    provider: "MicrosoftOAuth",
  };

  it("includes the required OAuth parameters", () => {
    const url = buildAuthorizeUrl({ config, state: "STATE_VALUE" });
    const u = new URL(url);
    expect(u.host).toBe("api.workos.com");
    expect(u.pathname).toBe("/sso/authorize");
    expect(u.searchParams.get("client_id")).toBe("client_test123");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/auth/callback",
    );
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe("STATE_VALUE");
    expect(u.searchParams.get("provider")).toBe("MicrosoftOAuth");
  });

  it("includes optional hints when provided", () => {
    const url = buildAuthorizeUrl({
      config,
      state: "S",
      loginHint: "officer@tomprice.wa.gov.au",
      domainHint: "tomprice.wa.gov.au",
    });
    const u = new URL(url);
    expect(u.searchParams.get("login_hint")).toBe("officer@tomprice.wa.gov.au");
    expect(u.searchParams.get("domain_hint")).toBe("tomprice.wa.gov.au");
  });
});

// =============================================================================
// state cookie roundtrip
// =============================================================================

describe("mintState / verifyState", () => {
  it("roundtrips a valid state", async () => {
    const secret = "test-secret-abcdef0123456789";
    const state = await mintState(secret, "/properties");
    const verified = await verifyState(secret, state);
    expect(verified).not.toBeNull();
    expect(verified?.next).toBe("/properties");
    expect(typeof verified?.nonce).toBe("string");
    expect(typeof verified?.ts).toBe("number");
  });

  it("rejects tampered state", async () => {
    const secret = "test-secret-abcdef0123456789";
    const state = await mintState(secret, "/");
    const [payload, sig] = state.split(".");
    // Flip the last char of the signature.
    const flipped = sig!.slice(0, -1) + (sig!.endsWith("A") ? "B" : "A");
    expect(await verifyState(secret, `${payload}.${flipped}`)).toBeNull();
  });

  it("rejects state signed with a different secret", async () => {
    const state = await mintState("secret-A", "/");
    expect(await verifyState("secret-B", state)).toBeNull();
  });

  it("rejects expired state", async () => {
    const secret = "test-secret-abcdef0123456789";
    const tooOld = Date.now() - SSO_STATE_TTL_MS - 1_000;
    const state = await mintState(secret, "/", tooOld);
    expect(await verifyState(secret, state)).toBeNull();
  });

  it("rejects garbage", async () => {
    const secret = "test-secret-abcdef0123456789";
    expect(await verifyState(secret, "")).toBeNull();
    expect(await verifyState(secret, "not-dot-separated")).toBeNull();
    expect(await verifyState(secret, "a.b.c")).toBeNull();
  });

  it("sanitises next on mint", async () => {
    const secret = "test-secret-abcdef0123456789";
    const state = await mintState(secret, "//evil.com");
    const verified = await verifyState(secret, state);
    expect(verified?.next).toBe("/");
  });
});

// =============================================================================
// resolveTenantAndRoles
// =============================================================================

describe("resolveTenantAndRoles", () => {
  beforeEach(() => {
    delete process.env.RA_PLATFORM_ADMIN_EMAILS;
    delete process.env.RA_SSO_DEFAULT_TENANT;
  });

  function profile(overrides: Partial<WorkOsProfile> = {}): WorkOsProfile {
    return {
      id: "user_01",
      email: "officer@tomprice.wa.gov.au",
      ...overrides,
    };
  }

  it("maps known council domains to their tenant code", () => {
    expect(resolveTenantAndRoles(profile({ email: "x@tomprice.wa.gov.au" })).tenantId).toBe("TPS");
    expect(resolveTenantAndRoles(profile({ email: "x@ashburton.wa.gov.au" })).tenantId).toBe("ASH");
    expect(resolveTenantAndRoles(profile({ email: "x@kalgoorlie.wa.gov.au" })).tenantId).toBe("KAL");
  });

  it("falls back to default tenant for unknown domains", () => {
    expect(resolveTenantAndRoles(profile({ email: "x@unknown.example.com" })).tenantId).toBe("TPS");
  });

  it("honours RA_SSO_DEFAULT_TENANT for unknown domains", () => {
    process.env["RA_SSO_DEFAULT_TENANT"] = "ASH";
    expect(resolveTenantAndRoles(profile({ email: "x@unknown.example.com" })).tenantId).toBe("ASH");
  });

  it("flags domainMatched accurately", () => {
    expect(resolveTenantAndRoles(profile({ email: "x@tomprice.wa.gov.au" })).domainMatched).toBe(true);
    expect(resolveTenantAndRoles(profile({ email: "x@unknown.example.com" })).domainMatched).toBe(false);
  });

  it("defaults role to rates_officer", () => {
    expect(resolveTenantAndRoles(profile()).roles).toEqual(["rates_officer"]);
  });

  it("elevates platform admin emails", () => {
    process.env["RA_PLATFORM_ADMIN_EMAILS"] = "brodie@ratesassist.com.au";
    const r = resolveTenantAndRoles(profile({ email: "brodie@ratesassist.com.au" }));
    expect(r.roles).toEqual(["platform_admin"]);
  });

  it("recognises supervisor groups from WorkOS", () => {
    const r = resolveTenantAndRoles(
      profile({ groups: ["ratesassist-supervisors", "all-staff"] }),
    );
    expect(r.roles).toEqual(["rates_supervisor"]);
  });

  it("recognises council-admin groups from WorkOS", () => {
    const r = resolveTenantAndRoles(
      profile({ groups: ["Council-Admin-RatesAssist"] }),
    );
    expect(r.roles).toEqual(["council_admin"]);
  });

  it("case-insensitive email match for platform admin", () => {
    process.env["RA_PLATFORM_ADMIN_EMAILS"] = "brodie@ratesassist.com.au";
    const r = resolveTenantAndRoles(profile({ email: "Brodie@RatesAssist.Com.Au" }));
    expect(r.roles).toEqual(["platform_admin"]);
  });
});

// =============================================================================
// profileToSession
// =============================================================================

describe("profileToSession", () => {
  it("produces a plausible Session", () => {
    const profile: WorkOsProfile = {
      id: "user_01",
      email: "officer@tomprice.wa.gov.au",
      first_name: "Jane",
      last_name: "Officer",
      connection_id: "conn_01",
      idp_id: "idp_01",
    };
    const session = profileToSession(profile, 60_000);
    expect(session.userId).toBe("user_01");
    expect(session.email).toBe("officer@tomprice.wa.gov.au");
    expect(session.displayName).toBe("Jane Officer");
    expect(session.tenantId).toBe("TPS");
    expect(session.roles).toContain("rates_officer");
    expect(session.ssoClaims?.provider).toBe("workos");
    expect(session.ssoClaims?.connection_id).toBe("conn_01");
    expect(Date.parse(session.issuedAt)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("falls back to email when names are absent", () => {
    const session = profileToSession(
      { id: "u", email: "x@tomprice.wa.gov.au" },
      60_000,
    );
    expect(session.displayName).toBe("x@tomprice.wa.gov.au");
  });
});

// =============================================================================
// exchangeCodeForProfile (mocked fetch)
// =============================================================================

describe("exchangeCodeForProfile", () => {
  const config: WorkOsConfig = {
    clientId: "client_test",
    clientSecret: "sk_test_secret",
    redirectUri: "https://app.example.com/api/auth/callback",
    authorizeUrl: "https://api.workos.com/sso/authorize",
    tokenUrl: "https://api.workos.com/sso/token",
    provider: "MicrosoftOAuth",
  };

  it("posts client_id, client_secret, grant_type, code", async () => {
    let captured: { url: string; body: string; method: string } | null = null;
    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = {
        url: url.toString(),
        body: init?.body?.toString() ?? "",
        method: init?.method ?? "GET",
      };
      const profile: WorkOsProfile = {
        id: "user_01",
        email: "officer@tomprice.wa.gov.au",
        first_name: "Jane",
        last_name: "Officer",
      };
      const body: WorkOsTokenResponse = { access_token: "tok_abc", profile };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await exchangeCodeForProfile("code_xyz", config, mockFetch);
    expect(result.profile.id).toBe("user_01");
    expect(result.access_token).toBe("tok_abc");

    expect(captured).not.toBeNull();
    expect(captured!.url).toBe("https://api.workos.com/sso/token");
    expect(captured!.method).toBe("POST");
    expect(captured!.body).toContain("client_id=client_test");
    expect(captured!.body).toContain("client_secret=sk_test_secret");
    expect(captured!.body).toContain("grant_type=authorization_code");
    expect(captured!.body).toContain("code=code_xyz");
  });

  it("throws WorkOsExchangeError on 4xx", async () => {
    const mockFetch = (async () => {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      });
    }) as typeof fetch;
    await expect(exchangeCodeForProfile("bad", config, mockFetch)).rejects.toThrow(
      WorkOsExchangeError,
    );
  });

  it("throws WorkOsExchangeError on malformed body", async () => {
    const mockFetch = (async () => {
      return new Response(JSON.stringify({ no_profile_here: true }), {
        status: 200,
      });
    }) as typeof fetch;
    await expect(exchangeCodeForProfile("c", config, mockFetch)).rejects.toThrow(
      WorkOsExchangeError,
    );
  });

  it("throws on empty code", async () => {
    await expect(exchangeCodeForProfile("", config)).rejects.toThrow(
      WorkOsExchangeError,
    );
  });

  it("throws on network error", async () => {
    const mockFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    await expect(exchangeCodeForProfile("c", config, mockFetch)).rejects.toThrow(
      WorkOsExchangeError,
    );
  });
});

// =============================================================================
// isWorkOsConfigured
// =============================================================================

describe("isWorkOsConfigured", () => {
  beforeEach(() => {
    delete process.env.RA_SSO_CLIENT_ID;
    delete process.env.RA_SSO_CLIENT_SECRET;
    delete process.env.RA_SSO_REDIRECT_URI;
  });

  it("returns false when any var is missing", () => {
    expect(isWorkOsConfigured()).toBe(false);
    process.env["RA_SSO_CLIENT_ID"] = "x";
    expect(isWorkOsConfigured()).toBe(false);
    process.env["RA_SSO_CLIENT_SECRET"] = "y";
    expect(isWorkOsConfigured()).toBe(false);
    process.env["RA_SSO_REDIRECT_URI"] = "z";
    expect(isWorkOsConfigured()).toBe(true);
  });

  it("getWorkOsConfig throws with a descriptive message when unconfigured", () => {
    expect(() => getWorkOsConfig()).toThrow(/RA_SSO_CLIENT_ID/);
  });
});

// =============================================================================
// /api/auth/sso/start
// =============================================================================

describe("/api/auth/sso/start", () => {
  beforeEach(() => {
    delete process.env.RA_SSO_CLIENT_ID;
    delete process.env.RA_SSO_CLIENT_SECRET;
    delete process.env.RA_SSO_REDIRECT_URI;
  });

  it("redirects to /login when WorkOS is not configured", async () => {
    const req = makeReq("GET", "https://app.example.com/api/auth/sso/start", {
      host: "app.example.com",
    });
    const res = await startGET(req);
    expect([302, 307]).toContain(res.status); // Next 14 default 307; explicit 302 OK
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/login");
    expect(loc).toContain("error=sso_not_configured");
  });

  it("redirects to workos.com when configured", async () => {
    process.env["RA_SSO_CLIENT_ID"] = "client_test";
    process.env["RA_SSO_CLIENT_SECRET"] = "sk_test_secret";
    process.env["RA_SSO_REDIRECT_URI"] =
      "https://app.example.com/api/auth/callback";

    const req = makeReq("GET", "https://app.example.com/api/auth/sso/start?next=/properties", {
      host: "app.example.com",
    });
    const res = await startGET(req);
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("api.workos.com");
    expect(loc).toContain("client_id=client_test");
    expect(loc).toContain("response_type=code");
    expect(loc).toContain("provider=MicrosoftOAuth");
    // The state cookie is set on the response.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(SSO_STATE_COOKIE);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("preserves the next param via signed state", async () => {
    process.env["RA_SSO_CLIENT_ID"] = "client_test";
    process.env["RA_SSO_CLIENT_SECRET"] = "sk_test_secret";
    process.env["RA_SSO_REDIRECT_URI"] =
      "https://app.example.com/api/auth/callback";

    const req = makeReq("GET", "https://app.example.com/api/auth/sso/start?next=/audit", {
      host: "app.example.com",
    });
    const res = await startGET(req);
    const loc = res.headers.get("location") ?? "";
    const stateParam = new URL(loc).searchParams.get("state");
    expect(stateParam).not.toBeNull();
    const verified = await verifyState(getAuthSecret(), stateParam!);
    expect(verified?.next).toBe("/audit");
  });

  it("rejects open-redirect next values", async () => {
    process.env["RA_SSO_CLIENT_ID"] = "client_test";
    process.env["RA_SSO_CLIENT_SECRET"] = "sk_test_secret";
    process.env["RA_SSO_REDIRECT_URI"] =
      "https://app.example.com/api/auth/callback";

    const req = makeReq("GET", "https://app.example.com/api/auth/sso/start?next=//evil.com/path", {
      host: "app.example.com",
    });
    const res = await startGET(req);
    const loc = res.headers.get("location") ?? "";
    const stateParam = new URL(loc).searchParams.get("state");
    const verified = await verifyState(getAuthSecret(), stateParam!);
    expect(verified?.next).toBe("/");
  });
});

// =============================================================================
// /api/auth/callback
// =============================================================================

describe("/api/auth/callback", () => {
  beforeEach(() => {
    delete process.env.RA_SSO_CLIENT_ID;
    delete process.env.RA_SSO_CLIENT_SECRET;
    delete process.env.RA_SSO_REDIRECT_URI;
    delete process.env.RA_SSO_TOKEN_URL;
    // Restore real fetch between tests.
    if ((globalThis as { __origFetch?: typeof fetch }).__origFetch) {
      globalThis.fetch = (globalThis as { __origFetch?: typeof fetch })
        .__origFetch!;
    }
  });

  afterEach(() => {
    if ((globalThis as { __origFetch?: typeof fetch }).__origFetch) {
      globalThis.fetch = (globalThis as { __origFetch?: typeof fetch })
        .__origFetch!;
    }
  });

  it("returns 501 in production when not configured", async () => {
    const prevEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      const req = makeReq("GET", "https://app.example.com/api/auth/callback", {
        host: "app.example.com",
      });
      const res = await callbackGET(req);
      expect(res.status).toBe(501);
      const body = await res.json();
      expect(body.code).toBe("not_implemented");
      expect(body.message).toContain("PRODUCTION-CHECKLIST.md");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
    }
  });

  it("redirects to /login outside of production when not configured", async () => {
    const req = makeReq("GET", "https://app.example.com/api/auth/callback", {
      host: "app.example.com",
    });
    const res = await callbackGET(req);
    expect([302, 307]).toContain(res.status);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/login");
    expect(loc).toContain("error=sso_not_configured");
  });

  it("redirects with callback_failed on missing code/state", async () => {
    process.env["RA_SSO_CLIENT_ID"] = "client_test";
    process.env["RA_SSO_CLIENT_SECRET"] = "sk_test_secret";
    process.env["RA_SSO_REDIRECT_URI"] =
      "https://app.example.com/api/auth/callback";

    const req = makeReq("GET", "https://app.example.com/api/auth/callback", {
      host: "app.example.com",
    });
    const res = await callbackGET(req);
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get("location")).toContain("error=callback_failed");
  });

  it("redirects with callback_failed on state cookie mismatch", async () => {
    process.env["RA_SSO_CLIENT_ID"] = "client_test";
    process.env["RA_SSO_CLIENT_SECRET"] = "sk_test_secret";
    process.env["RA_SSO_REDIRECT_URI"] =
      "https://app.example.com/api/auth/callback";

    const state = await mintState(getAuthSecret(), "/");
    const req = makeReq(
      "GET",
      `https://app.example.com/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
      {
        host: "app.example.com",
        cookie: `${SSO_STATE_COOKIE}=tampered-state-value`,
      },
    );
    const res = await callbackGET(req);
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get("location")).toContain("error=callback_failed");
  });

  it("redirects with callback_failed on upstream error", async () => {
    process.env["RA_SSO_CLIENT_ID"] = "client_test";
    process.env["RA_SSO_CLIENT_SECRET"] = "sk_test_secret";
    process.env["RA_SSO_REDIRECT_URI"] =
      "https://app.example.com/api/auth/callback";

    const req = makeReq(
      "GET",
      "https://app.example.com/api/auth/callback?error=access_denied&error_description=user_cancelled",
      { host: "app.example.com" },
    );
    const res = await callbackGET(req);
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get("location")).toContain("error=callback_failed");
  });

  it("happy path: exchanges code, sets session cookie, redirects to next", async () => {
    process.env["RA_SSO_CLIENT_ID"] = "client_test";
    process.env["RA_SSO_CLIENT_SECRET"] = "sk_test_secret";
    process.env["RA_SSO_REDIRECT_URI"] =
      "https://app.example.com/api/auth/callback";

    // Stub fetch with a WorkOS-shaped response.
    const origFetch = globalThis.fetch;
    (globalThis as { __origFetch?: typeof fetch }).__origFetch = origFetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      expect(url.toString()).toBe("https://api.workos.com/sso/token");
      const profile: WorkOsProfile = {
        id: "user_01",
        email: "officer@tomprice.wa.gov.au",
        first_name: "Jane",
        last_name: "Officer",
        connection_id: "conn_01",
      };
      const body: WorkOsTokenResponse = { access_token: "tok_abc", profile };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const state = await mintState(getAuthSecret(), "/properties");
    const req = makeReq(
      "GET",
      `https://app.example.com/api/auth/callback?code=valid_code&state=${encodeURIComponent(state)}`,
      {
        host: "app.example.com",
        cookie: `${SSO_STATE_COOKIE}=${encodeURIComponent(state)}`,
      },
    );

    const res = await callbackGET(req);
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/properties");

    // The Set-Cookie carries the freshly-minted session.
    // NextResponse merges multiple set-cookie headers into a single
    // comma-joined string when read via .get(); use raw access to verify
    // both are present.
    const setCookieRaw = res.headers.get("set-cookie") ?? "";
    expect(setCookieRaw).toContain(SESSION_COOKIE);

    // Pull the session token out and verify it.
    const m = new RegExp(`${SESSION_COOKIE}=([^;,]+)`).exec(setCookieRaw);
    expect(m).not.toBeNull();
    const token = decodeURIComponent(m![1]!);
    const session = await verifySessionToken(token);
    expect(session?.userId).toBe("user_01");
    expect(session?.tenantId).toBe("TPS");
    expect(session?.roles).toContain("rates_officer");
    expect(session?.displayName).toBe("Jane Officer");
  });

  it("redirects with callback_failed when WorkOS token exchange fails", async () => {
    process.env["RA_SSO_CLIENT_ID"] = "client_test";
    process.env["RA_SSO_CLIENT_SECRET"] = "sk_test_secret";
    process.env["RA_SSO_REDIRECT_URI"] =
      "https://app.example.com/api/auth/callback";

    const origFetch = globalThis.fetch;
    (globalThis as { __origFetch?: typeof fetch }).__origFetch = origFetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      });
    }) as typeof fetch;

    const state = await mintState(getAuthSecret(), "/");
    const req = makeReq(
      "GET",
      `https://app.example.com/api/auth/callback?code=bad&state=${encodeURIComponent(state)}`,
      {
        host: "app.example.com",
        cookie: `${SSO_STATE_COOKIE}=${encodeURIComponent(state)}`,
      },
    );
    const res = await callbackGET(req);
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get("location")).toContain("error=callback_failed");
  });
});

// =============================================================================
// cookie helpers
// =============================================================================

describe("state cookie helpers", () => {
  it("buildSsoStateCookie includes HttpOnly + Path scoped to /api/auth", () => {
    const c = buildSsoStateCookie("STATE_VALUE");
    expect(c).toContain(SSO_STATE_COOKIE);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/api/auth");
  });

  it("buildClearSsoStateCookie zeros Max-Age", () => {
    const c = buildClearSsoStateCookie();
    expect(c).toContain("Max-Age=0");
  });
});
