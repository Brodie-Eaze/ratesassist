/**
 * Demo dataset barrel + in-memory store.
 *
 * Re-exports the seed datasets and provides a {@link DataStore} that owns
 * the mutable state surface for write tools. Production adapters replace
 * this store with a Postgres-backed implementation (see
 * `packages/db` in `PRODUCTION-PLAN.md` Phase 2). The shape and
 * semantics — copy-on-write, snapshot-style reads — are preserved so the
 * handler code is unchanged when the storage layer swaps.
 */

import type {
  Council,
  Encumbrance,
  Owner,
  Pin,
  Property,
  Tenement,
  TitleSourceFreshness,
  Transaction,
  WaterCorpEligibilityStatus,
} from "@ratesassist/contract";

import { COUNCILS } from "./councils.js";
import { OWNERS as SEED_OWNERS } from "./owners.js";
import { PROPERTIES as SEED_PROPERTIES } from "./properties.js";
import { TENEMENTS } from "./tenements.js";
import { TRANSACTIONS } from "./transactions.js";

// ===== VEN + CT + Concession feature: new entity types =====

/**
 * Council-adopted rate schedule entry — one row per (financialYear, rateCode).
 *
 * The council uploads its annual schedule of differential rates via the
 * `import_rate_schedule` tool. The recovery engine joins on `rateCode`
 * (council's internal code) plus `appliesToLanduse` to materialise the
 * "should-be" annual figure used in the uplift calculation.
 */
export type RateScheduleEntry = {
  readonly financialYear: string;
  readonly rateCode: string;
  readonly appliesToLanduse:
    | "Residential"
    | "Commercial"
    | "Industrial"
    | "Vacant"
    | "Rural"
    | "Pastoral"
    | "Mining"
    | "MiningOther";
  readonly rateInDollar: number;
  readonly minimumPayment: number;
  readonly basis: "GRV" | "UV";
};

/**
 * Aggregated Landgate snapshot for one VEN. One record per VEN; pins[]
 * carries N rows. Encumbrances aggregate similarly.
 */
export type LandgateRecord = {
  /** Council that uploaded this snapshot. */
  readonly councilCode: string;
  readonly ven: string;
  readonly assessmentNumber?: string;
  readonly ctVolume?: string;
  readonly ctFolio?: string;
  readonly ctIssuedDate?: string;
  readonly proprietorName?: string;
  readonly proprietorPostalAddress?: string;
  readonly pins: ReadonlyArray<Pin>;
  readonly encumbrances: ReadonlyArray<Encumbrance>;
  readonly strataParentCt?: { readonly volume: string; readonly folio: string };
  readonly source: TitleSourceFreshness;
};

/**
 * Water Corporation eligibility row — one per customer/card.
 */
export type WaterCorpEligibilityRecord = {
  readonly councilCode: string;
  readonly customerId: string;
  readonly cardNumber?: string;
  readonly holderName: string;
  readonly eligibilityStatus: WaterCorpEligibilityStatus;
  readonly validFrom: string;
  readonly validTo?: string;
  readonly cancellationReason?: string;
  readonly cancellationDate?: string;
  readonly propertyAddressOnFile?: string;
  readonly retrievedAt: string;
};

/** Strata-conversion state-machine vertices (per spec Section 7). */
export type StrataLifecycleState =
  | "parent_strata_detected"
  | "strata_plan_uploaded"
  | "children_previewed"
  | "children_imported"
  | "parent_superseded"
  | "withdrawn";

/** Strata-conversion lifecycle record stored per parent assessment. */
export type StrataLifecycle = {
  readonly parentAssessmentNumber: string;
  readonly state: StrataLifecycleState;
  /** Audit-trail of every transition; append-only. */
  readonly history: ReadonlyArray<{
    readonly state: StrataLifecycleState;
    readonly at: string;
    readonly reason?: string;
  }>;
  /** Captured at the children_previewed transition; consumed at import. */
  readonly childCts: ReadonlyArray<{
    readonly volume: string;
    readonly folio: string;
    readonly ven?: string;
    readonly address?: string;
    /** Populated after children_imported; assessment number of the created child. */
    readonly childAssessmentNumber?: string;
  }>;
};

export { COUNCILS } from "./councils.js";
export { OWNERS } from "./owners.js";
export { PROPERTIES } from "./properties.js";
export { TENEMENTS } from "./tenements.js";
export { TRANSACTIONS } from "./transactions.js";

/**
 * Tombstone written into the required-string PII fields of an owner record by
 * {@link DataStore.eraseOwner} during a right-to-be-forgotten action. A
 * distinctive sentinel (not an empty string) so it is unambiguous in the UI,
 * in exports, and in tests that assert the original value is gone. Shared with
 * the DB-side erasure (`apps/web/lib/privacy-erasure.ts`) so both stores
 * de-identify to byte-identical values.
 */
export const ERASURE_NAME_TOMBSTONE = "[erased]";
export const ERASURE_ADDRESS_TOMBSTONE = "[erased]";

/**
 * In-memory store. The store starts from the frozen seeds but allows
 * controlled mutations through {@link replaceOwner} and {@link addNoteToProperty}
 * — the only two mutations any handler in this adapter is permitted to make.
 *
 * Reads return references to immutable arrays/records; consumers MUST treat
 * them as readonly. The store never returns a mutable view of its state.
 */
export class DataStore {
  /** Defensive copy of the property seed, mutable internally only. */
  private properties: Property[];
  /** Defensive copy of the owner seed, mutable internally only. */
  private owners: Owner[];
  /** Defensive copy of the council seed, mutable internally for add_council. */
  private councils: Council[];

  /**
   * Rate schedules keyed by `${councilCode}::${financialYear}::${rateCode}`.
   * Imported via `import_rate_schedule`. The compound key keeps the upsert
   * idempotent across re-imports of identical content.
   */
  private rateSchedules: Map<string, RateScheduleEntry>;

  /**
   * Landgate snapshots keyed by `${councilCode}::${ven}`. Imported via
   * `import_landgate_title_data`.
   */
  private landgateRecords: Map<string, LandgateRecord>;

  /**
   * Water Corp eligibility rows keyed by `${councilCode}::${cardNumber||customerId}`.
   * Imported via `import_wc_eligibility`.
   */
  private wcEligibility: Map<string, WaterCorpEligibilityRecord>;

  /**
   * Strata-conversion lifecycle records keyed by parentAssessmentNumber.
   * Driven by `request_strata_conversion`.
   */
  private strataLifecycles: Map<string, StrataLifecycle>;

  /**
   * Construct a store from the seeded data. Each instance is independent,
   * so tests can construct fresh stores without leakage. Production wiring
   * uses a single process-wide instance.
   */
  public constructor() {
    this.properties = [...SEED_PROPERTIES];
    this.owners = [...SEED_OWNERS];
    this.councils = [...COUNCILS];
    this.rateSchedules = new Map();
    this.landgateRecords = new Map();
    this.wcEligibility = new Map();
    this.strataLifecycles = new Map();
  }

  /** All councils (tenants) advertised by this adapter. */
  public listCouncils(): readonly Council[] {
    return this.councils;
  }

  /** Look up a council by code. Returns `undefined` when unknown. */
  public getCouncil(code: string): Council | undefined {
    return this.councils.find((c) => c.code === code);
  }

  /**
   * Append a new council to the in-memory tenant registry. Returns the
   * stored record on success, or `undefined` if a council with the same
   * code already exists.
   */
  public addCouncil(council: Council): Council | undefined {
    if (this.councils.some((c) => c.code === council.code)) return undefined;
    this.councils = [...this.councils, council];
    return council;
  }

  /** All properties across all tenants. Optionally filtered by council code. */
  public listProperties(councilCode?: string): readonly Property[] {
    if (councilCode === undefined) return this.properties;
    return this.properties.filter((p) => p.council === councilCode);
  }

  /** Snapshot copy of the property list — used to seed the EvaluationContext. */
  public snapshotProperties(): readonly Property[] {
    return [...this.properties];
  }

  /** Get one property by assessment number. */
  public getProperty(assessmentNumber: string): Property | undefined {
    return this.properties.find(
      (p) => p.assessmentNumber === assessmentNumber,
    );
  }

  /**
   * Free-text search across address, suburb, postcode and assessment number.
   * Case-insensitive substring match. Empty queries are caller-responsibility
   * (the schema validates non-empty input upstream).
   *
   * `councilCode` restricts results to one tenant — the web layer injects the
   * caller's tenant for non-admins so a council clerk can't enumerate another
   * council's portfolio via search. Omitted → all councils (admin path).
   */
  public searchProperties(
    query: string,
    councilCode?: string,
  ): readonly Property[] {
    const q = query.toLowerCase();
    return this.properties.filter(
      (p) =>
        (councilCode === undefined || p.council === councilCode) &&
        (p.assessmentNumber.toLowerCase().includes(q) ||
          p.address.toLowerCase().includes(q) ||
          p.suburb.toLowerCase().includes(q) ||
          p.postcode.includes(q)),
    );
  }

  /**
   * Search by owner name (partial, case-insensitive), optionally restricted
   * to a single suburb (exact match, case-insensitive).
   *
   * `councilCode` restricts results to one tenant — see `searchProperties`.
   * Note this scopes the returned PROPERTIES, not the owner-name match: a
   * shared owner is still found, but only their parcels in the caller's
   * council are returned.
   */
  public searchByOwner(
    name: string,
    suburb?: string,
    councilCode?: string,
  ): readonly Property[] {
    const q = name.toLowerCase();
    const matchedIds = new Set(
      this.owners
        .filter((o) => o.name.toLowerCase().includes(q))
        .map((o) => o.ownerId),
    );
    if (matchedIds.size === 0) return [];
    return this.properties.filter((p) => {
      if (councilCode !== undefined && p.council !== councilCode) return false;
      if (!p.ownerIds.some((id) => matchedIds.has(id))) return false;
      if (suburb === undefined) return true;
      return p.suburb.toLowerCase() === suburb.toLowerCase();
    });
  }

  /** All overdue properties (positive outstanding balance). */
  public listOverdue(councilCode?: string): readonly Property[] {
    return this.listProperties(councilCode).filter((p) => p.balance > 0);
  }

  /** All owners. */
  public listOwners(): readonly Owner[] {
    return this.owners;
  }

  /** Snapshot owners as a Map keyed by ownerId for the recovery EvaluationContext. */
  public snapshotOwnersById(): ReadonlyMap<string, Owner> {
    return new Map(this.owners.map((o) => [o.ownerId, o]));
  }

  /** Get one owner by ID. */
  public getOwner(ownerId: string): Owner | undefined {
    return this.owners.find((o) => o.ownerId === ownerId);
  }

  /** Resolve all owners listed on a property. Order matches `property.ownerIds`. */
  public ownersForProperty(p: Property): readonly Owner[] {
    return p.ownerIds
      .map((id) => this.owners.find((o) => o.ownerId === id))
      .filter((o): o is Owner => o !== undefined);
  }

  /** Transactions for one property. Empty array when none on file. */
  public getTransactions(assessmentNumber: string): readonly Transaction[] {
    return TRANSACTIONS[assessmentNumber] ?? [];
  }

  /** All live tenements that intersect the given assessment. */
  public tenementsForAssessment(
    assessmentNumber: string,
  ): readonly Tenement[] {
    return TENEMENTS.filter(
      (t) =>
        t.status === "Live" &&
        t.intersectsAssessmentNumbers.includes(assessmentNumber),
    );
  }

  /**
   * Snapshot tenements indexed by assessment number for the recovery
   * EvaluationContext. Includes only `Live` tenements (matches the
   * recovery engine's per-property branches).
   */
  public snapshotTenementsByAssessment(): ReadonlyMap<
    string,
    readonly Tenement[]
  > {
    const out = new Map<string, Tenement[]>();
    for (const t of TENEMENTS) {
      if (t.status !== "Live") continue;
      for (const an of t.intersectsAssessmentNumbers) {
        const list = out.get(an);
        if (list === undefined) {
          out.set(an, [t]);
        } else {
          list.push(t);
        }
      }
    }
    return new Map([...out.entries()].map(([k, v]) => [k, [...v]]));
  }

  /**
   * Replace an owner record with a new immutable record. Returns the new
   * record. No-op if the ownerId is not found.
   */
  public replaceOwner(updated: Owner): Owner | undefined {
    const idx = this.owners.findIndex((o) => o.ownerId === updated.ownerId);
    if (idx === -1) return undefined;
    const next: Owner[] = [...this.owners];
    next[idx] = updated;
    this.owners = next;
    return updated;
  }

  /**
   * Crypto-shred / tombstone the personal information on one owner record in
   * place, preserving the non-PII structural linkage (`ownerId`, `ownerSince`,
   * and — implicitly — every property's `ownerIds` reference into this owner).
   *
   * This is the in-memory half of the right-to-be-forgotten (RTBF) flow under
   * the *Privacy Act 1988 (Cth)* APP 11.2 (destroy or de-identify personal
   * information no longer needed). The DB half lives in
   * `apps/web/lib/privacy-erasure.ts`.
   *
   * Fields cleared:
   *   - `name`            → {@link ERASURE_NAME_TOMBSTONE} (the field is a
   *                         required string and is a join/identity surface, so
   *                         we de-identify rather than drop it).
   *   - `email`           → null
   *   - `phone`           → null
   *   - `postalAddress`   → {@link ERASURE_ADDRESS_TOMBSTONE} (required string).
   *   - `previousOwners`  → [] (prior-proprietor names are themselves PII).
   *
   * Deliberately PRESERVED: `ownerId` (structural key — zeroing it would orphan
   * every property), `ownerSince` (a non-identifying tenure date the rates roll
   * needs), and `abn` / `abnCheck` (an ABN is a public business identifier, not
   * personal information about a natural person; callers that also need the ABN
   * shredded — e.g. a sole-trader subject — pass a wider field set at the
   * service layer, this store applies the contact-PII minimum).
   *
   * IDEMPOTENT: re-erasing an already-tombstoned owner produces the identical
   * record and reports `changed: false`, so a retried RTBF request is a clean
   * no-op (and the service can suppress a duplicate audit row).
   *
   * Returns `{ before, after, changed }`, or `undefined` when the ownerId is
   * unknown so the caller can decide whether that is a 404 or a benign skip.
   */
  public eraseOwner(
    ownerId: string,
  ):
    | { readonly before: Owner; readonly after: Owner; readonly changed: boolean }
    | undefined {
    const idx = this.owners.findIndex((o) => o.ownerId === ownerId);
    if (idx === -1) return undefined;
    const before = this.owners[idx];
    if (before === undefined) return undefined;
    const after: Owner = {
      ...before,
      name: ERASURE_NAME_TOMBSTONE,
      email: null,
      phone: null,
      postalAddress: ERASURE_ADDRESS_TOMBSTONE,
      previousOwners: [],
    };
    const changed =
      before.name !== after.name ||
      before.email !== after.email ||
      before.phone !== after.phone ||
      before.postalAddress !== after.postalAddress ||
      before.previousOwners.length !== 0;
    if (!changed) {
      // Already a tombstone — leave the array reference untouched.
      return { before, after: before, changed: false };
    }
    const next: Owner[] = [...this.owners];
    next[idx] = after;
    this.owners = next;
    return { before, after, changed: true };
  }

  /**
   * Replace every property belonging to `councilCode` with the supplied set.
   * Used by the rating-roll import (`mergeStrategy=replace`). Returns counts
   * of removed + inserted properties.
   */
  public replaceProperties(
    councilCode: string,
    incoming: readonly Property[],
  ): { readonly removed: number; readonly inserted: number } {
    const before = this.properties.filter((p) => p.council === councilCode).length;
    const keep = this.properties.filter((p) => p.council !== councilCode);
    this.properties = [...keep, ...incoming];
    return { removed: before, inserted: incoming.length };
  }

  /**
   * Upsert properties keyed by `assessmentNumber`. Existing properties under
   * the same council are updated in place; new rows are appended. Properties
   * belonging to other councils are untouched.
   */
  public upsertProperties(
    councilCode: string,
    incoming: readonly Property[],
  ): { readonly inserted: number; readonly updated: number } {
    const byAssessment = new Map(
      this.properties.map((p) => [p.assessmentNumber, p] as const),
    );
    let inserted = 0;
    let updated = 0;
    for (const row of incoming) {
      if (row.council !== councilCode) continue;
      if (byAssessment.has(row.assessmentNumber)) {
        byAssessment.set(row.assessmentNumber, row);
        updated += 1;
      } else {
        byAssessment.set(row.assessmentNumber, row);
        inserted += 1;
      }
    }
    this.properties = [...byAssessment.values()];
    return { inserted, updated };
  }

  /**
   * Upsert owner records. Existing owners (matched by `ownerId`) are
   * replaced; new ones appended. Returns the count actually inserted.
   */
  public upsertOwners(
    incoming: readonly Owner[],
  ): { readonly inserted: number; readonly updated: number } {
    const byId = new Map(this.owners.map((o) => [o.ownerId, o] as const));
    let inserted = 0;
    let updated = 0;
    for (const o of incoming) {
      if (byId.has(o.ownerId)) {
        byId.set(o.ownerId, o);
        updated += 1;
      } else {
        byId.set(o.ownerId, o);
        inserted += 1;
      }
    }
    this.owners = [...byId.values()];
    return { inserted, updated };
  }

  /** Count properties for a council. Used by onboarding-state UI checks. */
  public countPropertiesForCouncil(code: string): number {
    let n = 0;
    for (const p of this.properties) if (p.council === code) n += 1;
    return n;
  }

  /**
   * Append a note to a property's `notes` array, returning the new property
   * record. No-op if the assessment is not found.
   */
  public addNoteToProperty(
    assessmentNumber: string,
    note: string,
  ): Property | undefined {
    const idx = this.properties.findIndex(
      (p) => p.assessmentNumber === assessmentNumber,
    );
    if (idx === -1) return undefined;
    const existing = this.properties[idx];
    if (existing === undefined) return undefined;
    const updated: Property = {
      ...existing,
      notes: [...existing.notes, note],
    };
    const next: Property[] = [...this.properties];
    next[idx] = updated;
    this.properties = next;
    return updated;
  }

  // ===== Rate schedule (per council, per FY) =====

  /** All rate schedule entries for a council + financial year. */
  public rateScheduleByCouncilYear(
    councilCode: string,
    financialYear: string,
  ): readonly RateScheduleEntry[] {
    const prefix = `${councilCode}::${financialYear}::`;
    const out: RateScheduleEntry[] = [];
    for (const [key, entry] of this.rateSchedules) {
      if (key.startsWith(prefix)) out.push(entry);
    }
    return out;
  }

  /**
   * Count rate-schedule rows for a council + FY. Cheap, indexed lookup.
   * Used by the importer's audit row (before/after counts).
   */
  public countRateScheduleForCouncilYear(
    councilCode: string,
    financialYear: string,
  ): number {
    let n = 0;
    const prefix = `${councilCode}::${financialYear}::`;
    for (const key of this.rateSchedules.keys()) {
      if (key.startsWith(prefix)) n += 1;
    }
    return n;
  }

  /**
   * Replace ALL rate-schedule rows for a council + FY (mergeStrategy=replace).
   * Idempotent — re-running with the same content yields the same map.
   */
  public replaceRateScheduleForCouncilYear(
    councilCode: string,
    financialYear: string,
    incoming: readonly RateScheduleEntry[],
  ): { readonly removed: number; readonly inserted: number } {
    const prefix = `${councilCode}::${financialYear}::`;
    let removed = 0;
    for (const key of [...this.rateSchedules.keys()]) {
      if (key.startsWith(prefix)) {
        this.rateSchedules.delete(key);
        removed += 1;
      }
    }
    for (const entry of incoming) {
      this.rateSchedules.set(
        `${councilCode}::${entry.financialYear}::${entry.rateCode}`,
        entry,
      );
    }
    return { removed, inserted: incoming.length };
  }

  /**
   * Upsert rate-schedule rows by (council, FY, rateCode). Idempotent.
   */
  public upsertRateScheduleEntries(
    councilCode: string,
    incoming: readonly RateScheduleEntry[],
  ): { readonly inserted: number; readonly updated: number } {
    let inserted = 0;
    let updated = 0;
    for (const entry of incoming) {
      const key = `${councilCode}::${entry.financialYear}::${entry.rateCode}`;
      if (this.rateSchedules.has(key)) {
        updated += 1;
      } else {
        inserted += 1;
      }
      this.rateSchedules.set(key, entry);
    }
    return { inserted, updated };
  }

  // ===== Landgate records (per VEN) =====

  /** All Landgate records under a council. */
  public landgateRecordsForCouncil(
    councilCode: string,
  ): readonly LandgateRecord[] {
    const out: LandgateRecord[] = [];
    for (const rec of this.landgateRecords.values()) {
      if (rec.councilCode === councilCode) out.push(rec);
    }
    return out;
  }

  /** Look up one Landgate record by VEN within a council. */
  public landgateRecordsByVen(
    councilCode: string,
    ven: string,
  ): LandgateRecord | undefined {
    return this.landgateRecords.get(`${councilCode}::${ven}`);
  }

  /**
   * Replace the entire Landgate snapshot for a council with the supplied set.
   * Idempotent — re-running with the same records yields the same store.
   */
  public replaceLandgateRecordsForCouncil(
    councilCode: string,
    incoming: readonly LandgateRecord[],
  ): { readonly removed: number; readonly inserted: number } {
    let removed = 0;
    for (const [key, rec] of [...this.landgateRecords.entries()]) {
      if (rec.councilCode === councilCode) {
        this.landgateRecords.delete(key);
        removed += 1;
      }
    }
    for (const rec of incoming) {
      this.landgateRecords.set(`${rec.councilCode}::${rec.ven}`, rec);
    }
    return { removed, inserted: incoming.length };
  }

  /**
   * Upsert a single Landgate record (keyed by VEN under the council).
   * Idempotent.
   */
  public upsertLandgateRecord(record: LandgateRecord): LandgateRecord {
    this.landgateRecords.set(
      `${record.councilCode}::${record.ven}`,
      record,
    );
    return record;
  }

  /** Count Landgate records for a council — used for before/after audit. */
  public countLandgateRecordsForCouncil(councilCode: string): number {
    let n = 0;
    for (const rec of this.landgateRecords.values()) {
      if (rec.councilCode === councilCode) n += 1;
    }
    return n;
  }

  // ===== Water Corp eligibility (per customer/card) =====

  /** Look up WC eligibility by card number (with optional customerId fallback). */
  public waterCorpEligibilityByCard(
    councilCode: string,
    cardOrCustomer: string,
  ): WaterCorpEligibilityRecord | undefined {
    return this.wcEligibility.get(`${councilCode}::${cardOrCustomer}`);
  }

  /** All WC eligibility rows for a council. */
  public waterCorpEligibilityForCouncil(
    councilCode: string,
  ): readonly WaterCorpEligibilityRecord[] {
    const out: WaterCorpEligibilityRecord[] = [];
    for (const row of this.wcEligibility.values()) {
      if (row.councilCode === councilCode) out.push(row);
    }
    return out;
  }

  /**
   * Upsert WC eligibility rows. Key is `${councilCode}::${cardNumber||customerId}`.
   * Idempotent.
   */
  public upsertWaterCorpEligibility(
    incoming: readonly WaterCorpEligibilityRecord[],
  ): { readonly inserted: number; readonly updated: number } {
    let inserted = 0;
    let updated = 0;
    for (const row of incoming) {
      const id = row.cardNumber ?? row.customerId;
      const key = `${row.councilCode}::${id}`;
      if (this.wcEligibility.has(key)) {
        updated += 1;
      } else {
        inserted += 1;
      }
      this.wcEligibility.set(key, row);
    }
    return { inserted, updated };
  }

  /** Count WC eligibility rows for a council — used for before/after audit. */
  public countWaterCorpEligibilityForCouncil(councilCode: string): number {
    let n = 0;
    for (const row of this.wcEligibility.values()) {
      if (row.councilCode === councilCode) n += 1;
    }
    return n;
  }

  // ===== Strata lifecycle (per parent assessment) =====

  /** Look up the strata lifecycle for a parent assessment. */
  public strataLifecycleByAssessment(
    parentAssessmentNumber: string,
  ): StrataLifecycle | undefined {
    return this.strataLifecycles.get(parentAssessmentNumber);
  }

  /** Write/replace a strata lifecycle record. */
  public setStrataLifecycle(record: StrataLifecycle): StrataLifecycle {
    this.strataLifecycles.set(record.parentAssessmentNumber, record);
    return record;
  }

  /** Snapshot all strata lifecycles (for dashboard counters). */
  public listStrataLifecycles(): readonly StrataLifecycle[] {
    return [...this.strataLifecycles.values()];
  }

  /**
   * Append a property record directly. Used by the strata-conversion
   * workflow to materialise child Property records from a parent's CT
   * subdivision.
   */
  public addProperty(property: Property): Property | undefined {
    if (
      this.properties.some(
        (p) => p.assessmentNumber === property.assessmentNumber,
      )
    ) {
      return undefined;
    }
    this.properties = [...this.properties, property];
    return property;
  }
}
