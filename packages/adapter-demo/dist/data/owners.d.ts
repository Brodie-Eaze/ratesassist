/**
 * Seeded owner records for the demo adapter.
 *
 * Two layers, mirroring `properties.ts`:
 *
 *   1. **Curated owners** — explicit fixtures with realistic ABNs, contact
 *      details, and (where applicable) ABN status that drives the recovery
 *      engine's `id.abn.cancelled_or_suspended` and `id.holder_ne_owner`
 *      signals.
 *
 *   2. **Generic owners** — 60 deterministic individual owners (`O-GEN-030`
 *      through `O-GEN-089`). Of these, only the first nine are referenced
 *      by the generic property generator; the rest exist so that future
 *      data extensions can tag properties to a wider pool without changing
 *      the existing assessment-to-owner mapping.
 *
 * Pseudonyms are intentionally professional (no nicknames or in-jokes) so
 * the dataset is presentable to councils as part of a vendor demo.
 */
import type { Owner } from "@ratesassist/contract";
/**
 * The full owner dataset (curated then generic). Frozen — mutating handlers
 * (e.g. `update_owner_contact`) MUST replace records, never edit in place.
 */
export declare const OWNERS: readonly Owner[];
//# sourceMappingURL=owners.d.ts.map