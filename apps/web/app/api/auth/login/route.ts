/**
 * POST /api/auth/login
 *
 * Dev/demo only. Body: { tenantId: string, role: Role, email?, displayName?, userId? }.
 * In production this returns 501 — real login goes through the SSO callback
 * (Phase 4, /api/auth/callback). This route exists so the local dev login
 * page and the smoke harness can mint a working session without an IdP.
 *
 * The cookie issued is a real HMAC-signed session token. Tampering still
 * fails verification.
 */

import { NextRequest, NextResponse } from "next/server";

import { ALL_ROLES, type Role } from "@ratesassist/contract";
import { buildSessionCookie } from "@/lib/auth";
import { issueStubSession, isProductionMode } from "@/lib/auth-stub";
import { scoped } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = scoped("auth.login");

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (isProductionMode()) {
    return NextResponse.json(
      {
        ok: false,
        code: "not_implemented",
        message:
          "Dev login is disabled in production. Use the SSO flow at /api/auth/callback (Phase 4).",
      },
      { status: 501 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "bad_request", message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const obj = (body ?? {}) as Record<string, unknown>;
  const tenantId =
    typeof obj["tenantId"] === "string" && obj["tenantId"].trim().length > 0
      ? (obj["tenantId"] as string)
      : null;
  const roleRaw = obj["role"];
  const role =
    typeof roleRaw === "string" && (ALL_ROLES as readonly string[]).includes(roleRaw)
      ? (roleRaw as Role)
      : null;

  if (!tenantId || !role) {
    return NextResponse.json(
      {
        ok: false,
        code: "bad_request",
        message: "tenantId and role are required.",
      },
      { status: 400 },
    );
  }

  const { session, token } = await issueStubSession({
    tenantId,
    roles: [role],
    email: typeof obj["email"] === "string" ? (obj["email"] as string) : undefined,
    displayName:
      typeof obj["displayName"] === "string"
        ? (obj["displayName"] as string)
        : undefined,
    userId:
      typeof obj["userId"] === "string" ? (obj["userId"] as string) : undefined,
  });

  log.info({
    event: "auth.login.dev",
    userId: session.userId,
    tenantId: session.tenantId,
    roles: session.roles,
  });

  const res = NextResponse.json({ ok: true, session });
  res.headers.append("set-cookie", buildSessionCookie(token));
  return res;
}
