/**
 * findCandidateAssessmentsBySql + hasAnyCandidatesBySql — unit tests.
 *
 * Exercises the SQL pre-filter (E3) that scopes the in-memory evaluation
 * context to only the properties that MIGHT fire at least one recovery
 * signal for a given tenant.
 *
 * What we prove:
 *   - Empty tenant → empty set.
 *   - Rural land use → included.
 *   - Vacant land use → included.
 *   - Residential with no rebate and no tenement → excluded.
 *   - Residential with pensioner_rebate=true → included.
 *   - Residential with a Live tenement overlay → included.
 *   - Residential with only a non-Live tenement → excluded.
 *   - Soft-deleted properties (deleted_at set) are excluded even if Rural.
 *   - A Rural+tenement property appears exactly once (DISTINCT).
 *   - Multi-tenant isolation — only returns rows for the specified tenantId.
 *   - hasAnyCandidatesBySql returns false / true correctly.
 *
 * Runs against a pglite-backed Drizzle instance (no real Postgres required).
 * Each test resets to a virgin DB to prevent cross-test contamination.
 */

import { describe, expect, it, beforeEach } from "vitest";

process.env["RA_USE_DB"] = "true";

import { findCandidateAssessmentsBySql, hasAnyCandidatesBySql } from "../lib/mismatchSql";
const dbPkg = await import("@ratesassist/db");
const { getWebDb, resetWebDbForTesting } = await import("../lib/db");

// ─── shared types ──────────────────────────────────────────────────────────────

type Db = import("@ratesassist/db").Db;

// ─── helpers ───────────────────────────────────────────────────────────────────

/** Minimal property insert — only required non-defaulted fields. */
async function insertProperty(
  db: Db,
  tenantId: string,
  opts: {
    assessmentNumber: string;
    landUse: "Rural" | "Vacant" | "Residential" | "Commercial" | "Industrial" | "Mining";
    pensionerRebate?: boolean;
    deletedAt?: Date;
  },
): Promise<string> {
  const [p] = await db
    .insert(dbPkg.properties)
    .values({
      tenantId,
      assessmentNumber: opts.assessmentNumber,
      address: "1 Test St",
      suburb: "Testville",
      postcode: "6000",
      state: "WA",
      landUse: opts.landUse,
      valuation: "100000.00",
      annualRates: "1000.00",
      balance: "0.00",
      centroidLat: -32.0,
      centroidLng: 116.0,
      pensionerRebate: opts.pensionerRebate ?? false,
      ...(opts.deletedAt !== undefined ? { deletedAt: opts.deletedAt } : {}),
    })
    .returning();
  return p!.id;
}

/** Minimal tenement insert. */
async function insertTenement(
  db: Db,
  opts: {
    tenementId: string;
    status: "Live" | "Pending" | "Surrendered" | "Cancelled";
  },
): Promise<string> {
  const [t] = await db
    .insert(dbPkg.tenements)
    .values({
      tenementId: opts.tenementId,
      type: "M",
      status: opts.status,
      holder: "Test Mining Co",
      grantedDate: "2020-01-01",
      expiryDate: "2030-01-01",
      areaHectares: 100.0,
      polygon: { type: "Polygon", coordinates: [[[116, -32], [116.1, -32], [116.1, -32.1], [116, -32.1], [116, -32]]] },
    })
    .returning();
  return t!.id;
}

/** Link a tenement to a property via the join table. */
async function linkTenementProperty(
  db: Db,
  tenementId: string,
  propertyId: string,
): Promise<void> {
  await db
    .insert(dbPkg.tenementProperties)
    .values({ tenementId, propertyId });
}

/** Insert a test tenant and return its UUID. */
async function insertTestTenant(db: Db, code: string): Promise<string> {
  const [t] = await db
    .insert(dbPkg.tenants)
    .values({
      code,
      name: `${code} Test Council`,
      state: "WA",
      centerLat: -32.0,
      centerLng: 116.0,
      population: 100,
      rateableProperties: 50,
      rateRevenue: "500000.00",
    })
    .returning();
  return t!.id;
}

// ─── findCandidateAssessmentsBySql ─────────────────────────────────────────────

describe("findCandidateAssessmentsBySql", () => {
  let db: Db;
  let tenantId: string;

  beforeEach(async () => {
    // Fresh pglite DB + schema + demo seed for each test.
    dbPkg.resetDbForTesting();
    resetWebDbForTesting();
    db = await getWebDb();
    // Use a code not in the demo seed so our tenant is isolated.
    tenantId = await insertTestTenant(db, "MSQL-A");
  });

  it("returns empty set for a tenant with no properties", async () => {
    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.size).toBe(0);
  });

  it("includes Rural properties", async () => {
    await insertProperty(db, tenantId, { assessmentNumber: "MSQL-A-R001", landUse: "Rural" });
    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.has("MSQL-A-R001")).toBe(true);
  });

  it("includes Vacant properties", async () => {
    await insertProperty(db, tenantId, { assessmentNumber: "MSQL-A-V001", landUse: "Vacant" });
    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.has("MSQL-A-V001")).toBe(true);
  });

  it("excludes Residential properties with no rebate and no tenement overlay", async () => {
    await insertProperty(db, tenantId, { assessmentNumber: "MSQL-A-RS001", landUse: "Residential" });
    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.has("MSQL-A-RS001")).toBe(false);
  });

  it("excludes Commercial properties with no rebate and no tenement overlay", async () => {
    await insertProperty(db, tenantId, { assessmentNumber: "MSQL-A-CM001", landUse: "Commercial" });
    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.has("MSQL-A-CM001")).toBe(false);
  });

  it("includes Residential properties with pensioner_rebate=true", async () => {
    await insertProperty(db, tenantId, {
      assessmentNumber: "MSQL-A-PB001",
      landUse: "Residential",
      pensionerRebate: true,
    });
    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.has("MSQL-A-PB001")).toBe(true);
  });

  it("includes Residential properties with a Live tenement overlay", async () => {
    const propId = await insertProperty(db, tenantId, {
      assessmentNumber: "MSQL-A-TM001",
      landUse: "Residential",
    });
    const tenId = await insertTenement(db, { tenementId: "M11001", status: "Live" });
    await linkTenementProperty(db, tenId, propId);
    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.has("MSQL-A-TM001")).toBe(true);
  });

  it("excludes Residential properties with only a non-Live (Surrendered) tenement", async () => {
    const propId = await insertProperty(db, tenantId, {
      assessmentNumber: "MSQL-A-SU001",
      landUse: "Residential",
    });
    const tenId = await insertTenement(db, { tenementId: "M11002", status: "Surrendered" });
    await linkTenementProperty(db, tenId, propId);
    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.has("MSQL-A-SU001")).toBe(false);
  });

  it("excludes Residential properties with only a non-Live (Cancelled) tenement", async () => {
    const propId = await insertProperty(db, tenantId, {
      assessmentNumber: "MSQL-A-CX001",
      landUse: "Residential",
    });
    const tenId = await insertTenement(db, { tenementId: "M11003", status: "Cancelled" });
    await linkTenementProperty(db, tenId, propId);
    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.has("MSQL-A-CX001")).toBe(false);
  });

  it("excludes soft-deleted properties (deleted_at set) even when Rural", async () => {
    await insertProperty(db, tenantId, {
      assessmentNumber: "MSQL-A-DEL001",
      landUse: "Rural",
      deletedAt: new Date(),
    });
    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.has("MSQL-A-DEL001")).toBe(false);
  });

  it("returns each assessment number exactly once when multiple conditions are true (DISTINCT)", async () => {
    // A Rural property with a Live tenement matches both condition (a) and (c).
    const propId = await insertProperty(db, tenantId, {
      assessmentNumber: "MSQL-A-DUP001",
      landUse: "Rural",
    });
    const tenId = await insertTenement(db, { tenementId: "M11004", status: "Live" });
    await linkTenementProperty(db, tenId, propId);
    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.has("MSQL-A-DUP001")).toBe(true);
    // ReadonlySet guarantees uniqueness; verify the count is exactly 1
    const matches = [...result].filter((an) => an === "MSQL-A-DUP001");
    expect(matches).toHaveLength(1);
  });

  it("scopes results to the specified tenantId — no cross-tenant leakage", async () => {
    // Insert a Rural property under our test tenant.
    await insertProperty(db, tenantId, { assessmentNumber: "MSQL-A-OWN001", landUse: "Rural" });

    // The demo seed (TPS, MRC etc.) also contains Rural properties under
    // different tenant UUIDs. Verify that ONLY our assessment numbers appear.
    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.size).toBeGreaterThan(0);
    for (const an of result) {
      expect(an.startsWith("MSQL-A-")).toBe(true);
    }
  });

  it("returns all three qualifying condition types in a single call", async () => {
    // (a) Rural
    await insertProperty(db, tenantId, { assessmentNumber: "MSQL-A-MX001", landUse: "Rural" });
    // (b) Pensioner rebate
    await insertProperty(db, tenantId, {
      assessmentNumber: "MSQL-A-MX002",
      landUse: "Residential",
      pensionerRebate: true,
    });
    // (c) Live tenement on a residential property
    const propId = await insertProperty(db, tenantId, {
      assessmentNumber: "MSQL-A-MX003",
      landUse: "Residential",
    });
    const tenId = await insertTenement(db, { tenementId: "M11005", status: "Live" });
    await linkTenementProperty(db, tenId, propId);
    // (excluded) plain residential with no special conditions
    await insertProperty(db, tenantId, { assessmentNumber: "MSQL-A-MX004", landUse: "Residential" });

    const result = await findCandidateAssessmentsBySql(db, tenantId);
    expect(result.has("MSQL-A-MX001")).toBe(true);
    expect(result.has("MSQL-A-MX002")).toBe(true);
    expect(result.has("MSQL-A-MX003")).toBe(true);
    expect(result.has("MSQL-A-MX004")).toBe(false);
  });
});

// ─── hasAnyCandidatesBySql ─────────────────────────────────────────────────────

describe("hasAnyCandidatesBySql", () => {
  let db: Db;
  let tenantId: string;

  beforeEach(async () => {
    dbPkg.resetDbForTesting();
    resetWebDbForTesting();
    db = await getWebDb();
    tenantId = await insertTestTenant(db, "MSQL-B");
  });

  it("returns false for an empty tenant", async () => {
    expect(await hasAnyCandidatesBySql(db, tenantId)).toBe(false);
  });

  it("returns false when only non-qualifying (Residential, no rebate, no tenement) properties exist", async () => {
    await insertProperty(db, tenantId, { assessmentNumber: "MSQL-B-RS001", landUse: "Residential" });
    expect(await hasAnyCandidatesBySql(db, tenantId)).toBe(false);
  });

  it("returns true when at least one Rural property exists", async () => {
    await insertProperty(db, tenantId, { assessmentNumber: "MSQL-B-R001", landUse: "Rural" });
    expect(await hasAnyCandidatesBySql(db, tenantId)).toBe(true);
  });

  it("returns true when at least one Vacant property exists", async () => {
    await insertProperty(db, tenantId, { assessmentNumber: "MSQL-B-V001", landUse: "Vacant" });
    expect(await hasAnyCandidatesBySql(db, tenantId)).toBe(true);
  });

  it("returns true when a Residential property has pensioner_rebate=true", async () => {
    await insertProperty(db, tenantId, {
      assessmentNumber: "MSQL-B-PB001",
      landUse: "Residential",
      pensionerRebate: true,
    });
    expect(await hasAnyCandidatesBySql(db, tenantId)).toBe(true);
  });

  it("returns true when a Residential property has a Live tenement", async () => {
    const propId = await insertProperty(db, tenantId, {
      assessmentNumber: "MSQL-B-TM001",
      landUse: "Residential",
    });
    const tenId = await insertTenement(db, { tenementId: "M22001", status: "Live" });
    await linkTenementProperty(db, tenId, propId);
    expect(await hasAnyCandidatesBySql(db, tenantId)).toBe(true);
  });

  it("is not affected by qualifying properties of OTHER tenants", async () => {
    // The demo seed has Rural properties under TPS/MRC tenants. They must
    // NOT cause hasAnyCandidatesBySql to return true for OUR tenant (which has none).
    expect(await hasAnyCandidatesBySql(db, tenantId)).toBe(false);
  });
});
