/**
 * @ratesassist/recovery-engine/legalRisk — legal-risk guards on recoveries.
 *
 * Some recoveries are technically supportable today but sit on contested or
 * actively-changing law. Pursuing them blind can turn a "recovery" into a
 * refund LIABILITY. This module surfaces those cases as a structured note the
 * evidence pack (and any UI) renders prominently, so an officer confirms the
 * position before acting.
 *
 * GUARD 1 — Miscellaneous licences (tenement type "L"):
 *   *Shire of Mount Magnet v Atlantic Vanadium* [2025] WASC 274 held occupied
 *   miscellaneous licences RATEABLE. But the Local Government Amendment (Rating
 *   of Certain Mining Licences) Bill 2025 — if enacted — would RETROSPECTIVELY
 *   extinguish miscellaneous-licence rates (FY2017-18 onward) and require
 *   refunds within 28 days. So a misc-licence recovery pursued now could be
 *   reversed + refunded if the Bill passes. We do NOT suppress the candidate
 *   (it is rateable under current law) — we WARN, and advise confirming the
 *   Bill's status first. This is honest under either outcome.
 *
 * Pure: no I/O. Presentation-agnostic — returns structured notes; callers render.
 */

import type { Tenement } from "@ratesassist/contract";

export type LegalRiskCategory = "miscellaneous_licence";

export type LegalRiskNote = {
  readonly category: LegalRiskCategory;
  /** Tenement ids that trigger the risk. */
  readonly affectedTenementIds: readonly string[];
  /** One-paragraph advisory, safe to render inline (no newlines). */
  readonly note: string;
};

/** DMIRS tenement type code for a miscellaneous licence. */
const MISC_LICENCE_TYPE = "L";

const MISC_LICENCE_NOTE =
  "Miscellaneous licence rateability is contested. Shire of Mount Magnet v Atlantic Vanadium [2025] WASC 274 held occupied miscellaneous licences rateable, but the Local Government Amendment (Rating of Certain Mining Licences) Bill 2025 — if enacted — would retrospectively extinguish miscellaneous-licence rates (FY2017-18 onward) and require refunds within 28 days. Confirm the Bill's current status before pursuing: a recovery pursued now could become a refund liability.";

/**
 * Flag a recovery that relies on one or more miscellaneous-licence tenements.
 * Returns null when no misc-licence tenement is present.
 */
export function miscLicenceLegalRisk(
  tenements: readonly Tenement[],
): LegalRiskNote | null {
  const affected = tenements
    .filter((t) => t.type === MISC_LICENCE_TYPE)
    .map((t) => t.tenementId);
  if (affected.length === 0) return null;
  return {
    category: "miscellaneous_licence",
    affectedTenementIds: affected,
    note: MISC_LICENCE_NOTE,
  };
}

/**
 * All applicable legal-risk notes for a recovery's tenements. Currently just the
 * miscellaneous-licence guard; the array shape lets new guards slot in without
 * changing callers.
 */
export function legalRiskNotes(tenements: readonly Tenement[]): readonly LegalRiskNote[] {
  const notes: LegalRiskNote[] = [];
  const misc = miscLicenceLegalRisk(tenements);
  if (misc !== null) notes.push(misc);
  return notes;
}
