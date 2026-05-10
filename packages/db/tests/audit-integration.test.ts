/**
 * End-to-end integration test for the DB-backed audit-log path.
 *
 * Uses pglite to apply the initial migration, then simulates a tenant-scoped
 * mutation wrapped in withAudit() and verifies the audit_log row reflects
 * the before/after snapshots, actor attribution, IP, and user-agent fields
 * a production wiring would carry through.
 *
 * The same shape is mirrored by the adapter-demo in-memory ring buffer, so
 * a downstream copy-forward sink can stream entries between them without
 * structural translation.
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { withAudit } from "../src/audit.js";
import { auditLog, owners, tenants } from "../src/schema.js";
import { createTestDb } from "./helpers.js";

describe("withAudit end-to-end (mutation + audit row in one txn)", () => {
  it("captures before/after for an owner contact update", async () => {
    const { db } = await createTestDb();

    const [t] = await db
      .insert(tenants)
      .values({
        code: "AUDE2E",
        name: "Audit E2E Council",
        state: "WA",
        centerLat: -32.0,
        centerLng: 116.0,
        population: 5000,
        rateableProperties: 2000,
        rateRevenue: "5000000.00",
      })
      .returning();
    const tenantId = t!.id;

    const [o] = await db
      .insert(owners)
      .values({
        tenantId,
        ownerExtId: "O-AUDIT-1",
        name: "Test Owner",
        postalAddress: "1 Test St, Perth WA 6000",
        email: "old@example.test",
        phone: "08 0000 0000",
        ownerSince: "2020-01-01",
      })
      .returning();
    const ownerId = o!.id;

    // pglite's drizzle is structurally compatible with node-postgres drizzle
    // for the surface withAudit uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;

    await withAudit(
      dbAny,
      {
        tenantId,
        actorId: "user-supervisor-1",
        actorKind: "user",
        correlationId: "corr-e2e-1",
        ip: "10.0.0.99",
        userAgent: "vitest/1.0",
      },
      "update_owner_contact",
      {
        type: "owner",
        id: ownerId,
        read: async (tx) => {
          const [row] = await tx
            .select({ phone: owners.phone, email: owners.email })
            .from(owners)
            .where(eq(owners.id, ownerId));
          return row ?? null;
        },
      },
      async (tx) => {
        await tx
          .update(owners)
          .set({ phone: "08 9999 9999", email: "new@example.test" })
          .where(eq(owners.id, ownerId));
        return undefined;
      },
    );

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.action).toBe("update_owner_contact");
    expect(r.actorId).toBe("user-supervisor-1");
    expect(r.actorKind).toBe("user");
    expect(r.targetType).toBe("owner");
    expect(r.targetId).toBe(ownerId);
    expect(r.correlationId).toBe("corr-e2e-1");
    expect(r.ip).toBe("10.0.0.99");
    expect(r.userAgent).toBe("vitest/1.0");
    expect((r.before as { phone: string }).phone).toBe("08 0000 0000");
    expect((r.after as { phone: string }).phone).toBe("08 9999 9999");
  });

  it("rolls back the audit row when the mutation throws", async () => {
    const { db } = await createTestDb();
    const [t] = await db
      .insert(tenants)
      .values({
        code: "AUDRB",
        name: "Audit Rollback",
        state: "NSW",
        centerLat: -33,
        centerLng: 151,
        population: 1000,
        rateableProperties: 400,
        rateRevenue: "1000000.00",
      })
      .returning();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;

    await expect(
      withAudit(
        dbAny,
        { tenantId: t!.id, actorId: "u", actorKind: "user" },
        "noop",
        { type: "tenant", id: t!.id, read: async () => ({ k: "v" }) },
        async () => {
          throw new Error("forced rollback");
        },
      ),
    ).rejects.toThrow(/forced rollback/);

    const rows = await db.select().from(auditLog).where(eq(auditLog.tenantId, t!.id));
    expect(rows).toHaveLength(0);
  });
});
