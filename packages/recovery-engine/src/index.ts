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

export type { EvaluationContext } from "./scoring.js";
export type { FindMismatchesOptions } from "./findMismatches.js";
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
} from "./scoring.js";

export { findMismatches } from "./findMismatches.js";
export { buildEvidencePack } from "./evidencePack.js";
export { recoveryStats } from "./stats.js";
