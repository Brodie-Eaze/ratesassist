/**
 * findMismatches — pure ranking pipeline. For every property, evaluate every
 * signal, compose a composite confidence score, derive a severity band,
 * estimate the uplift, and emit a MismatchCandidate. Sorted by estimated
 * uplift desc.
 *
 * Uplift path selection:
 *  - When `ctx.rateTablesByCouncil` carries a table for this council AND
 *    the property has a change-detection entry with a `correctLandUse`
 *    hypothesis AND the property carries a GRV (or UV for rural-basis
 *    targets), the engine routes through `calculateUplift` — every
 *    candidate then carries a full formula trail + source URL.
 *  - Otherwise it falls back to `estimateUpliftHeuristic` and the
 *    candidate's `rateFormula` is set to `"heuristic"` so the UI can flag
 *    it explicitly. No silent fabrication.
 */

import type {
  LandUseCategory,
  MismatchCandidate,
  MismatchSeverity,
  Property,
  RateTable,
  SignalHit,
} from "@ratesassist/contract";

import type { ChangeDetectionEntry, EvaluationContext } from "./scoring.js";
import {
  computeComposite,
  estimateUpliftHeuristic,
  evaluateSignals,
  severityForScore,
} from "./scoring.js";
import { calculateUplift } from "./upliftCalculator.js";

export type FindMismatchesOptions = {
  readonly council?: string;
  readonly minSeverity?: MismatchSeverity;
  /** Override evaluation date (ISO); useful for deterministic tests. */
  readonly evaluationDate?: string;
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

/**
 * Domain `LandUse` -> rating `LandUseCategory` shim. The contract's
 * `LandUse` is the smaller closed set; the rate table carries finer
 * categories (Pastoral, MiningOther). When a property's domain landUse
 * matches a category directly, the rate-line lookup succeeds.
 */
function domainToCategory(landUse: Property["landUse"]): LandUseCategory {
  return landUse as LandUseCategory;
}

function pickChangeForUplift(
  entries: readonly ChangeDetectionEntry[],
): ChangeDetectionEntry | undefined {
  return entries.find((e) => e.correctLandUse !== undefined) ?? entries[0];
}

export function findMismatches(
  ctx: EvaluationContext,
  options: FindMismatchesOptions = {},
): readonly MismatchCandidate[] {
  const { council, minSeverity, evaluationDate } = options;
  const minRank = SEVERITY_RANK[minSeverity ?? "low"];

  const out: MismatchCandidate[] = [];

  for (const property of ctx.properties) {
    if (council !== undefined && property.council !== council) {
      continue;
    }
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

    const { kind, reason } = describeHeadline(signals);
    const tenements =
      ctx.tenementsByAssessment.get(property.assessmentNumber) ?? [];

    // Try the accurate path first.
    const rateTable: RateTable | undefined = ctx.rateTablesByCouncil?.get(
      property.council,
    );
    const changeEntries = ctx.changeDetectionByAssessment?.get(
      property.assessmentNumber,
    );
    const chosenChange = changeEntries
      ? pickChangeForUplift(changeEntries)
      : undefined;

    let estAnnualRatesNew: number;
    let estUplift: number;
    let estArrears3y: number;
    let correctAnnualRates: number | undefined;
    let backdatedAmountStatutory: number | undefined;
    let backdatedAmountConservative: number | undefined;
    let yearsSinceChange: number | undefined;
    let changeDetectedAt: string | undefined;
    let rateFormula: string | undefined;
    let rateSourceUrl: string | undefined;
    let rateTableVerified: boolean | undefined;

    if (
      rateTable !== undefined &&
      chosenChange?.correctLandUse !== undefined
    ) {
      const result = calculateUplift({
        property: {
          assessmentNumber: property.assessmentNumber,
          councilCode: property.council,
          grv: property.grv,
          uv: property.uv,
          currentLandUse: domainToCategory(property.landUse),
          currentAnnualRates: property.annualRates,
        },
        correctLandUse: chosenChange.correctLandUse,
        changeDetectedAt: chosenChange.detectedAt,
        rateTable,
        evaluationDate,
      });

      if (result.ok) {
        correctAnnualRates = result.correctAnnualRates;
        estAnnualRatesNew = Math.round(result.correctAnnualRates);
        estUplift = Math.round(result.annualUplift);
        // Keep estArrears3y semantically as the conservative 3-year arrears
        // (matches the existing contract field's documented meaning).
        estArrears3y = Math.round(result.backdatedAmountConservative);
        backdatedAmountStatutory = Math.round(result.backdatedAmountStatutory);
        backdatedAmountConservative = Math.round(result.backdatedAmountConservative);
        yearsSinceChange = result.yearsSinceChange;
        changeDetectedAt = chosenChange.detectedAt;
        rateFormula = result.formula;
        rateSourceUrl = result.sourceUrl;
        rateTableVerified = result.verified;
      } else {
        // Fall back to heuristic and surface the error reason as the formula
        // so the UI flags it.
        const fb = estimateUpliftHeuristic(property.annualRates, severity);
        estAnnualRatesNew = fb.estAnnualRatesNew;
        estUplift = fb.estUplift;
        estArrears3y = fb.estArrears3y;
        rateFormula = `heuristic (accurate path unavailable: ${result.message})`;
        rateSourceUrl = rateTable.sourceUrl;
        rateTableVerified = rateTable.verified;
        changeDetectedAt = chosenChange.detectedAt;
      }
    } else {
      const fb = estimateUpliftHeuristic(property.annualRates, severity);
      estAnnualRatesNew = fb.estAnnualRatesNew;
      estUplift = fb.estUplift;
      estArrears3y = fb.estArrears3y;
      rateFormula = "heuristic";
      if (rateTable !== undefined) {
        rateSourceUrl = rateTable.sourceUrl;
        rateTableVerified = rateTable.verified;
      }
      if (chosenChange !== undefined) {
        changeDetectedAt = chosenChange.detectedAt;
      }
    }

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
      confidence: compositeScore,
      signals,
      correctAnnualRates,
      backdatedAmountStatutory,
      backdatedAmountConservative,
      yearsSinceChange,
      changeDetectedAt,
      rateFormula,
      rateSourceUrl,
      rateTableVerified,
    });
  }

  out.sort((a, b) => b.estUplift - a.estUplift);
  return out;
}
