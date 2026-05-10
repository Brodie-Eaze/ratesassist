/**
 * GET /api/me
 *
 * Returns the current session (sans signature) plus the effective permission
 * set, or 401 if the caller is unauthenticated. Used by the client-side
 * AuthGate to decide whether to render or redirect, and by anything else
 * that needs the principal.
 *
 * The session has already been validated and forwarded by middleware via
 * the x-session header; we read it from there to avoid re-verifying.
 */

import { NextRequest, NextResponse } from "next/server";

import { effectivePermissions, getSessionFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest): NextResponse {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, code: "unauthorized" },
      { status: 401 },
    );
  }
  return NextResponse.json({
    ok: true,
    session,
    permissions: effectivePermissions(session),
  });
}
