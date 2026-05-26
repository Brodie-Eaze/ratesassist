/**
 * GET /api/audit/verify-chain — route tests.
 *
 * Verifies the chain-walk + tamper detection + tenant-scoping behaviour.
 * Uses a real pglite-backed DB (via `getWebDb`), runs every migration
 * (including 0002 + 0003 — the chain columns + NOT NULL flip), and drives
 * audit writes via `withAudit` so the route exercises the full read path:
 *   route → getWebDb → SELECT audit_log → verifyChain
 *
 * What we prove:
 *   - 401 when no session.
 *   - 403 for a role without `read.audit_log`.
 *   - 403 when a non-platform_admin tries to verify a different tenant.
 *   - 200 + ok:true on a clean chain.
 *   - 200 + ok:false + brokenAt on a tampered row.
 *   - 200 + ok:true + evictionTruncated when a `since=` window cuts the chain.
 */

import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
process.env["RA_USE_DB"] = "true";

import type { Role, Session } from "@ratesassist/contract";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../lib/auth";
import { __resetRateLimitBucketsForTests } from "../lib/rate-limit";

const { GET: verifyGET } = await import("../app/api/audit/verify-chain/route");
const { getWebDb, resetWebDbForTesting } = await import("../lib/db");

beforeAll(() => {
  _resetAuthSecretCacheForTests();
});

beforeEach(() => {
  // Force a fresh DB per test so chain state doesn't leak between cases.
  resetWebDbForTesting();
  // iter4 (F-011): clear rate-limit buckets so the 6/min verify-chain
  // cap doesn't trip between sequential test cases (all share IP ::1).
  __resetRateLimitBucketsForTests();
  // Force a fresh pglite instance as well so we don't reuse table state.
  // We have to lazy-import to keep the test side-effect minimal.
});

function freshSession(roles: Role[], tenantId: string): Session {
  const now = Date.now();
  return {
    userId: "u1",
    email: "u1@example.com",
    displayName: "User One",
    tenantId,
    roles,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  };
}

function reqWith(
  session: Session | null,
  url = "http://localhost/api/audit/verify-chain",
): NextRequest {
  const headers = new Headers();
  if (session) headers.set(SESSION_HEADER, JSON.stringify(session));
  return new NextRequest(new URL(url), { method: "GET", headers });
}

async function seedTenantAndChain(
  tenantCode: string,
  rowCount: number,
): Promise<string> {
  // Reset the package-level pglite state — same realm as the route's import.
  const dbPkg = await import("@ratesassist/db");
  dbPkg.resetDbForTesting();
  resetWebDbForTesting();

  const db = await getWebDb();
  // Insert a tenant row.
  const [t] = await db
    .insert(dbPkg.tenants)
    .values({
      code: tenantCode,
      name: `${tenantCode} Test`,
      state: "WA",
      centerLat: -32,
      centerLng: 116,
      population: 1000,
      rateableProperties: 500,
      rateRevenue: "1000000.00",
    })
    .returning();
  const tenantId = t!.id;

  // Drive N withAudit calls so the chain has rows.
  for (let i = 0; i < rowCount; i++) {
    await dbPkg.withAudit(
      db,
      { tenantId, actorId: "tester", actorKind: "user" },
      `route.step.${i}`,
      { type: "tenant", id: tenantId, read: async () => ({ i }) },
      async () => undefined,
    );
  }
  return tenantId;
}

interface OkBody {
  readonly ok: true;
  readonly data: {
    readonly ok: boolean;
    readonly totalRows: number;
    readonly latestTs: string | null;
    readonly brokenAt?: number;
    readonly expectedHash?: string;
    readonly actualHash?: string;
    readonly evictionTruncated: boolean;
  };
}

interface FailBody {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

describe("GET /api/audit/verify-chain", () => {
  it("401 when no session", async () => {
    const res = await verifyGET(reqWith(null));
    expect(res.status).toBe(401);
  });

  it("403 for a role without read.audit_log", async () => {
    const tenantId = await seedTenantAndChain("RTS1", 1);
    const res = await verifyGET(
      reqWith(freshSession(["rates_officer"], tenantId)),
    );
    expect(res.status).toBe(403);
  });

  it("200 + ok:true on a clean chain (rates_supervisor, own tenant)", async () => {
    const tenantId = await seedTenantAndChain("CLN1", 5);
    const res = await verifyGET(
      reqWith(freshSession(["rates_supervisor"], tenantId)),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as OkBody;
    expect(body.ok).toBe(true);
    expect(body.data.ok).toBe(true);
    expect(body.data.totalRows).toBe(5);
    expect(body.data.evictionTruncated).toBe(false);
    expect(body.data.brokenAt).toBeUndefined();
  });

  it("403 when a non-platform_admin tries to verify a foreign tenant", async () => {
    const tenantId = await seedTenantAndChain("FRN1", 1);
    const otherSession = freshSession(["rates_supervisor"], "00000000-0000-0000-0000-000000000000");
    const res = await verifyGET(
      reqWith(
        otherSession,
        `http://localhost/api/audit/verify-chain?tenantId=${tenantId}`,
      ),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as FailBody;
    expect(body.ok).toBe(false);
    expect(body.code).toBe("forbidden");
  });

  it("200 + ok:true cross-tenant for platform_admin", async () => {
    const tenantId = await seedTenantAndChain("PA1", 3);
    const adminSession = freshSession(["platform_admin"], "00000000-0000-0000-0000-000000000000");
    const res = await verifyGET(
      reqWith(
        adminSession,
        `http://localhost/api/audit/verify-chain?tenantId=${tenantId}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as OkBody;
    expect(body.data.ok).toBe(true);
    expect(body.data.totalRows).toBe(3);
  });

  it("200 + ok:false + brokenAt when a row is tampered (synthetic UPDATE bypass)", async () => {
    const tenantId = await seedTenantAndChain("TMP1", 5);

    // Tamper directly. pglite ignores the REVOKE; real PG would refuse.
    const dbPkg = await import("@ratesassist/db");
    const db = await getWebDb();
    // Pick the row at chain-index 2.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await (db as any).execute(dbPkg.sql`
      SELECT id FROM audit_log
       WHERE tenant_id = ${tenantId}
       ORDER BY occurred_at ASC, id ASC
       LIMIT 5
    `);
    const rows = (raw.rows ?? raw) as Array<{ id: string }>;
    const victim = rows[2]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).execute(dbPkg.sql`
      UPDATE audit_log SET after = '{"tampered":true}'::jsonb
       WHERE id = ${victim.id}
    `);

    const res = await verifyGET(
      reqWith(freshSession(["rates_supervisor"], tenantId)),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as OkBody;
    expect(body.data.ok).toBe(false);
    expect(body.data.brokenAt).toBe(2);
    expect(body.data.expectedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.actualHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.expectedHash).not.toBe(body.data.actualHash);
  });

  it("200 + ok:true + evictionTruncated when `since=` cuts past genesis", async () => {
    const tenantId = await seedTenantAndChain("EVC1", 5);
    // Use the timestamp of row 3 as the `since` so rows 0..2 are clipped.
    const dbPkg = await import("@ratesassist/db");
    const db = await getWebDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await (db as any).execute(dbPkg.sql`
      SELECT occurred_at FROM audit_log
       WHERE tenant_id = ${tenantId}
       ORDER BY occurred_at ASC, id ASC
       LIMIT 5
    `);
    const rows = (raw.rows ?? raw) as Array<{ occurred_at: string | Date }>;
    const cut = rows[3]!.occurred_at;
    const cutIso = cut instanceof Date ? cut.toISOString() : new Date(cut).toISOString();

    const res = await verifyGET(
      reqWith(
        freshSession(["rates_supervisor"], tenantId),
        `http://localhost/api/audit/verify-chain?since=${encodeURIComponent(cutIso)}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as OkBody;
    expect(body.data.ok).toBe(true);
    expect(body.data.evictionTruncated).toBe(true);
    // 2 rows: indices 3 and 4 of the original 5.
    expect(body.data.totalRows).toBe(2);
  });
});
