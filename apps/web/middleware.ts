/**
 * Next.js middleware — trace-id propagation, CSRF/Origin gate, and auth gate.
 *
 * Runs on the Edge runtime, so it cannot use pino/AsyncLocalStorage
 * directly. Instead it:
 *
 *   1. Picks an inbound `X-Request-Id` / `Trace-Id` (or mints a UUID).
 *   2. Forwards it to the route handler via the `x-correlation-id`
 *      request header.
 *   3. Echoes it on the response as `x-correlation-id`.
 *   4. Emits a single JSON `request.start` line for ingress visibility.
 *   5. Enforces the SEC-014 Origin/CSRF check on mutating verbs.
 *   6. Enforces the auth gate: every /api/* path requires a valid signed
 *      session unless it's in PUBLIC_API_PREFIXES. HTML routes outside
 *      /login are redirected to /login instead of 401'd.
 *
 * The validated session is forwarded to route handlers via the
 * `x-session` request header so handlers don't have to re-verify on every
 * request. (Browsers cannot set this header — middleware controls it.)
 */

import { NextRequest, NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  SESSION_HEADER,
  buildSessionCookie,
  readCookie,
  verifySessionToken,
} from "./lib/auth";
import { issueStubSession, parseDevAutologin } from "./lib/auth-stub";
import type { Session } from "@ratesassist/contract";

const CORRELATION_HEADER = "x-correlation-id";

const PUBLIC_API_PREFIXES: readonly string[] = [
  "/api/health",
  "/api/ready",
  "/api/version",
  "/api/auth/",
  // JD-2: public document-integrity verification. A council's legal team or
  // a tribunal posts a downloaded PDF to confirm it is unmodified. No session
  // — the cryptographic check (HMAC + stored byte-hash) IS the trust anchor,
  // and the handler rate-limits + returns no PII.
  "/api/verify/",
];

/**
 * HTML routes that bypass the auth gate. The root "/" is public so unauth
 * visitors can land on the marketing page; page.tsx itself decides whether
 * to render the dashboard (authed) or the landing surface (unauthed).
 *
 * The marketing surface (/landing and /how-it-works) is public for the same
 * reason — /how-it-works is the full explainer a council CFO reads before
 * requesting a pilot. It is linked directly from the public nav and the
 * landing teaser, and renders first-party content only, so gating it behind
 * /login would make the page unreachable by the very audience it is written
 * for.
 *
 * Trust-signal pages (/status, /security, /changelog, /privacy, /trust
 * and /trust/sub-processors) are public by design — they are pre-demo
 * procurement table stakes. They render first-party content only (no
 * session-derived data, no tenant context) so the auth gate would only
 * stand between a council CFO's IT lead and the security posture they
 * need to read before approving a meeting.
 */
const PUBLIC_HTML_PATHS: readonly string[] = [
  "/login",
  "/landing",
  "/how-it-works",
  "/",
  "/status",
  "/security",
  "/changelog",
  "/privacy",
  "/trust",
  "/trust/sub-processors",
];

function isPublicApi(path: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (p) => path === p || path.startsWith(p.endsWith("/") ? p : p + "/"),
  );
}

function isPublicHtml(path: string): boolean {
  if (PUBLIC_HTML_PATHS.includes(path)) return true;
  // Static / framework paths are excluded by the matcher already, but keep
  // a defensive check for /favicon.ico etc. that share the matcher.
  return path.startsWith("/_next/") || path === "/favicon.ico";
}

function isWellFormedId(v: string): boolean {
  if (v.length === 0 || v.length > 128) return false;
  return /^[A-Za-z0-9._\-:]+$/.test(v);
}

function pickOrMintId(req: NextRequest): string {
  const inbound =
    req.headers.get("x-request-id") ??
    req.headers.get("trace-id") ??
    req.headers.get(CORRELATION_HEADER);
  if (inbound && isWellFormedId(inbound)) return inbound;
  // crypto.randomUUID is available in the Edge runtime.
  return crypto.randomUUID();
}

const MUTATING_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/**
 * Hardcoded CSRF/Origin-check exempt paths.
 *
 * Pen-test F-007 (ship-ready iter1) flagged that the previous
 * env-driven `RA_CSRF_EXEMPT_PATHS` was a single-typo footgun: setting
 * the env to "/api/" disabled CSRF on the entire MCP dispatcher,
 * turning every mutating tool into a cross-origin write target for
 * any malicious page a logged-in clerk visited.
 *
 * The exempt list is now constant. Callbacks that legitimately bypass
 * the Origin check (SSO OAuth callback only) are listed here in
 * source — any new exemption requires a code review and a commit
 * message explaining why the path is safe.
 *
 * Behaviour preservation: the env var is read with a deprecation log
 * but otherwise ignored. Operators who set it will see the warning
 * in /api/ready logs and can remove it at their convenience.
 */
const HARDCODED_CSRF_EXEMPT_PATHS: ReadonlyArray<string> = [
  // SSO callback — the IdP redirects with a one-time code in the URL,
  // and we cannot constrain its Origin header. The OAuth state-token
  // check inside the callback handler is the actual CSRF defense.
  "/api/auth/sso/callback",
  // JD-2 public document verification — called programmatically (a council
  // solicitor / tribunal posting a downloaded PDF), so it carries no
  // first-party Origin. It is unauthenticated and read-only with respect to
  // server state (it only HASHES the upload + reads the audit log), so CSRF
  // — which protects a victim's authenticated session — does not apply.
  "/api/verify/pack",
] as const;

let warnedCsrfEnvDeprecated = false;

function csrfExemptPaths(): readonly string[] {
  if (
    !warnedCsrfEnvDeprecated &&
    (process.env["RA_CSRF_EXEMPT_PATHS"] ?? "").length > 0
  ) {
    warnedCsrfEnvDeprecated = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[security] RA_CSRF_EXEMPT_PATHS env var is ignored (F-007 mitigation). Exempt paths are now hardcoded in middleware.ts.",
    );
  }
  return HARDCODED_CSRF_EXEMPT_PATHS;
}

function pathIsExempt(path: string, exempt: readonly string[]): boolean {
  return exempt.some(
    (p) => path === p || path.startsWith(p.endsWith("/") ? p : p + "/"),
  );
}

function originHostMatches(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const requestHost = (req.headers.get("host") ?? req.nextUrl.host).toLowerCase();
  return originHost === requestHost;
}

function logSecurityEvent(
  event: string,
  fields: Record<string, unknown>,
): void {
  try {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        level: "warn",
        scope: "middleware",
        event,
        ...fields,
        time: new Date().toISOString(),
      }),
    );
  } catch {
    // never let logging break a request
  }
}

async function resolveSession(
  req: NextRequest,
): Promise<{ session: Session | null; mintedToken: string | null }> {
  // 1. existing cookie / Authorization header
  const auth = req.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const s = await verifySessionToken(auth.slice(7).trim());
    if (s) return { session: s, mintedToken: null };
  }
  const token = readCookie(req.headers.get("cookie") ?? "", SESSION_COOKIE);
  if (token) {
    const s = await verifySessionToken(token);
    if (s) return { session: s, mintedToken: null };
  }

  // 2. dev autologin — forge a session on the fly so demo flows work without
  //    a login round trip. Disabled in production by parseDevAutologin().
  const autologin = parseDevAutologin();
  if (autologin) {
    const { session, token: minted } = await issueStubSession(autologin);
    return { session, mintedToken: minted };
  }

  return { session: null, mintedToken: null };
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const correlationId = pickOrMintId(req);
  const method = req.method;
  const path = req.nextUrl.pathname;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined;

  // CSRF / Origin check on mutating verbs. GET/HEAD/OPTIONS are unaffected.
  if (MUTATING_METHODS.has(method) && path.startsWith("/api/")) {
    const exempt = csrfExemptPaths();
    if (!pathIsExempt(path, exempt) && !originHostMatches(req)) {
      logSecurityEvent("security.csrf_origin_mismatch", {
        ip,
        ua: req.headers.get("user-agent") ?? undefined,
        path,
        method,
        origin: req.headers.get("origin") ?? undefined,
        host: req.headers.get("host") ?? undefined,
        correlationId,
      });
      return new NextResponse(
        JSON.stringify({ ok: false, code: "csrf_origin_mismatch" }),
        {
          status: 403,
          headers: {
            "content-type": "application/json",
            "x-correlation-id": correlationId,
          },
        },
      );
    }
  }

  // Auth gate. Public paths bypass; everything else needs a session.
  const isApi = path.startsWith("/api/");
  const isPublic = isApi ? isPublicApi(path) : isPublicHtml(path);

  let session: Session | null = null;
  let mintedToken: string | null = null;

  // Resolve session opportunistically on public HTML routes too — pages
  // like "/" want to know if the visitor is signed in so they can render
  // the dashboard instead of the marketing landing. Public API routes skip
  // this to keep the unauth path zero-cost.
  if (isPublic && !isApi) {
    const resolved = await resolveSession(req);
    session = resolved.session;
    mintedToken = resolved.mintedToken;
  }

  if (!isPublic) {
    const resolved = await resolveSession(req);
    session = resolved.session;
    mintedToken = resolved.mintedToken;

    if (!session) {
      logSecurityEvent("auth.unauthorized", {
        ip,
        path,
        method,
        correlationId,
      });
      if (isApi) {
        return new NextResponse(
          JSON.stringify({ ok: false, code: "unauthorized" }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
              "x-correlation-id": correlationId,
            },
          },
        );
      }
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", path);
      const redirect = NextResponse.redirect(url);
      redirect.headers.set("x-correlation-id", correlationId);
      return redirect;
    }
  }

  // JSON ingress log — visible in `vercel logs` / container stdout.
  try {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: "info",
        scope: "middleware",
        msg: "request.start",
        method,
        path,
        correlationId,
        ...(ip !== undefined ? { ip } : {}),
        ...(session ? { userId: session.userId, tenantId: session.tenantId } : {}),
        time: new Date().toISOString(),
      }),
    );
  } catch {
    // never let logging break a request
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(CORRELATION_HEADER, correlationId);
  // SEC-003: middleware is the SOLE writer of x-session. Route handlers trust
  // it precisely because a client cannot set it — but `new Headers(req.headers)`
  // copies an inbound one verbatim, and on a public route `session` may be
  // null (so the conditional set below wouldn't overwrite it). Strip any
  // client-supplied value UNCONDITIONALLY first, then set it only from the
  // verified session. Without this, a forged `x-session` on a public route
  // would reach any handler that reads it via getSessionFromRequest — an
  // auth bypass / cross-tenant impersonation.
  requestHeaders.delete(SESSION_HEADER);
  if (session) {
    requestHeaders.set(SESSION_HEADER, JSON.stringify(session));
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(CORRELATION_HEADER, correlationId);
  if (mintedToken) {
    // Persist the autologin session on the response so subsequent requests
    // hit the cookie path instead of re-minting every time.
    res.headers.append("set-cookie", buildSessionCookie(mintedToken));
  }
  return res;
}

export const config = {
  /*
   * Run middleware on:
   *   - all /api/* (auth + CSRF + trace)
   *   - all HTML routes except /login, _next, and static assets
   *
   * The negative lookahead excludes Next internals + common static extensions.
   */
  matcher: [
    "/api/:path*",
    "/((?!_next/|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:css|js|png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf|map)$).*)",
  ],
};
