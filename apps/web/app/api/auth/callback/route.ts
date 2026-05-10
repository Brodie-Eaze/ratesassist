/**
 * GET / POST /api/auth/callback
 *
 * Placeholder for the SSO callback. Real WorkOS / Microsoft Entra
 * integration is Phase 4 (see PRODUCTION-PLAN.md). The route is wired
 * now so config / env / docs can refer to a stable URL.
 *
 * Response shape (501):
 *   {
 *     ok: false,
 *     code: "not_implemented",
 *     provider: <env RA_SSO_PROVIDER or null>,
 *     message: "...",
 *   }
 */

import { NextResponse } from "next/server";

import { scoped } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = scoped("auth.sso");

function notImplemented(): NextResponse {
  log.warn({
    event: "auth.sso.callback.not_implemented",
    provider: process.env["RA_SSO_PROVIDER"] ?? null,
  });
  return NextResponse.json(
    {
      ok: false,
      code: "not_implemented",
      provider: process.env["RA_SSO_PROVIDER"] ?? null,
      message:
        "SSO callback not yet implemented. WorkOS / Microsoft Entra integration is Phase 4. See PRODUCTION-PLAN.md.",
    },
    { status: 501 },
  );
}

export function GET(): NextResponse {
  return notImplemented();
}

export function POST(): NextResponse {
  return notImplemented();
}
