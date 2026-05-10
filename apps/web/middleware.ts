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
];

const PUBLIC_HTML_PATHS: readonly string[] = ["/login"];

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

function csrfExemptPaths(): readonly string[] {
  const raw = process.env["RA_CSRF_EXEMPT_PATHS"] ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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
