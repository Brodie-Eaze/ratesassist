/**
 * Seeded council (tenant) records for the demo adapter.
 *
 * The same eight councils are surfaced by the legacy web-app dataset: six in
 * WA, one each in NSW and QLD. Each entry is a `Council` from the contract
 * and carries the council's stable code, official name, demographics, and
 * map centroid for UI rendering.
 */
import type { Council } from "@ratesassist/contract";
/**
 * The full set of councils this adapter knows about. Ordered to match the
 * web app's existing presentation: WA councils first by population, then
 * interstate.
 */
export declare const COUNCILS: readonly Council[];
//# sourceMappingURL=councils.d.ts.map