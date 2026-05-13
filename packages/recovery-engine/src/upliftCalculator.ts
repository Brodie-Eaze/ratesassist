/**
 * Accurate rate-recovery uplift calculator.
 *
 * Replaces the heuristic `estimateUplift` multipliers with the actual WA
 * differential-rate formula. Every number this returns is defensible:
 *
 *   annual_rates = max(value × rateInDollar, minimumPayment)
 *
 * where `value` is GRV (urban / commercial / industrial / vacant) or UV
 * (rural / pastoral / mining), per the council's published schedule.
 *
 * Backdating per WA LGA s.6.81 ("rates that ought to have been imposed"):
 * up to 5 years statutory cap; we surface BOTH the statutory ceiling and a
 * conservative 3-year practical cap because most councils self-impose the
 * tighter ceiling on audit / admin grounds.
 *
 * The result carries a full human-readable formula trail + the council's
 * source URL so the evidence pack can be audited line by line.
 */

import type {
  DifferentialRateLine,
  LandUseCategory,
  RateBasis,
  RateTable,
} from "@ratesassist/contract";
import { findRateLine } from "@ratesassist/contract";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Practical cap most WA councils self-impose on backdated corrections. */
export const BACKDATING_CONSERVATIVE_YEARS = 3;
/** Statutory ceiling per WA LGA 1995 s.6.81. */
export const BACKDATING_STATUTORY_YEARS = 5;

export type UpliftInput = {
  readonly property: {
    readonly assessmentNumber: string;
    readonly councilCode: string;
    readonly grv?: number;
    readonly uv?: number;
    readonly currentLandUse: LandUseCategory;
    readonly currentAnnualRates: number;
  };
  readonly correctLandUse: LandUseCategory;
  /** ISO date the change was first detectable in upstream registers. */
  readonly changeDetectedAt: string;
  readonly rateTable: RateTable;
  /** ISO date or millisecond epoch; defaults to Date.now() at call time. */
  readonly evaluationDate?: string;
};

export type UpliftErrorCode =
  | "missing_grv"
  | "missing_uv"
  | "no_rate_line"
  | "no_rate_table"
  | "invalid_change_date";

export type UpliftResult =
  | {
      readonly ok: true;
      readonly currentAnnualRates: number;
      readonly correctAnnualRates: number;
      readonly annualUplift: number;
      readonly yearsSinceChange: number;
      readonly backdatedYearsConservative: number;
      readonly backdatedYearsStatutory: number;
      readonly backdatedAmountConservative: number;
      readonly backdatedAmountStatutory: number;
      readonly totalRecoverableConservative: number;
      readonly totalRecoverableStatutory: number;
      readonly rateBasis: RateBasis;
      readonly formula: string;
      readonly sourceUrl: string;
      readonly verified: boolean;
      readonly caveats: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: UpliftErrorCode;
      readonly message: string;
    };

function fmtAud(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

function fmtCents(rateInDollar: number): string {
  // 0.10254 -> "10.254c/$"
  return `${(rateInDollar * 100).toFixed(3).replace(/\.?0+$/, "")}c/$`;
}

function valueForBasis(
  basis: RateBasis,
  grv: number | undefined,
  uv: number | undefined,
): number | undefined {
  return basis === "GRV" ? grv : uv;
}

function computeAnnual(
  line: DifferentialRateLine,
  value: number,
): { annual: number; raw: number; usedMin: boolean } {
  const raw = value * line.rateInDollar;
  const annual = Math.max(raw, line.minimumPayment);
  return { annual, raw, usedMin: annual === line.minimumPayment && raw < line.minimumPayment };
}

function parseDate(s: string): number | null {
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Calculate the rates uplift, backdated arrears, and total recoverable for
 * a property whose land-use category should be `correctLandUse` instead of
 * `currentLandUse`. All inputs are validated; failure returns a typed
 * error rather than throwing.
 */
export function calculateUplift(input: UpliftInput): UpliftResult {
  const { property, correctLandUse, changeDetectedAt, rateTable, evaluationDate } = input;

  if (rateTable === undefined || rateTable === null) {
    return { ok: false, code: "no_rate_table", message: "Rate table not provided." };
  }

  const currentLine = findRateLine(rateTable, property.currentLandUse);
  const correctLine = findRateLine(rateTable, correctLandUse);

  if (currentLine === undefined) {
    return {
      ok: false,
      code: "no_rate_line",
      message: `No ${property.currentLandUse} rate line in ${rateTable.councilCode} ${rateTable.financialYear} schedule.`,
    };
  }
  if (correctLine === undefined) {
    return {
      ok: false,
      code: "no_rate_line",
      message: `No ${correctLandUse} rate line in ${rateTable.councilCode} ${rateTable.financialYear} schedule.`,
    };
  }

  const currentValue = valueForBasis(currentLine.basis, property.grv, property.uv);
  const correctValue = valueForBasis(correctLine.basis, property.grv, property.uv);

  if (currentValue === undefined) {
    return {
      ok: false,
      code: currentLine.basis === "GRV" ? "missing_grv" : "missing_uv",
      message: `Property ${property.assessmentNumber} is missing ${currentLine.basis} value required for the ${property.currentLandUse} (current) rate line.`,
    };
  }
  if (correctValue === undefined) {
    return {
      ok: false,
      code: correctLine.basis === "GRV" ? "missing_grv" : "missing_uv",
      message: `Property ${property.assessmentNumber} is missing ${correctLine.basis} value required for the ${correctLandUse} (correct) rate line.`,
    };
  }

  const current = computeAnnual(currentLine, currentValue);
  const correct = computeAnnual(correctLine, correctValue);
  const annualUplift = correct.annual - current.annual;

  const changeMs = parseDate(changeDetectedAt);
  if (changeMs === null) {
    return {
      ok: false,
      code: "invalid_change_date",
      message: `changeDetectedAt is not a parseable ISO date: ${changeDetectedAt}`,
    };
  }

  const evalMs =
    evaluationDate !== undefined && evaluationDate !== ""
      ? parseDate(evaluationDate) ?? Date.now()
      : Date.now();

  // Negative if changeDetectedAt is in the future — we floor at 0 so an
  // upstream timestamp glitch doesn't fabricate negative arrears.
  const yearsSinceChange = Math.max(0, (evalMs - changeMs) / MS_PER_YEAR);

  const backdatedYearsConservative = Math.min(yearsSinceChange, BACKDATING_CONSERVATIVE_YEARS);
  const backdatedYearsStatutory = Math.min(yearsSinceChange, BACKDATING_STATUTORY_YEARS);

  const backdatedAmountConservative = annualUplift * backdatedYearsConservative;
  const backdatedAmountStatutory = annualUplift * backdatedYearsStatutory;

  // Total recoverable = backdated arrears + one year forward (the corrected
  // levy that will be issued going forward).
  const totalRecoverableConservative = backdatedAmountConservative + annualUplift;
  const totalRecoverableStatutory = backdatedAmountStatutory + annualUplift;

  const caveats: string[] = [];
  if (!rateTable.verified) {
    caveats.push(
      `Rate table not verified against council source — provenance: ${rateTable.note ?? "unverified"}.`,
    );
  }
  if (rateTable.carriedForward === true) {
    caveats.push(
      `Rate-in-dollar carried forward from a previous financial year; council 2025-26 schedule was not retrievable at build time.`,
    );
  }
  if (current.usedMin) {
    caveats.push(`Current rates pinned at the ${property.currentLandUse} minimum payment floor.`);
  }
  if (correct.usedMin) {
    caveats.push(`Correct rates pinned at the ${correctLandUse} minimum payment floor.`);
  }
  if (yearsSinceChange === 0) {
    caveats.push(`Change detected on or after the evaluation date — backdated arrears are $0.`);
  }
  if (yearsSinceChange > BACKDATING_STATUTORY_YEARS) {
    caveats.push(
      `Years since change (${yearsSinceChange.toFixed(1)}) exceed the ${BACKDATING_STATUTORY_YEARS}-year WA LGA s.6.81 statutory cap — arrears are capped accordingly.`,
    );
  }

  const currentClause = current.usedMin
    ? `min payment ${fmtAud(currentLine.minimumPayment)}`
    : `${currentLine.basis} ${fmtAud(currentValue)} × ${fmtCents(currentLine.rateInDollar)} = ${fmtAud(current.raw)}`;
  const correctClause = correct.usedMin
    ? `min payment ${fmtAud(correctLine.minimumPayment)}`
    : `${correctLine.basis} ${fmtAud(correctValue)} × ${fmtCents(correctLine.rateInDollar)} = ${fmtAud(correct.raw)}`;

  const formula =
    `Current (${property.currentLandUse}): ${currentClause} → ${fmtAud(current.annual)}/yr. ` +
    `Correct (${correctLandUse}): ${correctClause} → ${fmtAud(correct.annual)}/yr. ` +
    `Annual uplift = ${fmtAud(annualUplift)}/yr. ` +
    `Years since change: ${yearsSinceChange.toFixed(2)}. ` +
    `Backdated ${BACKDATING_CONSERVATIVE_YEARS}y (conservative): ${fmtAud(backdatedAmountConservative)}. ` +
    `Backdated ${BACKDATING_STATUTORY_YEARS}y (LGA s.6.81 statutory): ${fmtAud(backdatedAmountStatutory)}.`;

  return {
    ok: true,
    currentAnnualRates: current.annual,
    correctAnnualRates: correct.annual,
    annualUplift,
    yearsSinceChange,
    backdatedYearsConservative,
    backdatedYearsStatutory,
    backdatedAmountConservative,
    backdatedAmountStatutory,
    totalRecoverableConservative,
    totalRecoverableStatutory,
    rateBasis: correctLine.basis,
    formula,
    sourceUrl: rateTable.sourceUrl,
    verified: rateTable.verified,
    caveats,
  };
}
