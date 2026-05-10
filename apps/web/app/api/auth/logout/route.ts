/**
 * POST /api/auth/logout
 *
 * Clears the session cookie. Always 200 — logout is idempotent. We don't
 * maintain a server-side session store yet (sessions are self-contained
 * signed tokens), so there is nothing to revoke server-side; that comes
 * with the audit log work in Round 5+.
 */

import { NextResponse } from "next/server";

import { buildClearSessionCookie } from "@/lib/auth";
import { scoped } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = scoped("auth.logout");

export function POST(): NextResponse {
  log.info({ event: "auth.logout" });
  const res = NextResponse.json({ ok: true });
  res.headers.append("set-cookie", buildClearSessionCookie());
  return res;
}
