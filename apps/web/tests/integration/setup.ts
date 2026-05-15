/**
 * Shared bootstrap for the cross-layer integration tests.
 *
 * Each test file imports {@link bootstrapTestEnv} once in a top-level
 * `beforeAll` (or before importing route modules). The helper:
 *
 *   1. Pins the env to a deterministic config (in-proc transport, dev
 *      autologin, pglite via empty DATABASE_URL).
 *   2. Resets the DB singleton so each suite starts fresh.
 *   3. Returns a {@link Session} factory pinned to the WA demo tenant.
 *
 * Integration tests run the full HTTP → tool → engine → DB path against a
 * pglite-backed Drizzle instance. No real Postgres required.
 */

import type { Role, Session } from "@ratesassist/contract";
import { resetDbForTesting } from "@ratesassist/db";
import { vi } from "vitest";

process.env["RA_AUTH_SECRET"] =
  process.env["RA_AUTH_SECRET"] ?? "ratesassist-test-secret-32chars!!!";
process.env["RA_TOOL_TRANSPORT"] = "inproc";
process.env["RA_USE_DB"] = "true";
delete process.env["DATABASE_URL"];

const SESSION_HEADER_NAME = "x-session";

export async function bootstrapTestEnv(): Promise<void> {
  // Reset between suites so each gets a virgin pglite + adapter store.
  resetDbForTesting();
  vi.resetModules();

  const inproc = await import("@ratesassist/adapter-demo/inproc");
  inproc._resetInproc();
  const audit = await import("@ratesassist/adapter-demo/audit");
  audit._resetForTests();

  // Reset the web-app DB bootstrap memo so the next request triggers a
  // fresh ensureSchema + ensureSeeded pass.
  const dbModule = await import("../../lib/db");
  dbModule.resetWebDbForTesting();

  // Clear the EvaluationContext cache.
  const clients = await import("../../lib/clients");
  // invalidate returns a Promise when DB-wired; tests await it explicitly.
  await clients.invalidateEvaluationContext();
}

export function makeSession(roles: Role[], tenantId = "TPS"): Session {
  const now = Date.now();
  return {
    userId: "u-integration-1",
    email: "u-integration-1@example.test",
    displayName: "Integration Tester",
    tenantId,
    roles,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(),
  };
}

export function sessionHeader(s: Session): Record<string, string> {
  return { [SESSION_HEADER_NAME]: JSON.stringify(s) };
}
