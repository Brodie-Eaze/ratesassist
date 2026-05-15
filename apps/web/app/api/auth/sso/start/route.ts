/**
 * GET /api/auth/sso/start
 *
 * Begin the WorkOS OAuth dance. Mints a signed `state`, persists it via a
 * 5-minute HttpOnly cookie, and 302-redirects the browser to WorkOS's
 * authorize endpoint with that state plus our client_id / redirect_uri.
 *
 * When WorkOS is not configured (RA_SSO_CLIENT_ID unset), we redirect to
 * /login with ?error=sso_not_configured so the dev-login picker can render
 * its dev-mode UI instead.
 *
 * The `next` query parameter is preserved end-to-end: caller hits
 * /api/auth/sso/start?next=/properties → state carries `next` → callback
 * 302s to /properties on success.
 */

import { NextRequest, NextResponse } from "next/server";

import { getAuthSecret } from "@/lib/auth";
import { scoped } from "@/lib/logger";
import {
  buildAuthorizeUrl,
  buildSsoStateCookie,
  getWorkOsConfig,
  isWorkOsConfigured,
  mintState,
  sanitizeNext,
} from "@/lib/workos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = scoped("auth.sso.start");

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const next = sanitizeNext(url.searchParams.get("next"));

  if (!isWorkOsConfigured()) {
    log.warn({
      event: "auth.sso.start.not_configured",
      hint: "set RA_SSO_CLIENT_ID / RA_SSO_CLIENT_SECRET / RA_SSO_REDIRECT_URI",
    });
    const fallback = new URL(url.toString());
    fallback.pathname = "/login";
    fallback.search = "";
    fallback.searchParams.set("error", "sso_not_configured");
    if (next !== "/") fallback.searchParams.set("next", next);
    return NextResponse.redirect(fallback);
  }

  let config: ReturnType<typeof getWorkOsConfig>;
  try {
    config = getWorkOsConfig();
  } catch (err) {
    log.error({
      event: "auth.sso.start.config_error",
      err: (err as Error).message,
    });
    const fallback = new URL(url.toString());
    fallback.pathname = "/login";
    fallback.search = "";
    fallback.searchParams.set("error", "sso_not_configured");
    return NextResponse.redirect(fallback);
  }

  const state = await mintState(getAuthSecret(), next);
  const authorizeUrl = buildAuthorizeUrl({
    config,
    state,
    ...(url.searchParams.get("login_hint")
      ? { loginHint: url.searchParams.get("login_hint")! }
      : {}),
    ...(url.searchParams.get("domain_hint")
      ? { domainHint: url.searchParams.get("domain_hint")! }
      : {}),
  });

  log.info({
    event: "auth.sso.start.redirect",
    provider: config.provider,
    next,
  });

  const res = NextResponse.redirect(authorizeUrl, { status: 302 });
  res.headers.append("set-cookie", buildSsoStateCookie(state));
  return res;
}
