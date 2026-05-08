/**
 * Seeded mining tenement records for the demo adapter.
 *
 * Real adapters source these from authoritative state mining registers
 * (DMIRS WFS for WA, MinView for NSW, GeoResGlobe for QLD). The demo seeds
 * a hand-picked set that drives the recovery-engine signals against the
 * curated property fixtures.
 *
 * Every tenement is `Live` — the seed does not currently model surrendered,
 * pending, or cancelled tenements because the recovery engine treats them
 * as filtered-out on the live-only branch. Future adapters with richer
 * fixtures should add status variation here.
 */
import type { Tenement } from "@ratesassist/contract";
/**
 * The frozen tenement dataset. All tenements are `Live` in the demo seed;
 * extend this seed (and the seed shape) when modelling lifecycle states
 * becomes relevant.
 */
export declare const TENEMENTS: readonly Tenement[];
//# sourceMappingURL=tenements.d.ts.map