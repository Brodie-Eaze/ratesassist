/**
 * findMismatches — pure ranking pipeline. For every property, evaluate every
 * signal, compose a composite confidence score, derive a severity band,
 * estimate the uplift, and emit a MismatchCandidate. Sorted by estimated
 * uplift desc.
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

export type FindMismatchesOptions = {
  readonly council?: string;
  readonly minSeverity?: MismatchSeverity;
};

const SEVERITY_RANK: Readonly<Record<MismatchSeverity, number>> = {
  low: 0,
  medium: 1,
  high: 2,
} as const;

// Pick the highest-weight hit; if the case has compound signals, note the
// count so the candidate's `reason` reflects more than just the headline.
function describeHeadline(hits: readonly SignalHit[]): {
  readonly kind: string;
  readonly reason: string;
} {
  const top = [...hits].sort((a, b) => b.weight - a.weight)[0];
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
    // Honour the optional state-scope filter (WA-only GTM lock). Properties
    // in other states stay in the fixture but are not surfaced as
    // candidates until inter-state expansion lands.
    if (
      ctx.targetStateScope !== undefined &&
      property.state !== ctx.targetStateScope
    ) {
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
      // `confidence` is a backward-compat alias; new code reads compositeScore.
      confidence: compositeScore,
      signals,
    });
  }

  out.sort((a, b) => b.estUplift - a.estUplift);
  return out;
}
