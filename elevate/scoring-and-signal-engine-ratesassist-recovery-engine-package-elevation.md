# Elevation Report — Scoring and Signal Engine
## RatesAssist Recovery-Engine Package
**Feature score: 75/100 → potential: 93/100**
**Report date: 2026-06-09**

---

## What would the best product team on earth build here?

Stripe, Linear, and Apple share one instinct: they remove all the burden the user didn't ask to carry. A Stripe dashboard doesn't ask you to understand payment-network rules — it shows you "you made $4,120 today" and flags the one card that needs attention. Linear doesn't show you a bug tracker — it shows you what you're shipping this week. Apple doesn't show you a camera settings panel — it shows you the best photo you just took.

The best version of this feature would do one thing for a rates officer: show them the money they're missing, with a statutory paper-trail they can sign, in less than three clicks. Every piece of complexity below that bar is a tax on the officer's attention.

The jaw-drop moment this feature could deliver is described at the end of this report.

---

## The five structural weaknesses (current state)

Before recommendations, a clear-eyed assessment of what is actually broken — not just what could be better.

### W1 — The evidencePack O(n) scan (PERF-002 gap)
`buildEvidencePack` at line 112 of `evidencePack.ts` calls `ctx.properties.find()` to resolve a property by assessment number. `EvaluationContext` already carries three optional O(1) indexes (`propertiesByOwnerId`, `ruralBySuburb`, `lagCandidatesByAssessment`) each with the same optional-with-linear-fallback pattern. A fourth index — `propertiesByAssessmentNumber: ReadonlyMap<string, Property>` — is the missing entry in that set. At 10,000 properties generating 400 packs in a batch, this is 4 million comparisons instead of 400 lookups.

### W2 — The deceased-set O(D×P) scan (unlabelled performance gap)
`evaluateVenCtConcessionSignals` at line 613 of `scoring.ts` checks `proprietorIsDeceased` by spreading `ReadonlySet<string>` into an array and calling `normaliseName()` on every entry for every property. The fix is to pre-normalise the set at context-build time — the context builder normalises all names once, the hot-path drops to `Set.has()`. This is the only performance gap without a PERF annotation in the code comments, which means it is invisible to future maintainers.

### W3 — The discriminated-union dead zone in the evidence pack page
`/recovery/[assessment]/page.tsx` at line 109–138 handles `!pack` as a single binary branch. The engine returns five discriminated variants (`ok`, `no_property`, `no_signals`, `no_owner`, `no_state_template`). The page collapses `no_owner` and `no_state_template` into the same "clean" copy as `no_signals`. A council officer looking at a property with a missing owner link sees "Nothing to recover — all signals are clean for this assessment" — a false-reassurance that directly contradicts the data gap the engine has correctly identified.

### W4 — The address-match divergence in the concession audit section
`renderConcessionAuditSection` at lines 514–517 uses `.toLowerCase().includes()` to test postal-vs-property address match. The signal (`id.pensioner_not_at_property`) fires on `normaliseAddress()`. An officer can see "yes" in the markdown pack for a case where the signal correctly fired a mismatch — the pack contradicts the signal trail. This is a trust-destroying inconsistency on the one document a legal team will read.

### W5 — The uplift multiplier class-blindness
`UPLIFT_MULTIPLIER.high = 8` in `signals.ts` applies to all high-severity candidates regardless of signal compound. `8x` was calibrated against WA Pilbara general→mining transitions, where rate tables confirm that ratio. It has no empirical basis for concession-only high-severity candidates (e.g. `id.pensioner_deceased_continued_rebate` + `id.pensioner_not_at_property` stacking to ≥0.60). The pack may show a five-figure recovery figure for a case where the actual recoverable amount is a $400 rebate difference. Council trust erodes the first time a director investigates.

---

## Recommendations ranked by impact/effort ratio

### R1 — Discriminated empty-states on the evidence pack page
**What:** Handle all five `EvidencePackResult` variants explicitly. `no_owner` renders: "This property has no linked owner record — reconcile the rating system before drafting a notice." `no_state_template` renders: "This state is not yet supported for evidence pack generation — contact support." `no_signals` renders the current clean-bill copy. `no_property` renders the current not-found copy. Four branches, each accurate.

**Why this is the highest ratio fix:** It requires zero engine changes. It is a pure UI branch on a discriminated union the engine already returns. The cost is an afternoon. The gain is that a rates officer never again sees "all signals clean" when the real answer is "your data import failed." This is the type of bug that, when a council director finds it six months after go-live, generates a cancellation conversation.

**Impact: 9/10. Effort: 1/10. Ratio: 9.0. Effort days: 0.5**

---

### R2 — Address-normalisation consistency in the concession audit section
**What:** Replace the `includes()` comparison at lines 514–517 of `evidencePack.ts` with `normaliseAddress()`. The function already exists in the same file. One-line fix.

**Why this matters:** The concession audit section is the evidence that a council's legal team reads when they are about to suspend a pensioner's rebate. If the "Match" column says "yes" in the pack but the `id.pensioner_not_at_property` signal is in the signal trail, the pack is internally contradictory. A legal reviewer will flag it and lose confidence in the platform. The fix takes five minutes. The consequence of not fixing it could be a council deciding not to act on any concession signal because "the pack doesn't agree with itself."

**Impact: 8/10. Effort: 1/10. Ratio: 8.0. Effort days: 0.25**

---

### R3 — Pre-normalised deceased-references set
**What:** In context builders, normalise `proprietorDeceasedReferences` at construction time (pass through `normaliseName` on every entry). In `evaluateVenCtConcessionSignals`, replace the spread-and-iterate check with `deceasedRefs.has(normalisedProprietor)` — a single O(1) lookup. Add a JSDoc comment `// PERF-005: pre-normalised at context-build time` to match the existing PERF annotation convention.

**Why:** The four existing PERF annotations (`PERF-002` through `PERF-004`) reflect the team's intent to make the hot-path O(1). This gap is invisible because it has no annotation. At scale (500-person deceased-references set, 50,000-property portfolio), this is 25 million `normaliseName` calls per portfolio sweep instead of 50,000.

**Impact: 7/10. Effort: 2/10. Ratio: 3.5. Effort days: 1**

---

### R4 — Overtaxed candidates surface in the recovery UI
**What:** `findMismatches` already computes `overtaxedCandidates` and attaches them as a non-enumerable property on the returned array. The recovery page never reads it. Add a second section below the recovery candidate list: "Potential overtaxation — properties the engine identifies as possibly being over-rated." Use a distinct visual treatment (not red/amber — use a muted blue or grey to signal this is a review-not-recovery workflow). Link to the same evidence pack page. Add a stat card to the dashboard: "X properties may be overtaxed — estimated overpayment $Y."

**Why:** Discovering that a council is overtaxing ratepayers is a material finding — it is a liability, a reputational risk, and a governance gap. A council director who sees this surfaced for the first time in RatesAssist will forward the screenshot to their CEO. It is architecturally complete in the engine. The UI gap means the feature is invisible.

**Impact: 9/10. Effort: 3/10. Ratio: 3.0. Effort days: 2**

---

### R5 — Signal-class-aware heuristic uplift multipliers
**What:** Replace the single `UPLIFT_MULTIPLIER` record with a class-aware selector. Define two multiplier profiles: `TENEMENT_MULTIPLIER` (retaining 8x/4x/1.5x — empirically grounded in Pilbara data) and `CONCESSION_MULTIPLIER` (fixed at 1.0x/1.0x/1.0x — the recoverable amount is the rebate value, not a rate-class multiple). In `estimateUpliftHeuristic`, accept the signal compound and select the multiplier profile based on whether ANY `reg.tenement.*` or `reg.gpl.*` signal fired. For concession-only high-severity candidates, the "uplift" should be calculated as `annualRates × concessionRebateRate` (or zero if unknown), not `annualRates × 8`. Expose the multiplier profile name in the pack's audit trail so the UI can flag "heuristic (concession profile)" vs "heuristic (tenement profile)".

**Why:** A concession-only high-severity candidate with two signals stacking to ≥0.60 currently shows an `8x` uplift estimate. For a property paying $2,000/year in rates, that is a $14,000 "estimated annual uplift" for what may be a $400–$800 rebate recovery. A council director investigating a top-10 candidate who finds the uplift estimate is 20x too high will lose trust in every number on the dashboard.

**Impact: 8/10. Effort: 3/10. Ratio: 2.7. Effort days: 2**

---

### R6 — propertiesByAssessmentNumber index on EvaluationContext
**What:** Add `propertiesByAssessmentNumber?: ReadonlyMap<string, Property>` to `EvaluationContext`. In `buildEvidencePack` line 112, use `ctx.propertiesByAssessmentNumber?.get(assessmentNumber) ?? ctx.properties.find(...)`. Context builders that construct the other three indexes should build this one too. The JSDoc comment should read `// PERF-005: O(1) lookup; prefer over ctx.properties.find() for pack generation (PERF-002 family)`.

**Why:** The existing pattern is already established in the codebase — four optional O(1) indexes with linear fallback. This is the fifth entry in a consistent series. At 10,000 properties and 400 packs per batch, the difference between `find()` and `Map.get()` is measurable on the main thread. The primary value is not the speedup (the page is server-rendered, not interactive) but the consistency with the team's established performance discipline.

**Impact: 5/10. Effort: 2/10. Ratio: 2.5. Effort days: 1**

---

### R7 — Empty-portfolio first-time experience
**What:** When `data.stats.signalCounts` is `{}` (empty portfolio or first import), replace the bare "No candidates match the current filter" copy with a dedicated empty-state card. Two variants: (a) if the candidate list is zero AND the stats show zero total properties, show "No properties imported yet — upload your rating roll to begin"; (b) if properties exist but zero candidates, show "No mis-rated properties detected — the engine found nothing to recover. Run a full sweep or check the signal catalogue to understand why." Wire the CTA button directly to `/onboarding/[code]` in case (a) and `/signals` in case (b). The signal-filter dropdown should be disabled (not just empty) when `signalCounts` is `{}`.

**Why:** The recovery page is the first screen most council officers will land on after onboarding. A completely bare UI with "No candidates match the current filter" and $0 stat cards gives no direction. A well-designed empty state teaches the user what step to take next. This is the most basic UX hygiene in a B2B tool.

**Impact: 6/10. Effort: 3/10. Ratio: 2.0. Effort days: 2**

---

### R8 — Structured lag-days extraction on CandidateCard
**What:** Replace the regex `/Cadastre lag: (\d+) days?/` at line 880 of `recovery/page.tsx` with a structured field on `SignalHit` or `MismatchCandidate`. Two options: (a) add an optional `lagDays?: number` field to the engine's `LagCandidateForScoring` type and propagate it through to the candidate, or (b) add a `metadata?: Record<string, string | number>` bag on `SignalHit` keyed by signal id. The UI reads `signal.metadata?.lagDays` — no regex.

**Why:** The current regex creates a structural coupling between the spatial package's prose formatting and the recovery UI's badge logic. If anyone reformats the evidence string (capitalisation change, rewording), the badge silently disappears with no error. This is the kind of invisible regression that appears in a demo when a council director is watching. It has no test coverage. The fix separates presentation from data.

**Impact: 5/10. Effort: 3/10. Ratio: 1.7. Effort days: 2**

---

### R9 — Per-signal-class confidence interpretation in the pack header
**What:** In the evidence pack page header, below the "87% composite confidence" figure, add a one-line interpretation: "High confidence (tenement class) — statutory basis established" or "High confidence (concession class) — rebate recovery likely; investigate water-corp records." The interpretation is derived from the signal compound, not the score alone. This can be computed client-side from the pack's `signals` array.

**Why:** "87% confidence" means nothing to a council officer who does not understand composite scoring. "Statutory basis established — evidence from DMIRS, Landgate, and ABN Lookup" means something they can act on. The interpretation is what a good analyst would say when handing over the pack.

**Impact: 7/10. Effort: 4/10. Ratio: 1.75. Effort days: 3**

---

### R10 — One-click bulk evidence pack export (CSV + PDF bundle)
**What:** Add a "Export all high" button to the recovery dashboard that generates a ZIP containing: one PDF per high-severity candidate (reusing the existing `/api/evidence/[assessment]/pdf` endpoint), plus a summary CSV with assessment number, address, severity, composite score, headline signal, and estimated uplift. A server-sent-events stream reports progress. The ZIP is streamed, not built in memory.

**Why:** A council rates team handling a 200-candidate portfolio wants to triage offline, share with a solicitor, and load the CSV into their rating system for bulk update. The individual download button per evidence pack is correct for single-property review. The export is the workflow for quarterly review runs. This is the interaction that makes a council director forward a screenshot to a peer.

**Impact: 9/10. Effort: 6/10. Ratio: 1.5. Effort days: 5**

---

### R11 — Outcome feedback loop on resolved candidates
**What:** Add a "Mark resolved" action to the evidence pack page with three outcomes: "Reclassified — council actioned", "No action — officer decision", "False positive — signal incorrect." Persist to an audit row. The `recoveryStats` function should distinguish "actioned" from "pending" candidates. The signal catalogue page should show precision metrics per signal: how many candidates it fires on, and what fraction were actioned. This is the data collection infrastructure for Phase 8 weight calibration.

**Why:** The current weights are labelled "hand-set PRIORS" in `signals.ts`. They cannot become calibrated probabilities without feedback. Every day the platform runs without an outcome loop is a day of training data lost. The UI action is simple — three radio buttons and a submit. The long-term consequence is a platform whose signal weights are provably better than human intuition and can be defended to a council's audit committee.

**Impact: 9/10. Effort: 7/10. Ratio: 1.3. Effort days: 7**

---

## What to remove

These elements add complexity without proportionate value at the current stage.

**The `overtaxedCandidates` non-enumerable property pattern.** Attaching data as a non-enumerable property on an array is a design smell that will confuse every future developer who touches `findMismatches`. The result is typed, it is documented, but it breaks every standard array consumer (JSON serialisation, spread, `Array.from`). The fix is to return a plain object: `{ candidates: MismatchCandidate[], overtaxedCandidates: MismatchCandidate[] }`. This is a breaking contract change but it eliminates a class of subtle bugs. The current shape was chosen to avoid changing the return type of callers who used the array directly — that tradeoff should be revisited when the overtaxed surface is added to the UI (R4 above).

**The `estimateUplift` deprecated alias.** `estimateUplift` in `scoring.ts` is a re-export alias for `estimateUpliftHeuristic` marked `@deprecated`. It is still referenced in `evidencePack.ts` at line 39 (`import { ... estimateUplift ...}`). Every reference to the deprecated alias inside the package is a lie the compiler accepts. Remove the alias; update the one import in `evidencePack.ts` to `estimateUpliftHeuristic`. Cost: minutes. Gain: the codebase means what it says.

**The `!pack` binary branch in the evidence pack page.** Replace with an exhaustive switch on `result.kind`. The binary branch is already wrong (see W3 above) and will become more wrong as the discriminated union gains variants. Exhaustive switches produce a TypeScript type error when a new variant is added and no branch handles it — the binary branch silently falls through.

**The `signalCounts` counter in the UI being recomputed from `mismatches` client-side.** `data.stats.signalCounts` is already returned from the server. The client-side `signalSamples` memo is correct (it builds an id→SignalHit map for display). But the actual counts come from the server. The two are consistent now but could diverge if the server applies any server-side filtering that the client does not mirror. Consolidate: counts from server, display labels from the client memo. This is not urgent but it is a subtle correctness trap.

---

## The jaw-drop moment

**"Here is the letter."**

A rates officer opens an evidence pack. They read the signals, the map, the title-state section. They are convinced. They click "Approve reclassification." The platform:

1. Records the officer's decision with their identity and timestamp (immutable audit row).
2. Calculates the exact rates difference using the verified rate table formula.
3. Generates a statutory notice — not the current draft letterhead placeholder, but a complete formal notice with the council's letterhead, the officer's name, the statutory references, the exact dollar figure, the appeal period, and a QR code linking to the portal — ready to print or send.
4. Queues the notice in the rates system for the next levy run.
5. Marks the candidate as "actioned" in the signal engine's feedback loop.

The officer does not open Word. They do not open the rating system. They do not write a case note in a separate system. One click, one decision, one notice, one audit row.

That is the interaction that makes a council director forward the screenshot to the CEO of every council in the state. The engine is already good enough to earn that moment. The gap is the three steps after "I'm convinced."

---

## Summary table

| # | Recommendation | Impact | Effort | Ratio | Effort Days |
|---|---|:---:|:---:|:---:|:---:|
| R1 | Discriminated empty-states on evidence pack page | 9 | 1 | 9.0 | 0.5 |
| R2 | Address-normalisation consistency in concession audit | 8 | 1 | 8.0 | 0.25 |
| R3 | Pre-normalised deceased-references set | 7 | 2 | 3.5 | 1 |
| R4 | Overtaxed candidates surface in recovery UI | 9 | 3 | 3.0 | 2 |
| R5 | Signal-class-aware heuristic uplift multipliers | 8 | 3 | 2.7 | 2 |
| R6 | propertiesByAssessmentNumber index on EvaluationContext | 5 | 2 | 2.5 | 1 |
| R7 | Empty-portfolio first-time experience | 6 | 3 | 2.0 | 2 |
| R8 | Structured lag-days extraction on CandidateCard | 5 | 3 | 1.7 | 2 |
| R9 | Per-signal-class confidence interpretation in pack header | 7 | 4 | 1.75 | 3 |
| R10 | One-click bulk evidence pack export (CSV + PDF bundle) | 9 | 6 | 1.5 | 5 |
| R11 | Outcome feedback loop on resolved candidates | 9 | 7 | 1.3 | 7 |

**Immediate (this sprint, no new dependencies):** R1, R2, R3, R6 — total 2.75 days. Four bugs fixed, three of which are trust-destroying if a council legal team encounters them.

**Next sprint (UI additions, high ratio):** R4, R5, R7 — total 6 days. Overtaxed surface goes live, uplift figures stop lying, empty state guides onboarding.

**Following sprint (structural + ambitious):** R8, R9, R10, R11 — builds the export workflow, confidence interpretation, and the feedback loop that makes the signal weights trustworthy.
