/**
 * Aggregate statistics across a candidate set.
 *
 * Used by dashboards (web app, council briefings, executive recovery reports)
 * to roll up findMismatches output into a single summary block. Pure, O(n)
 * over the candidate list, no I/O.
 */

import type {
  MismatchCandidate,
  MismatchSeverity,
} from "@ratesassist/contract";

/**
 * Roll-up of a candidate set.
 *
 * - `total`: number of candidates after any upstream filtering.
 * - `bySeverity`: count broken out per severity band (always all three keys).
 * - `totalUpliftAud`: sum of `estUplift` across the set.
 * - `highSeverityUpliftAud`: sum of `estUplift` restricted to `high` candidates.
 * - `totalArrears3yAud`: sum of `estArrears3y` (3-year conservative window).
 * - `totalRecoveryAud`: `totalUpliftAud + totalArrears3yAud` — the headline
 *   number councils quote for "what's on the table this year".
 * - `signalCounts`: map of signal id → number of candidates that signal fired
 *   against. Useful for tuning weights and explaining detector behaviour.
 */
export type RecoveryStats = {
  readonly total: number;
  readonly bySeverity: Readonly<Record<MismatchSeverity, number>>;
  readonly totalUpliftAud: number;
  readonly highSeverityUpliftAud: number;
  readonly totalArrears3yAud: number;
  readonly totalRecoveryAud: number;
  readonly signalCounts: Readonly<Record<string, number>>;
};

/**
 * Severity keys exhaustively enumerated so the returned record is always
 * fully populated even if no candidates of a given band exist. Keep in sync
 * with the `MismatchSeverity` union in `@ratesassist/contract`.
 */
const SEVERITIES: readonly MismatchSeverity[] = ["high", "medium", "low"] as const;

/**
 * Compute the recovery statistics for a candidate list.
 *
 * Accepts `readonly MismatchCandidate[]` so any caller (whether they hold a
 * mutable array or a frozen one) can use it without a copy.
 */
export function recoveryStats(
  candidates: readonly MismatchCandidate[],
): RecoveryStats {
  const bySeverity: Record<MismatchSeverity, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };
  // Touch every key so we don't trip over `noUncheckedIndexedAccess` when
  // callers iterate. (No-op assignments — TypeScript is satisfied by the
  // literal initialiser above; the loop simply documents intent.)
  for (const s of SEVERITIES) {
    bySeverity[s] = bySeverity[s];
  }

  let totalUpliftAud = 0;
  let highSeverityUpliftAud = 0;
  let totalArrears3yAud = 0;
  const signalCounts: Record<string, number> = {};

  for (const c of candidates) {
    bySeverity[c.severity] += 1;
    totalUpliftAud += c.estUplift;
    totalArrears3yAud += c.estArrears3y;
    if (c.severity === "high") {
      highSeverityUpliftAud += c.estUplift;
    }
    for (const hit of c.signals) {
      signalCounts[hit.id] = (signalCounts[hit.id] ?? 0) + 1;
    }
  }

  return {
    total: candidates.length,
    bySeverity,
    totalUpliftAud,
    highSeverityUpliftAud,
    totalArrears3yAud,
    totalRecoveryAud: totalUpliftAud + totalArrears3yAud,
    signalCounts,
  };
}
