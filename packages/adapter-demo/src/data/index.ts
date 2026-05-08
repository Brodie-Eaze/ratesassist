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
  Owner,
  Property,
  Tenement,
  Transaction,
} from "@ratesassist/contract";

import { COUNCILS } from "./councils.js";
import { OWNERS as SEED_OWNERS } from "./owners.js";
import { PROPERTIES as SEED_PROPERTIES } from "./properties.js";
import { TENEMENTS } from "./tenements.js";
import { TRANSACTIONS } from "./transactions.js";

export { COUNCILS } from "./councils.js";
export { TENEMENTS } from "./tenements.js";
export { TRANSACTIONS } from "./transactions.js";

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

  /**
   * Construct a store from the seeded data. Each instance is independent,
   * so tests can construct fresh stores without leakage. Production wiring
   * uses a single process-wide instance.
   */
  public constructor() {
    this.properties = [...SEED_PROPERTIES];
    this.owners = [...SEED_OWNERS];
  }

  /** All councils (tenants) advertised by this adapter. */
  public listCouncils(): readonly Council[] {
    return COUNCILS;
  }

  /** Look up a council by code. Returns `undefined` when unknown. */
  public getCouncil(code: string): Council | undefined {
    return COUNCILS.find((c) => c.code === code);
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
   */
  public searchProperties(query: string): readonly Property[] {
    const q = query.toLowerCase();
    return this.properties.filter(
      (p) =>
        p.assessmentNumber.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q) ||
        p.suburb.toLowerCase().includes(q) ||
        p.postcode.includes(q),
    );
  }

  /**
   * Search by owner name (partial, case-insensitive), optionally restricted
   * to a single suburb (exact match, case-insensitive).
   */
  public searchByOwner(
    name: string,
    suburb?: string,
  ): readonly Property[] {
    const q = name.toLowerCase();
    const matchedIds = new Set(
      this.owners
        .filter((o) => o.name.toLowerCase().includes(q))
        .map((o) => o.ownerId),
    );
    if (matchedIds.size === 0) return [];
    return this.properties.filter((p) => {
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
}
