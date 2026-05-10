/**
 * Idempotent seed script.
 *
 * Loads demo fixtures from `@ratesassist/adapter-demo` (via dynamic import to
 * avoid making this package a hard dependency on the demo adapter) and writes
 * them into Postgres using deterministic UUID v5 ids so re-running the script
 * never produces duplicates.
 *
 * Run with:
 *   DATABASE_URL=postgres://… npm run -w @ratesassist/db seed
 */

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import {
  getDb,
  withTenant,
} from "../src/client.js";
import {
  owners,
  properties,
  propertyOwners,
  tenants,
  tenements,
  tenementProperties,
  transactions,
} from "../src/schema.js";

/** Deterministic UUIDv5 over a fixed namespace + name. */
const NAMESPACE = "5b9b9b9b-1111-4222-9333-ratesassist00";
function uuidv5(name: string): string {
  // SHA-1 over (namespace bytes || name). Set version=5, variant=10xx.
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(ns)
    .update(name)
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // variant
  const hex = hash.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

interface DemoCouncil {
  code: string;
  name: string;
  state: "WA" | "NSW" | "VIC" | "QLD" | "SA" | "TAS" | "ACT" | "NT";
  population: number;
  rateableProperties: number;
  rateRevenue: number;
  centerLat: number;
  centerLng: number;
}

interface DemoOwner {
  ownerId: string;
  name: string;
  abn: string | null;
  abnCheck: { kind: "unchecked" } | { kind: "checked"; status: "Active" | "Cancelled" | "Suspended"; checkedAt: string };
  postalAddress: string;
  email: string | null;
  phone: string | null;
  ownerSince: string;
  previousOwners: { name: string; period: string }[];
}

interface DemoProperty {
  assessmentNumber: string;
  council: string;
  address: string;
  suburb: string;
  postcode: string;
  state: DemoCouncil["state"];
  landUse:
    | "Residential"
    | "Commercial"
    | "Industrial"
    | "Rural"
    | "Vacant"
    | "Mining";
  valuation: number;
  annualRates: number;
  balance: number;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
  paymentMethod: "Direct Debit" | "BPAY" | "Counter" | "Mail" | null;
  pensionerRebate: boolean;
  paymentArrangement: boolean;
  ownerIds: string[];
  notes: string[];
  lat: number;
  lng: number;
  parcel?: [number, number][];
}

async function loadFixtures(): Promise<{
  councils: DemoCouncil[];
  owners: DemoOwner[];
  properties: DemoProperty[];
  tenements: unknown[];
  transactions: Record<string, unknown[]>;
}> {
  // Dynamic import keeps the demo adapter as an optional dev-time fixture
  // source rather than a runtime dep of @ratesassist/db.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await import(
    /* @vite-ignore */ "@ratesassist/adapter-demo/data"
  ).catch(() => null);
  if (!data) {
    throw new Error(
      "[seed] Could not import @ratesassist/adapter-demo/data — build the demo adapter first.",
    );
  }
  return {
    councils: data.COUNCILS as DemoCouncil[],
    owners: (data.OWNERS ?? data.SEED_OWNERS ?? []) as DemoOwner[],
    properties: (data.PROPERTIES ?? data.SEED_PROPERTIES ?? []) as DemoProperty[],
    tenements: (data.TENEMENTS ?? []) as unknown[],
    transactions: (data.TRANSACTIONS ?? {}) as Record<string, unknown[]>,
  };
}

async function main(): Promise<void> {
  const db = getDb();
  const fx = await loadFixtures();

  // Tenants are NOT under RLS; insert directly outside withTenant.
  for (const c of fx.councils) {
    const id = uuidv5(`tenant:${c.code}`);
    await db
      .insert(tenants)
      .values({
        id,
        code: c.code,
        name: c.name,
        state: c.state,
        centerLat: c.centerLat,
        centerLng: c.centerLng,
        population: c.population,
        rateableProperties: c.rateableProperties,
        rateRevenue: String(c.rateRevenue),
      })
      .onConflictDoNothing();
  }

  // Group properties by council code.
  const byCouncil = new Map<string, DemoProperty[]>();
  for (const p of fx.properties) {
    const arr = byCouncil.get(p.council) ?? [];
    arr.push(p);
    byCouncil.set(p.council, arr);
  }

  for (const [code, props] of byCouncil) {
    const tenantId = uuidv5(`tenant:${code}`);
    await withTenant(db, tenantId, async (tx) => {
      // Owners — seed any owner referenced by a property in this tenant.
      const referencedOwnerIds = new Set<string>(
        props.flatMap((p) => p.ownerIds),
      );
      const ownerLookup = new Map(fx.owners.map((o) => [o.ownerId, o]));
      for (const ownerExtId of referencedOwnerIds) {
        const o = ownerLookup.get(ownerExtId);
        if (!o) continue;
        const id = uuidv5(`owner:${code}:${ownerExtId}`);
        await tx
          .insert(owners)
          .values({
            id,
            tenantId,
            ownerExtId,
            name: o.name,
            abn: o.abn,
            abnStatus:
              o.abnCheck.kind === "checked" ? o.abnCheck.status : null,
            abnCheckedAt:
              o.abnCheck.kind === "checked"
                ? new Date(o.abnCheck.checkedAt)
                : null,
            postalAddress: o.postalAddress,
            email: o.email,
            phone: o.phone,
            ownerSince: o.ownerSince,
            previousOwners: o.previousOwners,
          })
          .onConflictDoNothing();
      }

      for (const p of props) {
        const id = uuidv5(`property:${code}:${p.assessmentNumber}`);
        await tx
          .insert(properties)
          .values({
            id,
            tenantId,
            assessmentNumber: p.assessmentNumber,
            address: p.address,
            suburb: p.suburb,
            postcode: p.postcode,
            state: p.state,
            landUse: p.landUse,
            valuation: String(p.valuation),
            annualRates: String(p.annualRates),
            balance: String(p.balance),
            lastPaymentDate: p.lastPaymentDate
              ? new Date(p.lastPaymentDate)
              : null,
            lastPaymentAmount:
              p.lastPaymentAmount != null
                ? String(p.lastPaymentAmount)
                : null,
            paymentMethod: p.paymentMethod,
            pensionerRebate: p.pensionerRebate,
            paymentArrangement: p.paymentArrangement,
            notes: [...p.notes],
            centroidLat: p.lat,
            centroidLng: p.lng,
            parcel: p.parcel
              ? {
                  type: "Polygon",
                  coordinates: [p.parcel.map(([lat, lng]) => [lng, lat])],
                }
              : null,
          })
          .onConflictDoNothing();

        for (let i = 0; i < p.ownerIds.length; i++) {
          const ownerExtId = p.ownerIds[i]!;
          if (!fx.owners.some((o) => o.ownerId === ownerExtId)) continue;
          const ownerId = uuidv5(`owner:${code}:${ownerExtId}`);
          await tx
            .insert(propertyOwners)
            .values({ propertyId: id, ownerId, position: i })
            .onConflictDoNothing();
        }

        // Transactions for this property.
        const txList = fx.transactions[p.assessmentNumber] ?? [];
        for (const t of txList as Array<{
          date: string;
          type:
            | "Rates Levy"
            | "Payment"
            | "Adjustment"
            | "Penalty Interest";
          amount: number;
          reference: string;
          balance: number;
        }>) {
          await tx.insert(transactions).values({
            tenantId,
            propertyId: id,
            date: new Date(t.date),
            type: t.type,
            amount: String(t.amount),
            reference: t.reference,
            runningBalance: String(t.balance),
          });
        }
      }
    });
  }

  // Tenements: not tenant-scoped in the contract — seed without GUC.
  for (const tn of fx.tenements as Array<{
    tenementId: string;
    type: "M" | "E" | "P" | "G" | "L";
    status: "Live" | "Pending" | "Surrendered" | "Cancelled";
    holder: string;
    holderAbn: string | null;
    commodity: string[];
    grantedDate: string;
    expiryDate: string;
    areaHectares: number;
    intersectsAssessmentNumbers: string[];
    isProducing: boolean;
    lastWorkProgramYear: number | null;
    polygon: [number, number][];
  }>) {
    const id = uuidv5(`tenement:${tn.tenementId}`);
    await db
      .insert(tenements)
      .values({
        id,
        tenementId: tn.tenementId,
        type: tn.type,
        status: tn.status,
        holder: tn.holder,
        holderAbn: tn.holderAbn,
        commodity: [...tn.commodity],
        grantedDate: tn.grantedDate,
        expiryDate: tn.expiryDate,
        areaHectares: tn.areaHectares,
        intersectsAssessmentNumbers: [...tn.intersectsAssessmentNumbers],
        isProducing: tn.isProducing,
        lastWorkProgramYear: tn.lastWorkProgramYear,
        polygon: {
          type: "Polygon",
          coordinates: [tn.polygon.map(([lat, lng]) => [lng, lat])],
        },
      })
      .onConflictDoNothing();
  }

  await db.execute(sql`select 1`);
  console.log("[seed] complete.");
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
