/**
 * GET /api/auth/callback
 *
 * The WorkOS OAuth callback. Flow:
 *
 *   1. Validate the `state` query parameter against the short-lived
 *      ra_sso_state cookie. Mismatch / expired / replayed → 302 to
 *      /login?error=callback_failed.
 *   2. Exchange `code` for a WorkOS profile via POST /sso/token.
 *   3. Map the profile to our Session (tenant + roles via lib/workos.ts).
 *   4. Sign the session with HMAC, set the ra_session cookie, 302 to the
 *      `next` URL embedded in the verified state.
 *   5. Audit log every successful callback (best-effort via structured log).
 *
 * When WorkOS is not configured we return 501 with a clear pointer to the
 * production checklist — this is the prod-default state for a fresh deploy
 * before secrets land. In dev we redirect to /login so the dev-login flow
 * can render its picker.
 *
 * The route is exempt from middleware auth (it's under /api/auth/*), but
 * is NOT exempt from the CSRF/Origin gate for POSTs. Callback is a GET so
 * that doesn't apply.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_SESSION_TTL_MS,
  buildSessionCookie,
  getAuthSecret,
  readCookie,
  signSessionToken,
} from "@/lib/auth";
import { scoped } from "@/lib/logger";
import { correlationIdFromHeaders } from "@/lib/correlation";
import { getClientIp } from "@/lib/rate-limit";
import {
  SSO_STATE_COOKIE,
  WorkOsExchangeError,
  buildClearSsoStateCookie,
  exchangeCodeForProfile,
  getWorkOsConfig,
  isWorkOsConfigured,
  profileToSession,
  resolveTenantAndRoles,
  sanitizeNext,
  verifyState,
} from "@/lib/workos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = scoped("auth.sso.callback");

/** Top-level redirect to /login with an error code. Used for every failure. */
function redirectToLoginError(
  req: NextRequest,
  code: string,
  next: string | null = null,
): NextResponse {
  const url = new URL(req.url);
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("error", code);
  if (next && next !== "/") url.searchParams.set("next", next);
  const res = NextResponse.redirect(url, { status: 302 });
  res.headers.append("set-cookie", buildClearSsoStateCookie());
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = correlationIdFromHeaders(req.headers);

  // -------- Dev fallback ----------------------------------------------------
  // No WorkOS config => the route returns 501 in prod and redirects to dev
  // login outside of prod. We don't crash the request — operators rolling
  // out a brand-new deploy hit /api/auth/callback during testing.
  if (!isWorkOsConfigured()) {
    log.warn({
      event: "auth.sso.callback.not_configured",
      correlationId,
      hint: "see internal/PRODUCTION-CHECKLIST.md",
    });
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          ok: false,
          code: "not_implemented",
          message:
            "SSO callback is not configured. Set RA_SSO_CLIENT_ID, " +
            "RA_SSO_CLIENT_SECRET, and RA_SSO_REDIRECT_URI. See " +
            "internal/PRODUCTION-CHECKLIST.md.",
        },
        { status: 501 },
      );
    }
    return redirectToLoginError(req, "sso_not_configured");
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const upstreamError = url.searchParams.get("error");

  // WorkOS reports its own errors via ?error=...
  if (upstreamError) {
    log.warn({
      event: "auth.sso.callback.upstream_error",
      correlationId,
      error: upstreamError,
      description: url.searchParams.get("error_description") ?? null,
    });
    return redirectToLoginError(req, "callback_failed");
  }

  if (!code || !state) {
    log.warn({
      event: "auth.sso.callback.missing_params",
      correlationId,
      hasCode: !!code,
      hasState: !!state,
    });
    return redirectToLoginError(req, "callback_failed");
  }

  // -------- State verification --------------------------------------------
  const cookieState = readCookie(
    req.headers.get("cookie") ?? "",
    SSO_STATE_COOKIE,
  );
  if (!cookieState) {
    log.warn({
      event: "auth.sso.callback.no_state_cookie",
      correlationId,
    });
    return redirectToLoginError(req, "callback_failed");
  }
  if (cookieState !== state) {
    log.warn({
      event: "auth.sso.callback.state_mismatch",
      correlationId,
    });
    return redirectToLoginError(req, "callback_failed");
  }
  const verified = await verifyState(getAuthSecret(), state);
  if (!verified) {
    log.warn({
      event: "auth.sso.callback.state_invalid_or_expired",
      correlationId,
    });
    return redirectToLoginError(req, "callback_failed");
  }
  const next = sanitizeNext(verified.next);

  // -------- Token exchange -------------------------------------------------
  let config: ReturnType<typeof getWorkOsConfig>;
  try {
    config = getWorkOsConfig();
  } catch (err) {
    log.error({
      event: "auth.sso.callback.config_error",
      correlationId,
      err: (err as Error).message,
    });
    return redirectToLoginError(req, "callback_failed", next);
  }

  let exchange: Awaited<ReturnType<typeof exchangeCodeForProfile>>;
  try {
    exchange = await exchangeCodeForProfile(code, config);
  } catch (err) {
    if (err instanceof WorkOsExchangeError) {
      log.warn({
        event: "auth.sso.callback.exchange_failed",
        correlationId,
        upstreamStatus: err.status,
        upstreamBody: err.upstreamBody,
      });
    } else {
      log.error({
        event: "auth.sso.callback.exchange_error",
        correlationId,
        err: (err as Error).message,
      });
    }
    return redirectToLoginError(req, "callback_failed", next);
  }

  // -------- Build + sign session ------------------------------------------
  const session = profileToSession(exchange.profile, DEFAULT_SESSION_TTL_MS);
  const token = await signSessionToken(session);
  const { domainMatched } = resolveTenantAndRoles(exchange.profile);

  // -------- Audit-log the successful callback -----------------------------
  // The auth-success line below is the audit record. It hits the same
  // structured-log stream every other audit event uses; the log shipper
  // (configured in DEPLOY.md) is what makes it tamper-evident downstream.
  // The mcp-adapter audit ring buffer only carries tool calls, not auth
  // events — that's by design (auth events outlive any single tenant).
  log.info({
    event: "auth.sso.callback.success",
    correlationId,
    userId: session.userId,
    tenantId: session.tenantId,
    roles: session.roles,
    domainMatched,
    next,
    provider: "workos",
    connection_id: exchange.profile.connection_id ?? null,
    ip: getClientIp(req),
    userAgent: req.headers.get("user-agent") ?? undefined,
    // Email is redacted by the logger's REDACT_PATHS rule — captured here
    // for completeness of the audit record before redaction.
    email: session.email,
  });

  // -------- Redirect into the app with the new cookie ---------------------
  const dest = new URL(req.url);
  dest.pathname = next;
  dest.search = "";

  const res = NextResponse.redirect(dest, { status: 302 });
  res.headers.append("set-cookie", buildSessionCookie(token));
  res.headers.append("set-cookie", buildClearSsoStateCookie());
  return res;
}
