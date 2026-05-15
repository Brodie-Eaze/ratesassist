/**
 * WorkOS SSO helper.
 *
 * Round 5 — replaces the Phase 4 placeholder in /api/auth/callback. WorkOS
 * SSO lets a council user sign in with their existing Microsoft Entra ID
 * (or Google Workspace, Okta, etc.) account. WorkOS is free for the first
 * 1M monthly users; we pay nothing until we cross that threshold.
 *
 * Architecture
 * ------------
 * 1. /api/auth/sso/start                    →  302 to WorkOS authorize URL
 *                                              with HMAC-signed `state`.
 * 2. WorkOS authenticates the user with the council's IdP, redirects to
 *    /api/auth/callback?code=...&state=...
 * 3. /api/auth/callback                     →  POST /sso/token, build our
 *                                              Session, sign it via HMAC,
 *                                              set cookie, 302 to `next`.
 *
 * Our existing `Session` shape (see @ratesassist/contract) already supports
 * any principal/tenant/role tuple, so the only new work is the OAuth dance.
 *
 * Endpoints (verified against WorkOS docs / workos-node SDK):
 *   GET  https://api.workos.com/sso/authorize
 *   POST https://api.workos.com/sso/token
 *
 * Env contract
 * ------------
 * RA_SSO_CLIENT_ID       — WorkOS client id (client_xxx)
 * RA_SSO_CLIENT_SECRET   — WorkOS API key (sk_xxx)
 * RA_SSO_REDIRECT_URI    — fully-qualified callback URL, e.g.
 *                          https://app.ratesassist.com.au/api/auth/callback
 * RA_SSO_AUTHORIZE_URL   — override base (rarely needed, eg. WorkOS staging)
 * RA_SSO_TOKEN_URL       — override base
 * RA_SSO_PROVIDER        — "MicrosoftOAuth" | "GoogleOAuth" | "OktaSAML" | ...
 *                          Defaults to MicrosoftOAuth (council Entra).
 *
 * In production, this module throws at first use if any required var is
 * missing — we refuse to mint redirects pointing at "undefined". In dev,
 * `isWorkOsConfigured()` returns false and callers fall back to the dev
 * autologin / stub-login flow.
 */

import {
  type Role,
  type Session,
} from "@ratesassist/contract";

// ===== Endpoint constants ===================================================

const DEFAULT_AUTHORIZE_URL = "https://api.workos.com/sso/authorize";
const DEFAULT_TOKEN_URL = "https://api.workos.com/sso/token";

/** 5 minutes — the OAuth `state` round-trip should never take longer. */
export const SSO_STATE_TTL_MS = 5 * 60 * 1000;

/** Short-lived cookie that carries the signed `state` value. */
export const SSO_STATE_COOKIE = "ra_sso_state";

// ===== Config resolution ====================================================

export type WorkOsConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly provider: string;
};

/**
 * True when the four required env vars are present. Callers use this to
 * choose between the real OAuth flow and the dev fallback without throwing.
 */
export function isWorkOsConfigured(): boolean {
  const id = process.env["RA_SSO_CLIENT_ID"];
  const secret = process.env["RA_SSO_CLIENT_SECRET"];
  const redirect = process.env["RA_SSO_REDIRECT_URI"];
  return !!(id && secret && redirect);
}

/**
 * Resolve config or throw a descriptive error. Throws in production when
 * any required var is missing — we want the route to fail loudly rather
 * than silently degrade to a broken flow.
 */
export function getWorkOsConfig(): WorkOsConfig {
  const clientId = process.env["RA_SSO_CLIENT_ID"];
  const clientSecret = process.env["RA_SSO_CLIENT_SECRET"];
  const redirectUri = process.env["RA_SSO_REDIRECT_URI"];
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "WorkOS SSO is not configured. Set RA_SSO_CLIENT_ID, " +
        "RA_SSO_CLIENT_SECRET, and RA_SSO_REDIRECT_URI in the environment. " +
        "See internal/PRODUCTION-CHECKLIST.md.",
    );
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    authorizeUrl: process.env["RA_SSO_AUTHORIZE_URL"] ?? DEFAULT_AUTHORIZE_URL,
    tokenUrl: process.env["RA_SSO_TOKEN_URL"] ?? DEFAULT_TOKEN_URL,
    provider: process.env["RA_SSO_PROVIDER"] ?? "MicrosoftOAuth",
  };
}

// ===== Authorize URL ========================================================

/**
 * Build the URL we redirect users to. WorkOS handles the IdP handshake and
 * bounces back to our redirect_uri with `code` + `state`.
 */
export function buildAuthorizeUrl(params: {
  config: WorkOsConfig;
  state: string;
  loginHint?: string;
  domainHint?: string;
}): string {
  const u = new URL(params.config.authorizeUrl);
  u.searchParams.set("client_id", params.config.clientId);
  u.searchParams.set("redirect_uri", params.config.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", params.state);
  u.searchParams.set("provider", params.config.provider);
  if (params.loginHint) u.searchParams.set("login_hint", params.loginHint);
  if (params.domainHint) u.searchParams.set("domain_hint", params.domainHint);
  return u.toString();
}

// ===== Token exchange ======================================================

/**
 * Raw shape returned by WorkOS POST /sso/token. We pull `profile` out and
 * map it to our internal Session shape; `access_token` is logged at debug
 * level only — RatesAssist never calls back into WorkOS after sign-in.
 */
export type WorkOsTokenResponse = {
  readonly access_token: string;
  readonly profile: WorkOsProfile;
};

export type WorkOsProfile = {
  readonly id: string;
  readonly email: string;
  readonly first_name?: string | null;
  readonly last_name?: string | null;
  readonly organization_id?: string | null;
  readonly connection_id?: string | null;
  readonly connection_type?: string | null;
  readonly idp_id?: string | null;
  readonly groups?: ReadonlyArray<string> | null;
  readonly raw_attributes?: Readonly<Record<string, unknown>> | null;
};

/**
 * Exchange an authorization code for a profile + access token.
 *
 * Errors are surfaced as a single `WorkOsExchangeError` so route handlers
 * can map them to a "?error=callback_failed" redirect without leaking
 * upstream message bodies to end users.
 */
export class WorkOsExchangeError extends Error {
  public readonly status: number;
  public readonly upstreamBody: string;
  constructor(message: string, status: number, upstreamBody: string) {
    super(message);
    this.name = "WorkOsExchangeError";
    this.status = status;
    this.upstreamBody = upstreamBody;
  }
}

export async function exchangeCodeForProfile(
  code: string,
  config: WorkOsConfig = getWorkOsConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<WorkOsTokenResponse> {
  if (!code || code.length > 4096) {
    throw new WorkOsExchangeError("invalid code parameter", 400, "");
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
  });

  let res: Response;
  try {
    res = await fetchImpl(config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new WorkOsExchangeError(
      `network error: ${(err as Error).message}`,
      0,
      "",
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw new WorkOsExchangeError(
      `WorkOS token endpoint returned ${res.status}`,
      res.status,
      text.slice(0, 512),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WorkOsExchangeError(
      "WorkOS token endpoint returned non-JSON body",
      res.status,
      text.slice(0, 512),
    );
  }

  if (!isWorkOsTokenResponse(parsed)) {
    throw new WorkOsExchangeError(
      "WorkOS token endpoint returned malformed body",
      res.status,
      text.slice(0, 512),
    );
  }

  return parsed;
}

function isWorkOsTokenResponse(v: unknown): v is WorkOsTokenResponse {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o["access_token"] !== "string") return false;
  const p = o["profile"];
  if (!p || typeof p !== "object") return false;
  const pp = p as Record<string, unknown>;
  return typeof pp["id"] === "string" && typeof pp["email"] === "string";
}

// ===== Profile → Session mapping ============================================

/**
 * Council domain → tenant code. Each council deployment adds its domain
 * here once WorkOS is configured for that council. Unknown domains fall
 * through to the default tenant (configurable via RA_SSO_DEFAULT_TENANT,
 * useful for demo deployments where every signed-in user lands in TPS).
 *
 * Keep this list in sync with packages/adapter-demo seed data.
 */
const DOMAIN_TO_TENANT: Readonly<Record<string, string>> = {
  "tomprice.wa.gov.au": "TPS",
  "ashburton.wa.gov.au": "ASH",
  "eastpilbara.wa.gov.au": "ESH",
  "kalgoorlie.wa.gov.au": "KAL",
  "meekatharra.wa.gov.au": "MEK",
  "sandstone.wa.gov.au": "SST",
  "brokenhill.nsw.gov.au": "BRK",
  "mountisa.qld.gov.au": "MTI",
  // Internal RatesAssist domain — platform admins.
  "ratesassist.com.au": "TPS",
};

/** Default tenant for users whose email domain isn't mapped. */
function defaultTenant(): string {
  return process.env["RA_SSO_DEFAULT_TENANT"] ?? "TPS";
}

/**
 * Parse a comma-separated list of @ratesassist.com.au emails that should
 * receive the platform_admin role. e.g.
 *   RA_PLATFORM_ADMIN_EMAILS=brodie@ratesassist.com.au,ops@ratesassist.com.au
 */
function platformAdminEmails(): ReadonlyArray<string> {
  const raw = process.env["RA_PLATFORM_ADMIN_EMAILS"] ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export type TenantResolution = {
  readonly tenantId: string;
  readonly roles: ReadonlyArray<Role>;
  readonly domainMatched: boolean;
};

/**
 * Resolve tenant + roles from a WorkOS profile. Pure function — no IO —
 * so it's trivially unit-testable.
 *
 *   1. Domain → tenant via DOMAIN_TO_TENANT.
 *   2. If unknown, fall back to defaultTenant() (env override).
 *   3. Default role is `rates_officer`. Platform-admin emails get elevated.
 *   4. WorkOS groups override role if present and recognised. e.g. the
 *      Entra group `ratesassist-supervisors` → `rates_supervisor`.
 */
export function resolveTenantAndRoles(
  profile: WorkOsProfile,
): TenantResolution {
  const email = profile.email.toLowerCase();
  const at = email.lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1) : "";
  const mapped = DOMAIN_TO_TENANT[domain];
  const tenantId = mapped ?? defaultTenant();
  const domainMatched = mapped !== undefined;

  const adminEmails = platformAdminEmails();
  if (adminEmails.includes(email)) {
    return { tenantId, roles: ["platform_admin"], domainMatched };
  }

  // Honour WorkOS group claims if the IdP sends them.
  if (profile.groups && profile.groups.length > 0) {
    const groups = profile.groups.map((g) => g.toLowerCase());
    if (groups.some((g) => g.includes("council-admin") || g.includes("council_admin"))) {
      return { tenantId, roles: ["council_admin"], domainMatched };
    }
    if (groups.some((g) => g.includes("supervisor"))) {
      return { tenantId, roles: ["rates_supervisor"], domainMatched };
    }
  }

  return { tenantId, roles: ["rates_officer"], domainMatched };
}

/**
 * Build a Session from a WorkOS profile. Pure function. The caller signs
 * the result via auth.ts::signSessionToken and sets the cookie.
 */
export function profileToSession(
  profile: WorkOsProfile,
  ttlMs: number,
): Session {
  const now = Date.now();
  const { tenantId, roles } = resolveTenantAndRoles(profile);
  const displayName =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() ||
    profile.email;

  return {
    userId: profile.id,
    email: profile.email,
    displayName,
    tenantId,
    roles,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    ssoClaims: {
      provider: "workos",
      connection_id: profile.connection_id ?? null,
      connection_type: profile.connection_type ?? null,
      idp_id: profile.idp_id ?? null,
      organization_id: profile.organization_id ?? null,
    },
  };
}

// ===== state cookie =========================================================

/**
 * `state` is an HMAC-signed string carrying:
 *   - a random nonce (replay defence)
 *   - the issuance timestamp (TTL check on callback)
 *   - the `next` URL the caller wanted to land on
 *
 * Wire format: base64url(payload).base64url(sig)
 * Where payload = JSON.stringify({ nonce, ts, next }).
 *
 * Same HMAC key as session cookies (RA_AUTH_SECRET) — we don't need a
 * second secret for a 5-minute round-trip token.
 */
export type SsoStatePayload = {
  readonly nonce: string;
  readonly ts: number;
  readonly next: string;
};

function b64urlEncode(s: string): string {
  // btoa is available in both Edge and Node 20+.
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return atob(padded);
}

async function hmac(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(data) as unknown as BufferSource),
  );
  let bin = "";
  for (let i = 0; i < sig.length; i++) bin += String.fromCharCode(sig[i]!);
  return b64urlEncode(bin);
}

/** Mint a signed `state` value. The caller persists this via a short-lived cookie. */
export async function mintState(
  secret: string,
  next: string,
  now: number = Date.now(),
): Promise<string> {
  // 16 random bytes → 22 base64url chars.
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  let nonceBin = "";
  for (let i = 0; i < nonceBytes.length; i++) nonceBin += String.fromCharCode(nonceBytes[i]!);
  const nonce = b64urlEncode(nonceBin);

  const safeNext = sanitizeNext(next);
  const payload: SsoStatePayload = { nonce, ts: now, next: safeNext };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(payloadStr);
  const sig = await hmac(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a state value. Returns the decoded payload if signature matches
 * and TTL has not expired; null otherwise. Never throws.
 */
export async function verifyState(
  secret: string,
  state: string,
  now: number = Date.now(),
): Promise<SsoStatePayload | null> {
  if (!state || state.length > 4096) return null;
  const dot = state.indexOf(".");
  if (dot < 0) return null;
  const payloadB64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);

  let expectedSig: string;
  try {
    expectedSig = await hmac(secret, payloadB64);
  } catch {
    return null;
  }
  if (!constantTimeEq(sig, expectedSig)) return null;

  let payload: SsoStatePayload;
  try {
    const parsed = JSON.parse(b64urlDecode(payloadB64)) as SsoStatePayload;
    if (
      typeof parsed.nonce !== "string" ||
      typeof parsed.ts !== "number" ||
      typeof parsed.next !== "string"
    ) {
      return null;
    }
    payload = parsed;
  } catch {
    return null;
  }

  if (now - payload.ts > SSO_STATE_TTL_MS) return null;
  if (now - payload.ts < -60_000) return null; // future-dated => clock skew abuse

  return payload;
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Refuse open redirects. We only allow `next` to be a same-site path
 * starting with `/` and not `//` (which browsers treat as protocol-relative
 * and would redirect off-site).
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.length > 512) return "/";
  // Strip any embedded CR/LF — header-injection defence.
  if (/[\r\n]/.test(next)) return "/";
  return next;
}

// ===== state cookie helpers ================================================

/**
 * Build a Set-Cookie value for the state cookie. Short-lived (5 minutes),
 * HttpOnly, SameSite=Lax — Lax (not Strict) so the cookie survives the
 * top-level cross-site redirect back from WorkOS.
 */
export function buildSsoStateCookie(state: string): string {
  const isProd = process.env.NODE_ENV === "production";
  const maxAge = Math.floor(SSO_STATE_TTL_MS / 1000);
  const attrs = [
    `${SSO_STATE_COOKIE}=${encodeURIComponent(state)}`,
    `Path=/api/auth`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${maxAge}`,
  ];
  if (isProd) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildClearSsoStateCookie(): string {
  const isProd = process.env.NODE_ENV === "production";
  const attrs = [
    `${SSO_STATE_COOKIE}=`,
    `Path=/api/auth`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=0`,
  ];
  if (isProd) attrs.push("Secure");
  return attrs.join("; ");
}
