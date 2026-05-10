/**
 * Auth & RBAC for apps/web.
 *
 * Round 4: stub-grade signed session cookies (HMAC-SHA-256), with the wire
 * format and helper surface designed so we can swap the issuer for a real
 * SSO provider (WorkOS / Microsoft Entra) in Phase 4 without touching call
 * sites.
 *
 * Wire format: base64url(header).base64url(payload).base64url(sig)
 *   header  = { alg: "HS256", typ: "RA-SESSION", v: 1 }
 *   payload = Session (see @ratesassist/contract)
 *   sig     = HMAC-SHA-256(secret, header + "." + payload)
 *
 * Both the Edge middleware and the Node route handlers use this module —
 * everything goes through Web Crypto (`globalThis.crypto.subtle`) so it
 * works in both runtimes. Pino is Node-only, so logging here is gated to
 * the Node runtime path; Edge callers log via `console.warn` directly.
 *
 * Downstream route handlers MUST NOT re-verify cookies — middleware injects
 * the validated session into the `x-session` request header. Use
 * `getSessionFromRequest(req)` to read it.
 */

import type { NextRequest } from "next/server";
import {
  type Permission,
  type Role,
  type Session,
  RBAC,
} from "@ratesassist/contract";

export const SESSION_COOKIE = "ra_session";
export const SESSION_HEADER = "x-session";
const TOKEN_HEADER = { alg: "HS256", typ: "RA-SESSION", v: 1 } as const;

/** Default session TTL — 8 hours, matches a typical work shift. */
export const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// ---------- secret resolution ----------------------------------------------

let cachedSecret: string | undefined;

/**
 * Resolve the HMAC secret. In production, RA_AUTH_SECRET MUST be set — this
 * function throws to crash the route/module load on first use, which is what
 * we want (refuse to start without a secret).
 *
 * In dev/test we synthesize a stable but obviously-not-production secret.
 */
export function getAuthSecret(): string {
  if (cachedSecret) return cachedSecret;
  const env = process.env["RA_AUTH_SECRET"];
  if (env && env.length >= 16) {
    cachedSecret = env;
    return cachedSecret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "RA_AUTH_SECRET is required in production (>=16 chars). Refusing to start.",
    );
  }
  // Deterministic dev secret. Never used to protect anything real.
  cachedSecret = "ratesassist-dev-secret-DO-NOT-USE-IN-PROD";
  return cachedSecret;
}

/** Test hook — clears cached secret so tests can mutate process.env between cases. */
export function _resetAuthSecretCacheForTests(): void {
  cachedSecret = undefined;
}

// ---------- base64url helpers (runtime-agnostic) ---------------------------

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // btoa is available in Edge + Node 20+.
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function fromUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

// ---------- HMAC sign / verify ---------------------------------------------

/**
 * SubtleCrypto's BufferSource accepts both ArrayBuffer and TypedArray (incl.
 * Uint8Array). The Edge runtime's `instanceof ArrayBuffer` check rejects
 * fresh ArrayBuffers built via `new ArrayBuffer(...)` in some Next.js
 * Edge bundlings, so we pass the Uint8Array directly — its `.buffer` member
 * is read by the runtime regardless of vm-context realm differences.
 */
async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    utf8(secret) as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, utf8(data) as unknown as BufferSource),
  );
  return b64urlFromBytes(sig);
}

async function hmacVerify(
  secret: string,
  data: string,
  signatureB64url: string,
): Promise<boolean> {
  try {
    const key = await importHmacKey(secret);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      bytesFromB64url(signatureB64url) as unknown as BufferSource,
      utf8(data) as unknown as BufferSource,
    );
  } catch {
    return false;
  }
}

// ---------- token issue / verify -------------------------------------------

/**
 * Sign a Session into the wire format. Used by the dev/demo stub provider
 * and by the (future) SSO callback once it's wired up.
 */
export async function signSessionToken(session: Session): Promise<string> {
  const secret = getAuthSecret();
  const header = b64urlFromBytes(utf8(JSON.stringify(TOKEN_HEADER)));
  const payload = b64urlFromBytes(utf8(JSON.stringify(session)));
  const signingInput = `${header}.${payload}`;
  const sig = await hmacSign(secret, signingInput);
  return `${signingInput}.${sig}`;
}

/**
 * Verify a token and return the embedded Session, or null if invalid /
 * expired / tampered. Never throws — this is called inline in the request
 * path on every request.
 */
export async function verifySessionToken(
  token: string,
): Promise<Session | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sig] = parts as [string, string, string];

  let header: unknown;
  try {
    header = JSON.parse(fromUtf8(bytesFromB64url(headerB64)));
  } catch {
    return null;
  }
  if (
    !header ||
    typeof header !== "object" ||
    (header as { alg?: unknown }).alg !== "HS256" ||
    (header as { typ?: unknown }).typ !== "RA-SESSION"
  ) {
    return null;
  }

  const ok = await hmacVerify(getAuthSecret(), `${headerB64}.${payloadB64}`, sig);
  if (!ok) return null;

  let payload: Session;
  try {
    payload = JSON.parse(fromUtf8(bytesFromB64url(payloadB64))) as Session;
  } catch {
    return null;
  }

  if (!isPlausibleSession(payload)) return null;

  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  return payload;
}

function isPlausibleSession(s: unknown): s is Session {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o["userId"] === "string" &&
    typeof o["email"] === "string" &&
    typeof o["displayName"] === "string" &&
    typeof o["tenantId"] === "string" &&
    Array.isArray(o["roles"]) &&
    typeof o["expiresAt"] === "string" &&
    typeof o["issuedAt"] === "string"
  );
}

// ---------- request helpers ------------------------------------------------

/**
 * Extract a session from a request — works for both NextRequest (middleware,
 * Edge) and the standard Request (route handlers, Node). Looks at:
 *   1. Authorization: Bearer <token>
 *   2. Cookie: ra_session=<token>
 */
export async function getSession(
  req: NextRequest | Request,
): Promise<Session | null> {
  const auth = req.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    const s = await verifySessionToken(token);
    if (s) return s;
  }

  const cookieHeader = req.headers.get("cookie") ?? "";
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Pull the pre-validated session out of the `x-session` header that
 * middleware injects. Route handlers should prefer this over `getSession`
 * to avoid re-verifying on every request.
 */
export function getSessionFromRequest(
  req: NextRequest | Request,
): Session | null {
  const raw = req.headers.get(SESSION_HEADER);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    return isPlausibleSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Read a single cookie out of a Cookie header. */
export function readCookie(cookieHeader: string, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// ---------- Set-Cookie helpers ---------------------------------------------

export function buildSessionCookie(token: string, ttlMs = DEFAULT_SESSION_TTL_MS): string {
  const isProd = process.env.NODE_ENV === "production";
  const maxAge = Math.floor(ttlMs / 1000);
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${maxAge}`,
  ];
  if (isProd) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildClearSessionCookie(): string {
  const isProd = process.env.NODE_ENV === "production";
  const attrs = [
    `${SESSION_COOKIE}=`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=0`,
  ];
  if (isProd) attrs.push("Secure");
  return attrs.join("; ");
}

// ---------- guards ---------------------------------------------------------

/** Throws a 401 Response if there's no valid session. */
export async function requireSession(
  req: NextRequest | Request,
): Promise<Session> {
  const s = (await getSession(req)) ?? getSessionFromRequest(req);
  if (!s) {
    warn("auth.unauthorized", { path: tryPath(req) });
    throw jsonResponse(401, { ok: false, code: "unauthorized" });
  }
  return s;
}

export function hasPermission(session: Session, perm: Permission): boolean {
  for (const role of session.roles) {
    if (RBAC[role]?.includes(perm)) return true;
  }
  return false;
}

/** Throws a 403 Response if the session lacks the permission. */
export function requirePermission(session: Session, perm: Permission): void {
  if (!hasPermission(session, perm)) {
    warn("auth.forbidden", {
      userId: session.userId,
      tenantId: session.tenantId,
      perm,
    });
    throw jsonResponse(403, { ok: false, code: "forbidden", perm });
  }
}

/**
 * Block cross-tenant access. Platform admins bypass — they need cross-tenant
 * read for audit work.
 */
export function assertTenant(session: Session, tenantId: string): void {
  if (session.tenantId === tenantId) return;
  if (session.roles.includes("platform_admin")) return;
  warn("auth.cross_tenant_blocked", {
    userId: session.userId,
    sessionTenant: session.tenantId,
    requestedTenant: tenantId,
  });
  throw jsonResponse(403, { ok: false, code: "tenant_mismatch" });
}

// ---------- internals ------------------------------------------------------

function tryPath(req: NextRequest | Request): string | undefined {
  try {
    return new URL(req.url).pathname;
  } catch {
    return undefined;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Log at warn level. Uses pino in Node, console.warn in Edge runtime.
 * Edge can't load pino, so we feature-detect via process.versions.
 */
function warn(event: string, fields: Record<string, unknown>): void {
  const isNode = typeof process !== "undefined" && !!process.versions?.node && typeof window === "undefined";
  if (isNode && !isEdgeRuntime()) {
    // Lazy import — keep Edge bundles small.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { scoped } = require("./logger") as typeof import("./logger");
      scoped("auth").warn({ event, ...fields });
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({
      level: "warn",
      scope: "auth",
      event,
      ...fields,
      time: new Date().toISOString(),
    }));
  } catch {
    /* never let logging throw */
  }
}

function isEdgeRuntime(): boolean {
  // Next.js sets this to "edge" in middleware / edge route handlers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).EdgeRuntime !== undefined;
}

/** All permissions a session can currently exercise. Useful for /api/me. */
export function effectivePermissions(session: Session): ReadonlyArray<Permission> {
  const set = new Set<Permission>();
  for (const role of session.roles) {
    for (const p of RBAC[role] ?? []) set.add(p);
  }
  return [...set];
}

/** Re-export Role for convenience so route handlers don't dual-import. */
export type { Role, Permission, Session };
