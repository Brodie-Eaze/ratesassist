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
import type { Council, Owner, Property, Tenement, Transaction } from "@ratesassist/contract";
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
export declare class DataStore {
    /** Defensive copy of the property seed, mutable internally only. */
    private properties;
    /** Defensive copy of the owner seed, mutable internally only. */
    private owners;
    /**
     * Construct a store from the seeded data. Each instance is independent,
     * so tests can construct fresh stores without leakage. Production wiring
     * uses a single process-wide instance.
     */
    constructor();
    /** All councils (tenants) advertised by this adapter. */
    listCouncils(): readonly Council[];
    /** Look up a council by code. Returns `undefined` when unknown. */
    getCouncil(code: string): Council | undefined;
    /** All properties across all tenants. Optionally filtered by council code. */
    listProperties(councilCode?: string): readonly Property[];
    /** Snapshot copy of the property list — used to seed the EvaluationContext. */
    snapshotProperties(): readonly Property[];
    /** Get one property by assessment number. */
    getProperty(assessmentNumber: string): Property | undefined;
    /**
     * Free-text search across address, suburb, postcode and assessment number.
     * Case-insensitive substring match. Empty queries are caller-responsibility
     * (the schema validates non-empty input upstream).
     */
    searchProperties(query: string): readonly Property[];
    /**
     * Search by owner name (partial, case-insensitive), optionally restricted
     * to a single suburb (exact match, case-insensitive).
     */
    searchByOwner(name: string, suburb?: string): readonly Property[];
    /** All overdue properties (positive outstanding balance). */
    listOverdue(councilCode?: string): readonly Property[];
    /** All owners. */
    listOwners(): readonly Owner[];
    /** Snapshot owners as a Map keyed by ownerId for the recovery EvaluationContext. */
    snapshotOwnersById(): ReadonlyMap<string, Owner>;
    /** Get one owner by ID. */
    getOwner(ownerId: string): Owner | undefined;
    /** Resolve all owners listed on a property. Order matches `property.ownerIds`. */
    ownersForProperty(p: Property): readonly Owner[];
    /** Transactions for one property. Empty array when none on file. */
    getTransactions(assessmentNumber: string): readonly Transaction[];
    /** All live tenements that intersect the given assessment. */
    tenementsForAssessment(assessmentNumber: string): readonly Tenement[];
    /**
     * Snapshot tenements indexed by assessment number for the recovery
     * EvaluationContext. Includes only `Live` tenements (matches the
     * recovery engine's per-property branches).
     */
    snapshotTenementsByAssessment(): ReadonlyMap<string, readonly Tenement[]>;
    /**
     * Replace an owner record with a new immutable record. Returns the new
     * record. No-op if the ownerId is not found.
     */
    replaceOwner(updated: Owner): Owner | undefined;
    /**
     * Append a note to a property's `notes` array, returning the new property
     * record. No-op if the assessment is not found.
     */
    addNoteToProperty(assessmentNumber: string, note: string): Property | undefined;
}
//# sourceMappingURL=index.d.ts.map