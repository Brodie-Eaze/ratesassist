/**
 * @ratesassist/contract — platform scope constants
 *
 * Single source of truth for the product's go-to-market scope. RatesAssist
 * targets Western Australian councils first because:
 *
 *   1. The Local Government Act 1995 (WA) gives councils explicit
 *      reclassification powers under s.6.28 that we model directly.
 *   2. WA's data-availability stack (Landgate, DMIRS MINEDEX, SLIP) is the
 *      most open in the country — every signal in the recovery engine
 *      depends on at least one WA-specific upstream.
 *   3. The mining-mismatch wedge is overwhelmingly a WA story: ~62% of
 *      Australia's live mining tenements are in WA.
 *
 * Inter-state expansion (NSW LGA 1993, QLD LGA 2009, SA, NT pastoral
 * leases) is a roadmap item — each state needs its own statutory-basis
 * mapping, its own rating-platform adapter, and its own cadastre source.
 * Until those land, every UI surface filters down to WA and the
 * `add_council` tool only accepts `state: "WA"`.
 *
 * To widen the scope later:
 *   - Drop the `z.literal("WA")` constraint in `inputs.add_council` back to
 *     the full `australianState` enum.
 *   - Set `TARGET_STATE_SCOPE` below to `null` to disable the filter.
 *   - Audit `findMismatches` and the UI pages to ensure no other
 *     state-specific assumptions remain.
 */

/**
 * The state the product is currently scoped to. `null` would disable
 * scoping entirely. Engines that respect this constant filter their
 * candidate set to `property.state === TARGET_STATE_SCOPE` when set.
 */
export const TARGET_STATE_SCOPE = "WA" as const;

/** Human-readable scope banner copy used by every page header. */
export const TARGET_STATE_SCOPE_BANNER =
  "Scope: Western Australia (LGA-1995). Inter-state expansion in roadmap.";
