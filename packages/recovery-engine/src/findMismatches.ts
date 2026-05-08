/**
 * findMismatches — pure ranking pipeline over an EvaluationContext.
 *
 * For every property in the active tenant's portfolio, evaluate every signal,
 * compose a composite confidence score, derive a severity band, estimate the
 * uplift, and emit a fully-populated MismatchCandidate. Sorted by estimated
 * uplift (descending) — councils prioritise by recoverable revenue.
 *
 * This module is the single source of truth for "what does the recovery
 * engine think is mis-rated right now?". It is deterministic, side-effect
 * free, and entirely reproducible from a given EvaluationContext snapshot.
 */

import type {
  MismatchCandidate,
  MismatchSeverity,
  SignalHit,
} from "@ratesassist/contract";

import type { EvaluationContext } from "./scoring.js";
import {
  computeComposite,
  estimateUplift,
  evaluateSignals,
  severityForScore,
} from "./scoring.js";

/**
 * Filter options for {@link findMismatches}.
 *
 * - `council`: restrict the sweep to a single tenant code. When omitted, all
 *   properties in the context are evaluated (multi-tenant aggregations).
 * - `minSeverity`: drop candidates whose severity is below this band. The
 *   ranking ("low" < "medium" < "high") matches the contract's severity
 *   semantics.
 */
export type FindMismatchesOptions = {
  readonly council?: string;
  readonly minSeverity?: MismatchSeverity;
};

/**
 * Severity rank used purely for the `minSeverity` filter. Higher number =
 * stronger evidence. Ordering only — these numbers do not appear in any
 * contract field or output.
 */
const SEVERITY_RANK: Readonly<Record<MismatchSeverity, number>> = {
  low: 0,
  medium: 1,
  high: 2,
} as const;

/**
 * Choose the headline signal hit (highest weight). Returns the contract's
 * `kind` (signal short label) and `reason` (evidence string, optionally
 * appended with a count of compound signals).
 *
 * Caller MUST ensure `hits` is non-empty; we don't return an Option here
 * because the caller has already filtered out empty-signal properties.
 */
function describeHeadline(hits: readonly SignalHit[]): {
  readonly kind: string;
  readonly reason: string;
} {
  // Defensive: caller invariant says non-empty, but we don't want to crash
  // on a future regression. Use a narrow, explicit branch instead of `!`.
  const sorted = [...hits].sort((a, b) => b.weight - a.weight);
  const top = sorted[0];
  if (!top) {
    return { kind: "no signal", reason: "" };
  }

  const others = hits.length - 1;
  const reason =
    others > 0
      ? `${top.evidence} Plus ${others} additional signal(s) compound the case (composite breakdown below).`
      : top.evidence;

  return { kind: top.short, reason };
}

/**
 * Run the recovery engine over the supplied context.
 *
 * Returns a readonly, uplift-sorted list of candidates. Every candidate is
 * a complete, audit-ready record: every field on `MismatchCandidate` is
 * populated from deterministic functions of the input context.
 *
 * Time complexity: O(P · S) where P is the property count and S is the
 * signal count. The portfolio + spatial signals are O(P) each, but they
 * walk small per-owner / per-suburb subsets and are already optimised in
 * `evaluateSignals`.
 */
export function findMismatches(
  ctx: EvaluationContext,
  options: FindMismatchesOptions = {},
): readonly MismatchCandidate[] {
  const { council, minSeverity } = options;
  const minRank = SEVERITY_RANK[minSeverity ?? "low"];

  const out: MismatchCandidate[] = [];

  for (const property of ctx.properties) {
    if (council !== undefined && property.council !== council) {
      continue;
    }

    const signals = evaluateSignals(property, ctx);
    if (signals.length === 0) {
      continue;
    }

    const compositeScore = computeComposite(signals);
    const severity = severityForScore(compositeScore);
    if (SEVERITY_RANK[severity] < minRank) {
      continue;
    }

    const { estAnnualRatesNew, estUplift, estArrears3y } = estimateUplift(
      property.annualRates,
      severity,
    );
    const { kind, reason } = describeHeadline(signals);
    const tenements =
      ctx.tenementsByAssessment.get(property.assessmentNumber) ?? [];

    out.push({
      assessmentNumber: property.assessmentNumber,
      property,
      tenements,
      kind,
      severity,
      reason,
      estAnnualRatesNew,
      estUplift,
      estArrears3y,
      compositeScore,
      // `confidence` is a backward-compatibility alias maintained on the
      // contract; new code should read `compositeScore`.
      confidence: compositeScore,
      signals,
    });
  }

  out.sort((a, b) => b.estUplift - a.estUplift);
  return out;
}
