/**
 * Seeded property records for the demo adapter.
 *
 * Two layers:
 *
 *  1. **Curated properties** — explicitly hand-authored fixtures that drive
 *     the recovery-engine signals. These properties are referenced by
 *     {@link import("./tenements.js").TENEMENT_INTERSECTIONS} and underpin
 *     every demo of mining-mismatch detection. Modifying them will move the
 *     `find_mining_mismatches` results.
 *
 *  2. **Generic properties** — a deterministic generator producing 90
 *     residential/vacant/commercial/rural fixtures that pad the dataset to
 *     realistic council population sizes. Pure function of a counter — the
 *     sequence is reproducible across processes.
 *
 * Every property carries a synthesised cadastral parcel (square around the
 * centroid). Real adapters source parcel geometry from the cadastre.
 */
import type { Property } from "@ratesassist/contract";
/**
 * The full property dataset, with synthesised parcel polygons attached.
 * Frozen — mutating callers must produce a new record (the dispatcher's
 * write handlers do this via spread).
 */
export declare const PROPERTIES: readonly Property[];
//# sourceMappingURL=properties.d.ts.map