/**
 * Next.js middleware — trace-id propagation only (no auth here).
 *
 * Runs on the Edge runtime, so it cannot use pino/AsyncLocalStorage
 * directly. Instead it:
 *
 *   1. Picks an inbound `X-Request-Id` / `Trace-Id` (or mints a UUID).
 *   2. Forwards it to the route handler via the `x-correlation-id`
 *      request header.
 *   3. Echoes it on the response as `x-correlation-id`.
 *   4. Emits a single JSON `request.start` line for ingress visibility.
 *
 * Route handlers retrieve the id with `correlationIdFromHeaders(req.headers)`
 * and wrap their work in `runWithCorrelation(...)` (Node runtime), which
 * is where the AsyncLocalStorage chain actually lives.
 *
 * Auth, CSP, HSTS, region pinning — separate track, NOT here.
 */

import { NextRequest, NextResponse } from "next/server";

const CORRELATION_HEADER = "x-correlation-id";

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

export function middleware(req: NextRequest): NextResponse {
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

  // JSON ingress log — visible in `vercel logs` / container stdout.
  // (Edge runtime can't load pino; raw JSON keeps the schema consistent.)
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
        time: new Date().toISOString(),
      }),
    );
  } catch {
    // never let logging break a request
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(CORRELATION_HEADER, correlationId);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(CORRELATION_HEADER, correlationId);
  return res;
}

export const config = {
  // Trace-id middleware applies to API routes only for now.
  matcher: ["/api/:path*"],
};
