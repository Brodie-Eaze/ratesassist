/**
 * Schema + migration smoke tests.
 *
 * Verifies that the hand-written 0001_init.sql applies cleanly under pglite
 * and that the basic insert/readback cycle works through Drizzle.
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  owners,
  properties,
  propertyOwners,
  tenants,
} from "../src/schema.js";
import { createTestDb } from "./helpers.js";

describe("schema migration", () => {
  it("applies cleanly", async () => {
    const { db } = await createTestDb();
    const result = await db.select().from(tenants);
    expect(result).toEqual([]);
  });

  it("inserts and reads back a tenant + property + owner", async () => {
    const { db } = await createTestDb();

    const [t] = await db
      .insert(tenants)
      .values({
        code: "TPS",
        name: "Shire of Tom Price",
        state: "WA",
        centerLat: -22.694,
        centerLng: 117.7935,
        population: 8200,
        rateableProperties: 3450,
        rateRevenue: "18400000.00",
      })
      .returning();
    expect(t).toBeTruthy();
    const tenantId = t!.id;

    const [p] = await db
      .insert(properties)
      .values({
        tenantId,
        assessmentNumber: "A100001",
        address: "1 Mine Rd",
        suburb: "Tom Price",
        postcode: "6751",
        state: "WA",
        landUse: "Mining",
        valuation: "1000000.00",
        annualRates: "5000.00",
        balance: "0.00",
        centroidLat: -22.7,
        centroidLng: 117.79,
        pensionerRebate: false,
        paymentArrangement: false,
        notes: ["seeded"],
      })
      .returning();
    expect(p).toBeTruthy();

    const [o] = await db
      .insert(owners)
      .values({
        tenantId,
        ownerExtId: "O-001",
        name: "Acme Mining Pty Ltd",
        abn: "11111111111",
        abnStatus: "Active",
        postalAddress: "PO Box 1, Tom Price",
        email: null,
        phone: null,
        ownerSince: "2020-01-01",
        previousOwners: [],
      })
      .returning();
    expect(o).toBeTruthy();

    await db
      .insert(propertyOwners)
      .values({ propertyId: p!.id, ownerId: o!.id, position: 0 });

    const linked = await db
      .select()
      .from(propertyOwners)
      .where(eq(propertyOwners.propertyId, p!.id));
    expect(linked).toHaveLength(1);

    const readBackProp = await db
      .select()
      .from(properties)
      .where(eq(properties.id, p!.id));
    expect(readBackProp[0]?.assessmentNumber).toBe("A100001");
    expect(readBackProp[0]?.notes).toEqual(["seeded"]);
  });
});
