/**
 * @ratesassist/recovery-engine — public surface.
 *
 * Re-exports the deterministic detection pipeline:
 * - `signals.ts` defines the catalogue and severity / uplift constants.
 * - `scoring.ts` evaluates per-property signals and composes them.
 * - `findMismatches.ts` ranks portfolio-wide candidates.
 * - `evidencePack.ts` renders the council-grade markdown pack.
 * - `stats.ts` aggregates a candidate set into a roll-up.
 *
 * Adapters (TechOne, Civica, demo, etc.) consume only `@ratesassist/contract`
 * + this package — no platform-specific code lives here.
 */

export type {
  EvaluationContext,
  ChangeDetectionEntry,
  ChangeDetectionKind,
} from "./scoring.js";
export type {
  UpliftInput,
  UpliftResult,
  UpliftErrorCode,
} from "./upliftCalculator.js";
export type {
  FindMismatchesOptions,
  FindMismatchesResult,
} from "./findMismatches.js";
export type {
  EvidencePack,
  EvidencePackResult,
  BuildEvidencePackOptions,
} from "./evidencePack.js";
export type { RecoveryStats } from "./stats.js";

export {
  SIGNAL_CATALOGUE,
  SEVERITY_BANDS,
  UPLIFT_MULTIPLIER,
  getSignal,
} from "./signals.js";

export {
  evaluateSignals,
  computeComposite,
  severityForScore,
  estimateUplift,
  estimateUpliftHeuristic,
} from "./scoring.js";

export {
  calculateUplift,
  BACKDATING_CONSERVATIVE_YEARS,
  BACKDATING_STATUTORY_YEARS,
} from "./upliftCalculator.js";

export { findMismatches } from "./findMismatches.js";
export { buildEvidencePack, sortSignalsByPriority } from "./evidencePack.js";
export { recoveryStats } from "./stats.js";

export {
  computeRatioStats,
  assessUniformity,
  peerDispersion,
  rollQuality,
  IAAO_MEDIAN_ASR_RANGE,
  IAAO_PRD_RANGE,
  IAAO_PRB_RANGE,
  IAAO_COD_UPPER,
  IAAO_MIN_SAMPLE,
  type RatioStats,
  type UniformityVerdict,
  type PeerDispersion,
  type StratumQuality,
  type RollQualityReport,
} from "./ratioStudy.js";

export {
  miscLicenceLegalRisk,
  legalRiskNotes,
  type LegalRiskNote,
  type LegalRiskCategory,
} from "./legalRisk.js";
