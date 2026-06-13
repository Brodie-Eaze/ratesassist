# RatesAssist — Recovery Scorecard Model Specification

| | |
|---|---|
| **Document** | Model specification & governance record — RatesRecovery composite scorecard |
| **Audience** | Council risk/audit, procurement, ICT; external auditor; technical due-diligence |
| **Status** | Pre-pilot. Active development. No labelled outcomes yet. |
| **Owner** | Brodie · `security@ratesassist.com.au` |
| **Version** | 0.1 |
| **Last reviewed** | 2026-05-31 |
| **Review cycle** | Quarterly, or on any change to the signal catalogue, weights, or banding |

---

## Why this document exists

RatesRecovery surfaces properties that may be mis-rated and ranks them for an officer to review. That ranking is produced by a model. Any system that scores or ranks real-world entities for a consequential decision should be **documented, bounded, and governed** — even when the model is simple. This document is the canonical record of *what the scorecard is, what it is not, what it assumes, where it can be wrong, and how a human stays in control.*

It is written so that a council's Auditor-General, an OAIC reviewer, a SOC 2 auditor, or an acquirer's technical due-diligence team can each independently understand and challenge the model without reading the source. The implementation legend matches the rest of the documentation set:

- **In place** — implemented in the deployed code today.
- **Partial** — partially implemented; specific gaps called out.
- **Planned (Phase X)** — committed for a delivery phase, not yet implemented.
- **Aspirational** — an intent with no committed delivery date.

We never represent more than is true. In particular: **this is not a machine-learning model and does not claim a calibrated probability of recovery.**

---

## 1. Purpose & intended use

| | |
|---|---|
| **Decision supported** | Prioritisation — *which* properties an officer should review first for a possible rating correction. |
| **Decision NOT made by the model** | Whether to reclassify, re-rate, backdate, or pursue any ratepayer. Every such decision is made by a qualified council officer. |
| **Intended user** | A trained rates officer with statutory authority, using the score as a triage aid alongside the evidence trail. |
| **Out-of-scope uses** | Automated reclassification; automated ratepayer correspondence; credit, eligibility, or enforcement decisions about individuals; any use without an officer in the loop. |

The score is a **ranking aid for human review, not a verdict.** A high score means "look here first," not "this ratepayer owes money."

## 2. Model type & methodology

The scorecard is a **transparent weighted-additive composite** — a deterministic, fully-inspectable linear sum. It is not a learned model. There are no trained parameters, no opaque feature interactions, and no stochastic inference.

**Composition (`computeComposite`, `packages/recovery-engine/src/scoring.ts`):**

1. Each **signal** is a deterministic predicate over authoritative data. When a signal's condition holds for a property, it *fires* and contributes its hand-set **weight** (0.15–0.55).
2. Signals may belong to an **exclusive group** (e.g. `tenement-class`). Within a group, **only the single highest-weight firing signal contributes** — this prevents double-counting different descriptions of the same underlying fact.
3. Ungrouped signals all contribute additively.
4. The sum is **clamped to a maximum of 1.0**: `composite = min(1, Σ weights)`.

Because it is a sum of independent, individually-sourced terms, the score is **decomposable**: the evidence pack lists every firing signal, its weight, and its authoritative source. There is no part of the score a human cannot trace back to a register record.

## 3. Signals & data provenance

The catalogue contains **32 signals** (`packages/recovery-engine/src/signals.ts`), across six categories:

| Category | Example signal | Authoritative source |
|---|---|---|
| **Register** | Producing tenement on rural/vacant rate; DMIRS ahead of Landgate cadastre; strata parent still rated | DMIRS MINEDEX / EMITS; Landgate cadastre & restricted-tier title register; council DA / occupancy registers |
| **Identity** | Tenement holder ≠ rated owner; Landgate proprietor ≠ council owner; proprietor deceased | DMIRS; Landgate restricted-tier; Water Corp eligibility feed; council concession register |
| **Corporate** | Mining/industry indicator in owner name vs rural rate | ASIC company register + ATO ABN Lookup |
| **Behavioural** | Owner portfolio is mining-dominant | Internal portfolio analysis over the active tenant's own records |
| **Spatial** | High-value rural outlier within suburb | Internal spatial-pattern analysis |
| **Aerial** | Recent structural/land-use change; construction completed; commercial use on rural land | Nearmap AI change feed (integration **Planned**); council field-check |

**Provenance discipline (in place):** every firing signal carries an `evidence` string naming its source, and title-derived signals embed the source's `retrieved-at` timestamp so an officer can see how fresh the underlying record is. Signals that depend on a cross-register join (e.g. cadastre-lag, address mismatch) **only fire when the caller has actually performed that join** — an absent input silently does not fire, so the model never invents a signal it lacks evidence for. This is "honest by construction."

**Data minimisation:** the model consumes only the property, ownership, register, and spatial fields it needs to evaluate the predicates. PII handling, classification, and retention are governed by `DATA-CLASSIFICATION.md`, `PRIVACY.md`, and `DATA-RETENTION-POLICY.md`.

## 4. Weights — origin & status

> **Status: hand-set priors. Partial — NOT outcome-calibrated.**

Weights are **deliberately conservative priors set from domain expertise**, not coefficients fitted to outcomes. As of this writing **no pilot has run and no labelled recovery outcomes exist**, so there is nothing to calibrate against yet. The weights encode a practitioner's judgement of relative signal strength (e.g. a *producing tenement on a rural rate*, 0.55, is a stronger indicator than an *exploration-only tenement*, 0.20).

When enough labelled verdicts accumulate, the priors are intended to be replaced — or augmented — by an **outcome-calibrated head (Planned, Phase 8)**. Until then, any UI or report that implies a trained/AUC-validated model would be inaccurate; surfaces have been corrected to say "weighted-signal scoring / hand-set priors."

## 5. Output & severity bands

The composite (0..1) maps to a severity band by fixed, by-design thresholds (`SEVERITY_BANDS`):

| Band | Threshold | Reading |
|---|---|---|
| **High** | ≥ 0.60 | Strong multi-source evidence — review first. |
| **Medium** | ≥ 0.35 | A single strong register signal, or stacked weaker ones. |
| **Low** | ≥ 0.15 | Soft/review-only signal; cross-check before action. |
| *(suppressed)* | < 0.15 | Not surfaced as a candidate. |

These are **deliberate cut-points, not outcome-fitted decision boundaries.** They were chosen so that one strong register signal alone reaches Medium and a register+identity combination reaches High.

## 6. Recovery uplift estimate (separate from the score)

The dollar **uplift estimate** shown alongside a candidate is computed independently of the composite score, by one of two paths:

- **Accurate path** (`upliftCalculator.ts`): per-council differential rate tables + the change-detected date for statutory backdating. Preferred when rate-table provenance is available for the council.
- **Heuristic fallback** (`estimateUpliftHeuristic`): multipliers (≈8× general:mining, ≈4× rural:commercial, ≈1.5× review-only) approximating WA Pilbara ratios. An **honest stand-in** used only until a verified rate table is wired for the council.

Uplift figures are **estimates for prioritisation and officer planning**, not assessments of amounts owed. The statutory amount is always determined by the officer against the council's adopted rates.

## 7. Assumptions

1. Authoritative registers (DMIRS, Landgate, ASIC, ABR, Water Corp, council registers) are accurate as at their retrieval timestamp.
2. Register lag — a register reflecting reality before the council's rating record does — is a genuine recovery signal, not noise.
3. Signal weights reflect relative, not absolute, likelihood; the score ranks, it does not estimate probability.
4. A qualified officer reviews every candidate before any action; the model is never the final decision-maker.
5. Per-council rate variation is handled in the uplift path, not the score; the composite is council-agnostic.

## 8. Limitations & known failure modes

- **Not calibrated.** The score is ordinal/relative. Treating it as a probability of recovery would over-state confidence. (§4)
- **Source-quality ceiling.** Garbage in → garbage out: a stale or wrong register record produces a wrong signal. Mitigated by surfacing the retrieved-at freshness, not by the model "knowing better."
- **Coverage gaps fire nothing, not a low score.** If a cross-register join was not performed, the relevant signal is silent — absence of a signal is *not* evidence of correct rating.
- **Possible structural bias.** Signal coverage is richest for mining/tenement and WA-specific registers; property types or jurisdictions with thinner authoritative feeds will surface fewer candidates. This is a **coverage** bias to monitor (§9, §11), not a per-person fairness model — the subject is a *parcel/rating record*, but owner identity and concession signals do touch individuals and are treated with care.
- **Heuristic uplift can mis-state dollars** where no verified rate table is wired (§6).
- **Static weights drift.** Priors set today may diverge from reality as land-use patterns or council practices change; the quarterly review (§10) exists to catch this.

## 9. Validation plan

> **Status: Planned (Phase 8) — gated on the first pilot producing labelled outcomes.**

1. **Outcome labelling.** Each surfaced candidate accrues an officer disposition (e.g. *correct / no change / insufficient evidence / recovered $X*). This labelled set is the validation ground truth. *(Schema gap noted in the punch-list: `mismatch_candidates` needs disposition/reviewedBy/decision/overrideReason fields — a prerequisite for this plan.)*
2. **Ranking quality.** Once labels exist: precision-at-K, lift over a naïve baseline (e.g. "all tenement parcels"), and per-band hit-rate. The bar a calibrated head must beat is the current priors' ranking quality.
3. **Calibration (only once meaningful).** Reliability of any future probability output vs realised recovery rate.
4. **Backtesting.** Re-run the engine against historical council corrections (where a council can share them) to estimate signal precision before live use.
5. **Independent challenge.** Weights and banding reviewed by a second qualified rates practitioner before any production calibration is adopted.

Until (1)–(3) are possible, the honest claim is: *the scorecard is a transparent, auditable ranking heuristic with un-validated precision.* We state exactly that.

## 10. Monitoring & change control

- **Versioning.** The model version is surfaced to users (currently `v0.3-rule (hand-set priors)`). Any change to the signal catalogue, a weight, or a band is a model change and bumps the version + this document.
- **Change review.** Weight/band/signal changes require a code review and a recorded rationale; this document's *Last reviewed* and version must be updated in the same change.
- **Operational monitoring (Partial → Planned).** Per-signal firing rates, candidate volumes per council, and (once labels exist) per-band hit-rates are intended to be tracked so a signal that suddenly fires far more/less is investigated. Today this is manual/founder-run.
- **Deterministic reproducibility (in place).** Because the engine is pure and deterministic, the same inputs always produce the same score — a property of evidentiary value: a candidate can be exactly reproduced for audit.

## 11. Human oversight & fairness

- **Human in the loop (in place).** No reclassification, correspondence, or enforcement is automated. The score triages; the officer decides and is accountable.
- **Explainability (in place).** Every score decomposes into named, individually-sourced signals in the evidence pack — there is no black box to explain after the fact.
- **Appealability.** Because the basis is fully itemised and sourced, a ratepayer query can be answered with the specific register evidence, not "the algorithm said so."
- **Bias posture.** The model scores *rating records*, but identity, deceased-proprietor, and pensioner-concession signals touch individuals; these are weighted to **prompt careful officer review** (e.g. "engage the executor before suspending"), never to trigger automated action. Coverage bias (§8) is the primary fairness risk and is on the monitoring list.

## 12. Disposition for AI / model-governance review

| Question | Answer |
|---|---|
| Is the model documented? | Yes — this document. |
| Is its purpose and intended use bounded? | Yes (§1). |
| Is it explainable? | Yes — fully decomposable, deterministic (§2, §11). |
| Is it validated? | **Not yet** — no labelled outcomes exist; validation plan defined (§9). |
| Is a human accountable for every decision? | Yes (§1, §11). |
| Are limitations disclosed honestly? | Yes (§4, §8) and reflected in the product UI. |
| Is change controlled? | Yes (§10). |

**Bottom line:** a simple, honest, fully-auditable ranking heuristic with a human decision-maker on every action, an explicit "not calibrated" disclosure, and a concrete path to validation once a pilot produces ground truth.

---

*Canonical engineering reference: `packages/recovery-engine/src/signals.ts` (catalogue + weights), `packages/recovery-engine/src/scoring.ts` (`computeComposite`, `severityForScore`), `packages/recovery-engine/src/upliftCalculator.ts` (uplift). Related governance docs: `SECURITY.md`, `PRIVACY.md`, `DATA-CLASSIFICATION.md`, `PRODUCTION-PLAN.md`.*
