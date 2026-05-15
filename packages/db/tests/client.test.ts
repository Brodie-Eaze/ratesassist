/**
 * Driver-selection and bootstrap tests for the package's public client.
 *
 * Validates the boot rules documented in src/client.ts:
 *   - DATABASE_URL unset → pglite
 *   - DATABASE_URL=pglite:// → pglite
 *   - DATABASE_URL=postgres://... → node-postgres pool (we don't actually
 *     connect; we just confirm the driver kind is "pg")
 */

import { describe, expect, it, afterEach, beforeEach } from "vitest";

import {
  ensureSchema,
  ensureSeeded,
  getDb,
  getDriverKind,
  resetDbForTesting,
  tenants,
  properties,
  withTenant,
} from "../src/index.js";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

describe("getDb driver selection", () => {
  beforeEach(() => {
    resetDbForTesting();
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    resetDbForTesting();
    if (ORIGINAL_DATABASE_URL !== undefined) {
      process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it("defaults to pglite when DATABASE_URL is unset", () => {
    getDb();
    expect(getDriverKind()).toBe("pglite");
  });

  it("uses pglite when DATABASE_URL is pglite://", () => {
    process.env.DATABASE_URL = "pglite://memory";
    getDb();
    expect(getDriverKind()).toBe("pglite");
  });

  it("selects node-postgres when DATABASE_URL is postgres://", () => {
    process.env.DATABASE_URL = "postgres://example:5432/ratesassist";
    getDb();
    expect(getDriverKind()).toBe("pg");
    // We never .connect() so no real network traffic happens; getDriverKind
    // is sufficient to verify selection.
  });
});

describe("ensureSchema + ensureSeeded (pglite singleton)", () => {
  beforeEach(() => {
    resetDbForTesting();
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    resetDbForTesting();
  });

  it("applies the migration idempotently", async () => {
    const db = getDb();
    await ensureSchema(db);
    // Re-running is a no-op (CREATE TABLE IF NOT EXISTS / DO $$ … duplicate_object).
    await expect(ensureSchema(db)).resolves.not.toThrow();
    const rows = await db.select({ id: tenants.id }).from(tenants);
    expect(rows).toEqual([]);
  });

  it("seeds the demo fixtures and is idempotent on the second call", async () => {
    const db = getDb();
    await ensureSchema(db);
    const firstApplied = await ensureSeeded(db);
    expect(firstApplied).toBe(true);

    const councilCount = await db
      .select({ id: tenants.id })
      .from(tenants)
      .then((r) => r.length);
    expect(councilCount).toBeGreaterThan(0);

    // Properties live behind RLS — set the GUC for one council and verify
    // that tenant's property bucket is non-empty.
    const councils = await db
      .select({ id: tenants.id, code: tenants.code })
      .from(tenants);
    // Look for the first council that actually has property fixtures.
    let totalProps = 0;
    for (const c of councils) {
      const rows = await withTenant(db, c.id, async (tx) => {
        return tx.select({ id: properties.id }).from(properties);
      });
      totalProps += rows.length;
      if (totalProps > 0) break;
    }
    expect(totalProps).toBeGreaterThan(0);

    // Second call: no-op.
    const secondApplied = await ensureSeeded(db);
    expect(secondApplied).toBe(false);

    const councilCountAfter = await db
      .select({ id: tenants.id })
      .from(tenants)
      .then((r) => r.length);
    expect(councilCountAfter).toBe(councilCount);
  }, 30_000);
});
