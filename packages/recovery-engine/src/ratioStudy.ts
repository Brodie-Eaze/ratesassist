/**
 * @ratesassist/recovery-engine/ratioStudy — IAAO assessment-quality science.
 *
 * The "what else is out there" edge: a self-taught officer finds mis-rated
 * parcels one at a time, by eye. IAAO ratio studies find SYSTEMIC, category-
 * level under-assessment across the whole roll at once, with court-defensible
 * thresholds (the same science MPAC, BC Assessment, and the UK VOA run). A WA
 * council's rural-category COD is almost certainly far outside the IAAO band —
 * that gap is both a detection signal and a governance artifact no WA council
 * currently receives ("Assessment Roll Quality Report").
 *
 * TWO honest layers:
 *  1. `computeRatioStats` — the market-calibrated IAAO engine (median ASR, COD,
 *     PRD, PRB) over (assessed, market) pairs. CORRECT and tested against worked
 *     examples; it LIGHTS UP when real sale prices arrive (Landgate transfers =
 *     paid data, queued). Until then it has no market input to run on.
 *  2. `rollQuality` / `peerDispersion` — runs on CURRENT data with NO sale
 *     prices: the dispersion of valuations WITHIN a (land-use × suburb) stratum.
 *     High dispersion in a homogeneous stratum flags parcels that don't belong
 *     (e.g. an industrial parcel hiding among residential). Honestly labelled as
 *     DISPERSION, not a sales-ratio study — it measures uniformity, and cannot
 *     detect a whole-category level error vs market without sales.
 *
 * Pure: no I/O. Formulae follow the IAAO Standard on Ratio Studies.
 */

import type { LandUse, Property } from "@ratesassist/contract";

// ===== IAAO thresholds (verified against the IAAO Standard on Ratio Studies) =====

/** Acceptable median assessment-to-sale ratio band. */
export const IAAO_MEDIAN_ASR_RANGE = { min: 0.9, max: 1.1 } as const;

/** Price-Related Differential acceptable band (outside = vertical inequity). */
export const IAAO_PRD_RANGE = { min: 0.98, max: 1.03 } as const;

/** Price-Related Bias: acceptable within ±0.05; action required beyond ±0.10. */
export const IAAO_PRB_RANGE = { acceptable: 0.05, unacceptable: 0.1 } as const;

/**
 * COD (uniformity) upper bounds by property class. Lower bound is 5 for all
 * (below 5 the sample/data is suspect). Mapped from the IAAO type bands.
 */
export const IAAO_COD_UPPER: Record<LandUse, number> = {
  Residential: 15, // single-family heterogeneous
  Commercial: 20, // income-producing, smaller market
  Industrial: 20,
  Rural: 20, // "other residential" / rural band
  Vacant: 25, // vacant land
  Mining: 25, // high natural variability — treat like vacant/special
};

const IAAO_COD_LOWER = 5;
const DEFAULT_COD_UPPER = 20;

/** IAAO minimum sample for a meaningful ratio/dispersion study on a stratum. */
export const IAAO_MIN_SAMPLE = 5;

// ===== Pure statistics =====

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Ordinary-least-squares slope of y on x. Returns 0 when x has no variance. */
function olsSlope(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - xMean;
    num += dx * (ys[i]! - yMean);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

export type RatioStats = {
  /** Number of usable (assessed, market) pairs. */
  readonly n: number;
  /** Median assessment-to-market ratio (the IAAO level measure). */
  readonly medianRatio: number;
  /** Mean ratio. */
  readonly meanRatio: number;
  /** Σassessed / Σmarket — the value-weighted mean ratio. */
  readonly weightedMeanRatio: number;
  /** Coefficient of Dispersion (%) — average absolute deviation from median. */
  readonly cod: number;
  /** Price-Related Differential = meanRatio / weightedMeanRatio. */
  readonly prd: number;
  /** Price-Related Bias — regression slope; % ratio change per value doubling. */
  readonly prb: number;
};

/**
 * Compute the IAAO ratio-study statistics over (assessed, market) pairs. Pairs
 * with a non-finite or non-positive `market` are skipped. Returns all-zero stats
 * for an empty set. This is the market-calibrated engine — supply real sale
 * prices (or an independent market value) as `market`.
 */
export function computeRatioStats(
  pairs: ReadonlyArray<{ readonly assessed: number; readonly market: number }>,
): RatioStats {
  const clean = pairs.filter(
    (p) =>
      Number.isFinite(p.assessed) &&
      Number.isFinite(p.market) &&
      p.market > 0,
  );
  const n = clean.length;
  if (n === 0) {
    return { n: 0, medianRatio: 0, meanRatio: 0, weightedMeanRatio: 0, cod: 0, prd: 0, prb: 0 };
  }

  const ratios = clean.map((p) => p.assessed / p.market);
  const sorted = [...ratios].sort((a, b) => a - b);
  const med = median(sorted);
  const meanRatio = ratios.reduce((a, b) => a + b, 0) / n;
  const sumAssessed = clean.reduce((a, p) => a + p.assessed, 0);
  const sumMarket = clean.reduce((a, p) => a + p.market, 0);
  const weightedMeanRatio = sumMarket > 0 ? sumAssessed / sumMarket : 0;

  const cod =
    med > 0 ? (100 * ratios.reduce((a, r) => a + Math.abs(r - med), 0)) / n / med : 0;
  const prd = weightedMeanRatio > 0 ? meanRatio / weightedMeanRatio : 0;

  // PRB: regress (ratio - median)/median on log2 of a value proxy independent of
  // the ratio (IAAO Standard on Ratio Studies).
  let prb = 0;
  if (n >= 2 && med > 0) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const valueProxy = 0.5 * (clean[i]!.assessed / med) + 0.5 * clean[i]!.market;
      if (valueProxy > 0) {
        xs.push(Math.log(valueProxy) / Math.LN2);
        ys.push((ratios[i]! - med) / med);
      }
    }
    prb = olsSlope(xs, ys);
  }

  return { n, medianRatio: med, meanRatio, weightedMeanRatio, cod, prd, prb };
}

// ===== Verdicts =====

export type UniformityVerdict = {
  readonly codUpperBound: number;
  readonly codWithinStandard: boolean;
  readonly prdWithinStandard: boolean;
  /** "regressive" (high-value under-assessed) | "progressive" | "neutral". */
  readonly prdDirection: "regressive" | "progressive" | "neutral";
  readonly prbWithinStandard: boolean;
  readonly prbActionRequired: boolean;
};

/** Assess a RatioStats against the IAAO bands for a given property class. */
export function assessUniformity(stats: RatioStats, propertyClass?: LandUse): UniformityVerdict {
  const codUpperBound =
    propertyClass !== undefined ? IAAO_COD_UPPER[propertyClass] : DEFAULT_COD_UPPER;
  return {
    codUpperBound,
    codWithinStandard: stats.cod >= IAAO_COD_LOWER && stats.cod <= codUpperBound,
    prdWithinStandard: stats.prd >= IAAO_PRD_RANGE.min && stats.prd <= IAAO_PRD_RANGE.max,
    prdDirection:
      stats.prd > IAAO_PRD_RANGE.max ? "regressive" : stats.prd < IAAO_PRD_RANGE.min ? "progressive" : "neutral",
    prbWithinStandard: Math.abs(stats.prb) <= IAAO_PRB_RANGE.acceptable,
    prbActionRequired: Math.abs(stats.prb) > IAAO_PRB_RANGE.unacceptable,
  };
}

// ===== Peer-dispersion (runs NOW, no sale prices) =====

export type PeerDispersion = {
  readonly n: number;
  readonly medianValuation: number;
  /** COD of valuations within the stratum (uniformity proxy). */
  readonly cod: number;
};

/**
 * Dispersion of a set of valuations within a stratum, expressed as the IAAO COD
 * of each valuation against the stratum median. This is NOT a sales-ratio study
 * (no market input) — it measures within-stratum UNIFORMITY. High dispersion in
 * a stratum that should be homogeneous flags parcels that may not belong (a
 * mis-classification anomaly).
 */
export function peerDispersion(valuations: readonly number[]): PeerDispersion {
  const clean = valuations.filter((v) => Number.isFinite(v) && v > 0);
  const n = clean.length;
  if (n === 0) return { n: 0, medianValuation: 0, cod: 0 };
  const sorted = [...clean].sort((a, b) => a - b);
  const med = median(sorted);
  const cod = med > 0 ? (100 * clean.reduce((a, v) => a + Math.abs(v - med), 0)) / n / med : 0;
  return { n, medianValuation: med, cod };
}

export type StratumQuality = {
  readonly landUse: LandUse;
  readonly suburb: string;
  readonly dispersion: PeerDispersion;
  readonly codUpperBound: number;
  /** dispersion COD exceeds the IAAO band for this class → investigate. */
  readonly exceedsStandard: boolean;
  /** Below IAAO_MIN_SAMPLE — too small for a meaningful study. */
  readonly underSampled: boolean;
  /** Assessment numbers furthest from the stratum median (lead candidates). */
  readonly topOutlierAssessments: readonly string[];
};

export type RollQualityReport = {
  readonly strata: readonly StratumQuality[];
  /** Strata that exceed the IAAO band AND have a usable sample — the lead list. */
  readonly flaggedStrata: readonly StratumQuality[];
  readonly note: string;
};

/**
 * Build an Assessment Roll Quality report from the current roll. Groups
 * properties by (land-use × suburb), computes peer dispersion per stratum, and
 * flags strata whose dispersion exceeds the IAAO COD band for their class. The
 * market-calibrated COD/PRD/PRB study (via `computeRatioStats`) supersedes this
 * once sale prices are available.
 */
export function rollQuality(
  properties: ReadonlyArray<Pick<Property, "assessmentNumber" | "landUse" | "suburb" | "valuation">>,
  opts: { readonly maxOutliers?: number } = {},
): RollQualityReport {
  const maxOutliers = opts.maxOutliers ?? 5;
  const groups = new Map<string, Array<Pick<Property, "assessmentNumber" | "landUse" | "suburb" | "valuation">>>();
  for (const p of properties) {
    const key = `${p.landUse} ${p.suburb}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [p]);
    else bucket.push(p);
  }

  const strata: StratumQuality[] = [];
  for (const bucket of groups.values()) {
    const landUse = bucket[0]!.landUse;
    const suburb = bucket[0]!.suburb;
    const dispersion = peerDispersion(bucket.map((p) => p.valuation));
    const codUpperBound = IAAO_COD_UPPER[landUse] ?? DEFAULT_COD_UPPER;
    const underSampled = dispersion.n < IAAO_MIN_SAMPLE;
    const topOutlierAssessments = [...bucket]
      .filter((p) => Number.isFinite(p.valuation) && p.valuation > 0)
      .sort(
        (a, b) =>
          Math.abs(b.valuation - dispersion.medianValuation) -
          Math.abs(a.valuation - dispersion.medianValuation),
      )
      .slice(0, maxOutliers)
      .map((p) => p.assessmentNumber);
    strata.push({
      landUse,
      suburb,
      dispersion,
      codUpperBound,
      exceedsStandard: !underSampled && dispersion.cod > codUpperBound,
      underSampled,
      topOutlierAssessments,
    });
  }

  // Stable deterministic order: worst (highest COD over bound) first.
  strata.sort((a, b) => b.dispersion.cod - a.dispersion.cod);

  return {
    strata,
    flaggedStrata: strata.filter((s) => s.exceedsStandard),
    note: "Peer-dispersion (uniformity) study on current valuations — no sale prices. Market-calibrated IAAO COD/PRD/PRB (computeRatioStats) supersedes this once Landgate sale data is available.",
  };
}
