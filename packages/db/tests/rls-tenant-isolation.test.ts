/**
 * DB-ENFORCED tenant isolation (Row-Level Security) — migration 0006.
 *
 * These tests prove the database itself refuses cross-tenant access, even when
 * application code forgets to filter by tenant_id. They are the regression gate
 * for the #1 structural security finding from the ship-readiness audit.
 *
 * HOW THIS IS A *REAL* TEST (and not a weakened one)
 * --------------------------------------------------
 * PostgreSQL — and pglite, which is Postgres 15 in WASM — BYPASSES RLS for
 * superusers and BYPASSRLS roles, *even under FORCE ROW LEVEL SECURITY*. pglite
 * runs the implicit `postgres` superuser, so a naive query here would see every
 * tenant's rows and the test would prove nothing. We therefore exercise the
 * policies under a dedicated non-superuser, NOBYPASSRLS role (`app_user`) via
 * `SET LOCAL ROLE` inside the same transaction that pins `app.tenant_id` — the
 * exact identity + GUC production app traffic uses. Under that role the FORCE-d
 * policies genuinely apply, so a 0-row / rejected result is real enforcement,
 * not an artefact.
 *
 * Privileged paths (seeding the fixtures) run as the superuser via Drizzle,
 * mirroring how the migration runner + scripts/seed.ts operate (they hold
 * BYPASSRLS) — see 0006's header for the full role model.
 */

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  owners,
  properties,
  sessions,
  tenants,
  users,
} from "../src/schema.js";
import { createTestDb, withTenantAsAppUser } from "./helpers.js";

interface SeededTenant {
  readonly id: string;
  readonly code: string;
}

/** Insert a tenant directly (tenants is NOT RLS-enabled). Returns its id. */
async function seedTenant(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  code: string,
): Promise<SeededTenant> {
  const [row] = await db
    .insert(tenants)
    .values({
      code,
      name: `${code} Council`,
      state: "WA",
      centerLat: -32,
      centerLng: 116,
      population: 1000,
      rateableProperties: 500,
      rateRevenue: "1000000.00",
    })
    .returning();
  return { id: row.id, code };
}

/** Seed one property for a tenant (as superuser — bypasses RLS). Returns id. */
async function seedProperty(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
  assessmentNumber: string,
): Promise<string> {
  const [row] = await db
    .insert(properties)
    .values({
      tenantId,
      assessmentNumber,
      address: `${assessmentNumber} Main St`,
      suburb: "Testville",
      postcode: "6000",
      state: "WA",
      landUse: "Residential",
      valuation: "500000.00",
      annualRates: "2000.00",
      balance: "0.00",
      centroidLat: -32,
      centroidLng: 116,
      pensionerRebate: false,
      paymentArrangement: false,
      notes: [],
    })
    .returning();
  return row.id;
}

/** Seed one owner for a tenant (as superuser). Returns id. */
async function seedOwner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
  extId: string,
): Promise<string> {
  const [row] = await db
    .insert(owners)
    .values({
      tenantId,
      ownerExtId: extId,
      name: `Owner ${extId}`,
      postalAddress: "PO Box 1, Testville",
      ownerSince: "2020-01-01",
    })
    .returning();
  return row.id;
}

/** Helper: count via raw SQL under the current role/GUC. */
async function count(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pg: any,
  table: string,
): Promise<number> {
  const r = await pg.query(`SELECT count(*)::int AS n FROM ${table}`);
  return r.rows[0].n as number;
}

describe("RLS tenant isolation — SELECT visibility", () => {
  it("tenant A sees only tenant-A rows; tenant-B rows are invisible", async () => {
    const { db, pg } = await createTestDb({ rls: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;

    const a = await seedTenant(dbAny, "AAA");
    const b = await seedTenant(dbAny, "BBB");
    await seedProperty(dbAny, a.id, "A-1");
    await seedProperty(dbAny, a.id, "A-2");
    await seedProperty(dbAny, b.id, "B-1");
    await seedOwner(dbAny, a.id, "OA-1");
    await seedOwner(dbAny, b.id, "OB-1");

    // Tenant A: sees exactly its 2 properties + 1 owner.
    const aView = await withTenantAsAppUser(pg, a.id, async () => ({
      props: await count(pg, "properties"),
      owners: await count(pg, "owners"),
    }));
    expect(aView.props).toBe(2);
    expect(aView.owners).toBe(1);

    // Tenant B: sees exactly its 1 property + 1 owner — A's rows are invisible.
    const bView = await withTenantAsAppUser(pg, b.id, async () => ({
      props: await count(pg, "properties"),
      owners: await count(pg, "owners"),
    }));
    expect(bView.props).toBe(1);
    expect(bView.owners).toBe(1);

    // A explicit WHERE for B's data, while pinned to A, still yields nothing —
    // RLS filters BEFORE the predicate, so even a "forgot the tenant filter"
    // query that names B's assessment cannot leak it.
    const leak = await withTenantAsAppUser(pg, a.id, async () => {
      const r = await pg.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM properties WHERE assessment_number = 'B-1'",
      );
      return r.rows[0]!.n;
    });
    expect(leak).toBe(0);
  });
});

describe("RLS tenant isolation — fail-closed when no GUC is set", () => {
  it("with NO app.tenant_id set, SELECT returns 0 rows across every scoped table", async () => {
    const { db, pg } = await createTestDb({ rls: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;

    const a = await seedTenant(dbAny, "AAA");
    await seedProperty(dbAny, a.id, "A-1");
    await seedOwner(dbAny, a.id, "OA-1");

    // app_user, but NO set_config('app.tenant_id', ...) at all.
    const view = await withTenantAsAppUser(pg, null, async () => ({
      props: await count(pg, "properties"),
      owners: await count(pg, "owners"),
    }));
    expect(view.props).toBe(0);
    expect(view.owners).toBe(0);
  });

  it("with an EMPTY-STRING app.tenant_id, SELECT still returns 0 rows", async () => {
    const { db, pg } = await createTestDb({ rls: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;

    const a = await seedTenant(dbAny, "AAA");
    await seedProperty(dbAny, a.id, "A-1");

    const n = await withTenantAsAppUser(pg, "", async () => count(pg, "properties"));
    expect(n).toBe(0);
  });
});

describe("RLS tenant isolation — UPDATE/DELETE cannot cross tenants", () => {
  it("tenant A UPDATE/DELETE affects 0 of tenant B's rows", async () => {
    const { db, pg } = await createTestDb({ rls: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;

    const a = await seedTenant(dbAny, "AAA");
    const b = await seedTenant(dbAny, "BBB");
    await seedProperty(dbAny, a.id, "A-1");
    await seedProperty(dbAny, b.id, "B-1");

    // Pinned to A, try to mutate ALL properties (no tenant filter in the SQL).
    // RLS restricts the row set to A's, so B's row is untouched.
    const affected = await withTenantAsAppUser(pg, a.id, async () => {
      const upd = await pg.query(
        "UPDATE properties SET balance = '999.00'",
      );
      const del = await pg.query("DELETE FROM properties WHERE balance = '0.00'");
      return { upd: upd.affectedRows ?? 0, del: del.affectedRows ?? 0 };
    });
    // Exactly 1 row (A-1) updated, then 0 deleted (A-1 now has balance 999).
    expect(affected.upd).toBe(1);

    // B's row survives untouched: still present, balance still 0.00.
    const bRow = await withTenantAsAppUser(pg, b.id, async () => {
      const r = await pg.query<{ balance: string }>(
        "SELECT balance FROM properties WHERE assessment_number = 'B-1'",
      );
      return r.rows[0]?.balance;
    });
    expect(bRow).toBe("0.00");

    // And a direct cross-tenant DELETE keyed on B's id, while pinned to A,
    // affects nothing.
    const bId = await withTenantAsAppUser(pg, b.id, async () => {
      const r = await pg.query<{ id: string }>(
        "SELECT id FROM properties WHERE assessment_number = 'B-1'",
      );
      return r.rows[0]!.id;
    });
    const crossDel = await withTenantAsAppUser(pg, a.id, async () => {
      const d = await pg.query("DELETE FROM properties WHERE id = $1", [bId]);
      return d.affectedRows ?? 0;
    });
    expect(crossDel).toBe(0);
  });
});

describe("RLS tenant isolation — INSERT WITH CHECK", () => {
  it("INSERT with a mismatched tenant_id is rejected by WITH CHECK", async () => {
    const { db, pg } = await createTestDb({ rls: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;

    const a = await seedTenant(dbAny, "AAA");
    const b = await seedTenant(dbAny, "BBB");

    // Pinned to A, attempt to INSERT a property carrying tenant B's id.
    await expect(
      withTenantAsAppUser(pg, a.id, async () => {
        await pg.query(
          `INSERT INTO properties
             (tenant_id, assessment_number, address, suburb, postcode, state,
              land_use, valuation, annual_rates, balance, centroid_lat, centroid_lng)
           VALUES ($1, 'X-1', '1 X St', 'Testville', '6000', 'WA',
              'Residential', '1.00', '1.00', '0.00', -32, 116)`,
          [b.id],
        );
      }),
    ).rejects.toThrow(/row-level security/i);

    // The matching-tenant INSERT (tenant A's own id) succeeds.
    await withTenantAsAppUser(pg, a.id, async () => {
      await pg.query(
        `INSERT INTO properties
           (tenant_id, assessment_number, address, suburb, postcode, state,
            land_use, valuation, annual_rates, balance, centroid_lat, centroid_lng)
         VALUES ($1, 'A-OK', '1 A St', 'Testville', '6000', 'WA',
            'Residential', '1.00', '1.00', '0.00', -32, 116)`,
        [a.id],
      );
    });
    const aCount = await withTenantAsAppUser(pg, a.id, async () =>
      count(pg, "properties"),
    );
    expect(aCount).toBe(1);
  });
});

describe("RLS tenant isolation — users + sessions (the tables 0001 missed)", () => {
  it("users are tenant-isolated and sessions inherit isolation via their user", async () => {
    const { db, pg } = await createTestDb({ rls: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;

    const a = await seedTenant(dbAny, "AAA");
    const b = await seedTenant(dbAny, "BBB");

    // Seed a user + session per tenant (as superuser).
    const [uA] = await dbAny
      .insert(users)
      .values({
        tenantId: a.id,
        email: "a@example.test",
        displayName: "User A",
        role: "officer",
      })
      .returning();
    const [uB] = await dbAny
      .insert(users)
      .values({
        tenantId: b.id,
        email: "b@example.test",
        displayName: "User B",
        role: "officer",
      })
      .returning();
    await dbAny.insert(sessions).values({
      userId: uA.id,
      tokenHash: "hash-a",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await dbAny.insert(sessions).values({
      userId: uB.id,
      tokenHash: "hash-b",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    // Tenant A sees its 1 user + 1 session; B's are invisible.
    const aView = await withTenantAsAppUser(pg, a.id, async () => ({
      users: await count(pg, "users"),
      sessions: await count(pg, "sessions"),
    }));
    expect(aView.users).toBe(1);
    expect(aView.sessions).toBe(1);

    // No GUC → users + sessions both fail closed.
    const noGuc = await withTenantAsAppUser(pg, null, async () => ({
      users: await count(pg, "users"),
      sessions: await count(pg, "sessions"),
    }));
    expect(noGuc.users).toBe(0);
    expect(noGuc.sessions).toBe(0);

    // Pinned to A, a DELETE of B's session (transitively scoped via users)
    // affects nothing.
    const crossDel = await withTenantAsAppUser(pg, a.id, async () => {
      const d = await pg.query(
        "DELETE FROM sessions WHERE user_id = $1",
        [uB.id],
      );
      return d.affectedRows ?? 0;
    });
    expect(crossDel).toBe(0);
  });
});

describe("RLS migration 0006 — idempotency", () => {
  it("re-applying 0006 is a no-op (policies still enforce after a second apply)", async () => {
    const { db, pg } = await createTestDb({ rls: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;

    const a = await seedTenant(dbAny, "AAA");
    const b = await seedTenant(dbAny, "BBB");
    await seedProperty(dbAny, a.id, "A-1");
    await seedProperty(dbAny, b.id, "B-1");

    // Re-apply 0006 by hand (drizzle execute of the raw file via the schema's
    // sql.raw). DROP POLICY IF EXISTS + ENABLE/FORCE make this safe.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = resolve(fileURLToPath(import.meta.url), "../../migrations");
    const m0006 = readFileSync(
      resolve(dir, "0006_rls_tenant_isolation.sql"),
      "utf8",
    );
    await pg.exec(m0006);

    // Enforcement intact: A still sees exactly 1 property; B's stays invisible.
    const aProps = await withTenantAsAppUser(pg, a.id, async () =>
      count(pg, "properties"),
    );
    expect(aProps).toBe(1);

    // And the superuser path (Drizzle, no GUC) still works for the bootstrap/
    // seed flow — superuser bypasses RLS, so it sees all rows.
    const allViaSuper = await dbAny
      .select({ id: properties.id })
      .from(properties);
    expect(allViaSuper.length).toBe(2);

    // Sanity: the GUC helper from client.ts still reports the pinned value
    // (this is the pattern the audit chain + seed rely on).
    let captured: string | null = null;
    await withTenantAsAppUser(pg, a.id, async () => {
      const r = await pg.query<{ v: string | null }>(
        "SELECT current_setting('app.tenant_id', true) AS v",
      );
      captured = r.rows[0]?.v ?? null;
    });
    expect(captured).toBe(a.id);

    // Touch `sql` so the import is used even if a future edit drops the raw
    // query above — keeps the lint/types honest.
    void sql;
  });
});
