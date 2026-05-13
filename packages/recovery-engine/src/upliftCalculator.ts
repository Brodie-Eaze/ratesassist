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
    /**
     * Optional ISO date the GRV figure was last revalued by the Valuer-General.
     * When provided and the value is older than 3 years relative to the
     * evaluation date, a caveat is added to the result so a clerk can verify
     * the figure before issuing a notice. Out of scope to add to contract
     * Property — adapters can pass it through here directly.
     */
    readonly grvAsAt?: string;
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
  | "invalid_change_date"
  | "invalid_input";

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

/** ISO-date regex: yyyy-mm-dd, optionally followed by `T` (time component). */
const STRICT_ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;
const MIN_DATE_MS = Date.parse("1900-01-01T00:00:00Z");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Strict parser for `changeDetectedAt` — rejects ambiguous formats,
 * pre-1900 dates, and future-dated changes more than a day past the
 * evaluation date. Returns null on rejection; caller maps to invalid_change_date.
 */
function parseChangeDate(s: string, evalMs: number): number | null {
  if (typeof s !== "string" || !STRICT_ISO_DATE.test(s)) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  if (ms < MIN_DATE_MS) return null;
  if (ms > evalMs + ONE_DAY_MS) return null;
  return ms;
}

function isPositiveFinite(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
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

  // ---- Input validation (SEC-005 / math review C1) ----
  // GRV / UV are optional in the input type (one or the other may be
  // required depending on basis). We reject only the cases where a value is
  // *present but invalid* (NaN, Infinity, negative, or exactly zero). The
  // "value required but absent" case is handled below per-basis as
  // missing_grv / missing_uv with full context.
  // GRV / UV: when present but non-finite / zero / negative we treat it as
  // "value cannot be used" (missing_grv / missing_uv) and let the caller see
  // a clear message identifying the offending raw value.
  if (property.grv !== undefined && !isPositiveFinite(property.grv)) {
    return {
      ok: false,
      code: "missing_grv",
      message: `Property ${property.assessmentNumber} has unusable GRV value (${property.grv}). GRV must be a finite positive number.`,
    };
  }
  if (property.uv !== undefined && !isPositiveFinite(property.uv)) {
    return {
      ok: false,
      code: "missing_uv",
      message: `Property ${property.assessmentNumber} has unusable UV value (${property.uv}). UV must be a finite positive number.`,
    };
  }
  if (
    !Number.isFinite(property.currentAnnualRates) ||
    property.currentAnnualRates < 0
  ) {
    return {
      ok: false,
      code: "invalid_input",
      message: `Property ${property.assessmentNumber} has invalid currentAnnualRates (${property.currentAnnualRates}). Must be a finite non-negative number.`,
    };
  }

  // ---- Same-category guard: no reclassification, no uplift ----
  if (correctLandUse === property.currentLandUse) {
    return {
      ok: true,
      currentAnnualRates: property.currentAnnualRates,
      correctAnnualRates: property.currentAnnualRates,
      annualUplift: 0,
      yearsSinceChange: 0,
      backdatedYearsConservative: 0,
      backdatedYearsStatutory: 0,
      backdatedAmountConservative: 0,
      backdatedAmountStatutory: 0,
      totalRecoverableConservative: 0,
      totalRecoverableStatutory: 0,
      rateBasis: "GRV",
      formula: `No reclassification — current and correct categories both equal ${property.currentLandUse}.`,
      sourceUrl: rateTable.sourceUrl,
      verified: rateTable.verified,
      caveats: [
        `No reclassification — current and correct categories match (${property.currentLandUse}). No uplift to recover.`,
      ],
    };
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

  const evalMs =
    evaluationDate !== undefined && evaluationDate !== ""
      ? parseDate(evaluationDate) ?? Date.now()
      : Date.now();

  const changeMs = parseChangeDate(changeDetectedAt, evalMs);
  if (changeMs === null) {
    return {
      ok: false,
      code: "invalid_change_date",
      message: `changeDetectedAt is not a valid ISO date (yyyy-mm-dd, between 1900-01-01 and the evaluation date): ${changeDetectedAt}`,
    };
  }

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

  // ---- Negative-uplift caveat (math review C2) ----
  // The correct category produces lower rates than the current one — the
  // property is being overtaxed. We still return ok:true (the number is real
  // and product-positive for a CFO who wants to identify overtaxation),
  // but the caveat ensures no notice is issued without human review.
  if (annualUplift < 0) {
    caveats.push(
      `Correct category produces LOWER rates than current — this property may be overtaxed by ${fmtAud(-annualUplift)}/yr. Review before issuing any notice.`,
    );
  }

  // ---- Stale GRV caveat (math review C12) ----
  // The Valuer-General revalues GRV every 1-3 years. If the input carries a
  // grvAsAt and it's older than 3 years from the evaluation date, surface a
  // caveat so the clerk can verify the figure before quoting it.
  if (property.grvAsAt !== undefined) {
    const grvAsAtMs = parseDate(property.grvAsAt);
    if (grvAsAtMs !== null && property.grv !== undefined) {
      const grvAgeYears = (evalMs - grvAsAtMs) / MS_PER_YEAR;
      if (grvAgeYears > 3) {
        caveats.push(
          `GRV of ${fmtAud(property.grv)} is from ${property.grvAsAt} (${grvAgeYears.toFixed(1)} years old) — Valuer-General revalues every 1-3 years. Verify against the current GRV before issuing a notice.`,
        );
      }
    }
  }

  // ---- Stale rate-table effective-window caveat ----
  // If the rate table's effectiveTo precedes the evaluation date the schedule
  // has expired; the council will have published a new schedule that may
  // differ. Flag for refresh rather than silently using stale rates.
  if (rateTable.effectiveTo !== undefined) {
    const effectiveToMs = parseDate(rateTable.effectiveTo);
    if (effectiveToMs !== null && evalMs > effectiveToMs) {
      caveats.push(
        `Rate table for ${rateTable.financialYear} is no longer in effect (expired ${rateTable.effectiveTo}). Refresh before issuing a notice.`,
      );
    }
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
