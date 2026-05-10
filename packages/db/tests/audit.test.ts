/**
 * Audit helper + tenant GUC tests.
 *
 * pglite executes the migration but does NOT enforce role-based privileges
 * (it runs everything as the implicit superuser). We therefore skip the
 * "UPDATE returns permission denied" assertion under pglite and document
 * that it must be re-verified against real Postgres in CI.
 */

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, tenants } from "../src/schema.js";
import { withAudit, recordAuditEvent } from "../src/audit.js";
import { createTestDb } from "./helpers.js";

describe("withAudit", () => {
  it("writes a row with correct fields and rolls in the same txn", async () => {
    const { db } = await createTestDb();

    const [t] = await db
      .insert(tenants)
      .values({
        code: "AUD",
        name: "Audit Council",
        state: "WA",
        centerLat: -32,
        centerLng: 116,
        population: 1000,
        rateableProperties: 500,
        rateRevenue: "1000000.00",
      })
      .returning();

    // Cast through unknown — pglite drizzle and node-postgres drizzle have
    // structurally compatible APIs for the surface withAudit uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;

    const result = await withAudit(
      dbAny,
      {
        tenantId: t!.id,
        actorId: "user-1",
        actorKind: "user",
        correlationId: "corr-1",
      },
      "test.action",
      {
        type: "tenant",
        id: t!.id,
        read: async () => ({ snapshot: t!.code }),
      },
      async () => "ok",
    );

    expect(result).toBe("ok");

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.tenantId, t!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("test.action");
    expect(rows[0]?.actorId).toBe("user-1");
    expect(rows[0]?.actorKind).toBe("user");
    expect(rows[0]?.targetType).toBe("tenant");
    expect(rows[0]?.targetId).toBe(t!.id);
    expect(rows[0]?.correlationId).toBe("corr-1");
    expect(rows[0]?.before).toEqual({ snapshot: "AUD" });
    expect(rows[0]?.after).toEqual({ snapshot: "AUD" });
  });

  it("recordAuditEvent inserts without before/after", async () => {
    const { db } = await createTestDb();
    const [t] = await db
      .insert(tenants)
      .values({
        code: "AUD2",
        name: "Audit Council 2",
        state: "WA",
        centerLat: -32,
        centerLng: 116,
        population: 1000,
        rateableProperties: 500,
        rateRevenue: "1000000.00",
      })
      .returning();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;
    await recordAuditEvent(
      dbAny,
      {
        tenantId: t!.id,
        actorId: "svc",
        actorKind: "service",
      },
      "system.tick",
      { type: "system", id: "scheduler" },
      { reason: "boot" },
    );

    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("system.tick");
    expect(rows[0]?.before).toBeNull();
    expect(rows[0]?.after).toEqual({ reason: "boot" });
  });

  it("withTenant sets the app.tenant_id GUC inside the transaction", async () => {
    const { db } = await createTestDb();
    const [t] = await db
      .insert(tenants)
      .values({
        code: "GUC",
        name: "GUC Council",
        state: "WA",
        centerLat: -32,
        centerLng: 116,
        population: 1000,
        rateableProperties: 500,
        rateRevenue: "1000000.00",
      })
      .returning();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;
    const { withTenant } = await import("../src/client.js");

    let captured: string | null = null;
    await withTenant(dbAny, t!.id, async (tx) => {
      const r = await tx.execute(
        sql`select current_setting('app.tenant_id', true) as v`,
      );
      // pglite returns { rows: [{ v: '<tenantId>' }] }
      // node-postgres returns the same shape.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (r as any).rows ?? r;
      captured = rows[0]?.v ?? null;
    });
    expect(captured).toBe(t!.id);
  });

  it.skip("audit_log UPDATE returns permission denied (skipped under pglite)", () => {
    // Real-Postgres only: the migration REVOKEs UPDATE, DELETE on audit_log
    // from PUBLIC, and the application connects as `app_user`. Verified in
    // the staging integration test against RDS.
  });
});
