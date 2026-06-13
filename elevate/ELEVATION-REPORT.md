# RatesAssist — Master Elevation Report

**Generated:** 2026-06-09  
**Reviewer:** Elevation agent (claude-sonnet-4-6)  
**Scope:** Four core P0 features: Recovery Audit Dashboard, Evidence Pack (per-property), Scoring and Signal Engine, Evidence Pack Generator (Backend)

---

## 1. Executive Summary

RatesAssist has a technically sound foundation — 33+ live signals, real DMIRS integration, a discriminated evidence engine, and a statutory-grade PDF pipeline — but three clusters of defects (silent build breaks, cross-tenant data isolation, and factually wrong error states) prevent it from being production-deployable today. Fix the seven items with a ratio of 6 or higher (total: two days of engineering effort) and the platform clears the elite bar across every scored dimension; complete the ten items that follow and RatesAssist becomes the first LGA software where every mis-rated property surfaces automatically, every statutory document is cryptographically verifiable, and every officer action is one click — a product council directors will forward to their peers.

---

## 2. Feature Scores

| Feature | Path / Package | Current | Potential | Gap |
|---|---|:---:|:---:|:---:|
| Recovery Audit Dashboard | `/recovery` | 59 | 90 | +31 |
| Evidence Pack (per-property) | `/recovery/[assessment]` | 65 | 93 | +28 |
| Scoring and Signal Engine | `recovery-engine` package | 75 | 93 | +18 |
| Evidence Pack Generator (Backend) | `/api/evidence/[file]` + `/api/evidence/[file]/pdf` | 68 | 92 | +24 |

---

## 3. Top 10 Recommendations

Ranked by impact/effort ratio, cross-feature.

---

### #1 — Fix PDF context isolation (replace `getEvaluationContext()` with per-tenant async path)

**Feature:** Evidence Pack Generator (Backend)  
**File:** `apps/web/app/api/evidence/[file]/pdf/route.ts:91`  
**What to build:** Replace the two-word call `getEvaluationContext()` with `await getEvaluationContextForTenant(session.tenantId)`. The route is already `async`. No signature change needed.  
**Why it matters to a WA council officer:** Under the E3 multi-tenant design the global context cache is intentionally cross-tenant — a TPS officer's PDF may be built from a context containing KAL property records and KAL owner names that leaked into the shared snapshot before per-tenant isolation was introduced. A statutory document with wrong-council data is not recoverable after lodgement. This is the highest-severity defect in the codebase.  
**Effort:** 0.25 days  
**Gauntlet finding closed:** Evidence Pack Generator Backend W1 (data-isolation regression, severity: Critical)  
**Ratio:** 10

---

### #2 — Fix missing Tailwind warn color stops (unblocks broken badges and buttons)

**Feature:** Recovery Audit Dashboard  
**Files:** `apps/web/tailwind.config.ts:41-45` · `apps/web/app/recovery/page.tsx:907,939,985`  
**What to build:** Add `warn-100`, `warn-200`, `warn-300`, `warn-400`, and `warn-600` to the `warn` palette in `tailwind.config.ts`. Also add `eslint-plugin-tailwindcss` with `no-custom-classname` restricted to the design token set so missing stops become a CI failure instead of a silent visual regression.  
**Why it matters:** The NEW GRANT badge, cadastre lag-days badge, and the strata Convert button are rendered with transparent/black backgrounds today. These are the three highest-value visual affordances in the product. A council officer who cannot see the Convert button cannot act on a $200K+ strata reclassification workflow.  
**Effort:** 0.5 days  
**Gauntlet finding closed:** Recovery Dashboard W1 (SILENT BUILD BREAK)  
**Ratio:** 9

---

### #3 — Fix PDF operator name regex (strips spaces from statutory attestation line)

**Feature:** Evidence Pack (per-property)  
**File:** `apps/web/lib/evidencePdf.ts:94`  
**What to build:** Replace `/[ -\\()<>]/g` with `/[\x00-\x1f\x7f\\()<>[\]{}/%#]/g`. The current regex contains a character range `[ -\\]` (space through backslash, ASCII 0x20–0x5C) that strips spaces, digits, and uppercase letters. `Jane Smith` becomes `JaneSmith` in the PDF Author metadata and the statutory attestation line.  
**Why it matters:** Every council officer whose display name contains a space — which is all of them — gets a malformed attestation in every statutory PDF. A council solicitor reviewing the document for a rates tribunal challenge will flag this immediately and may argue the document lacks valid officer attestation.  
**Effort:** 0.25 days  
**Gauntlet finding closed:** Evidence Pack per-property BUG-3 (PDF operator name sanitiser strips spaces)  
**Ratio:** 9

---

### #4 — Discriminated empty-states on the evidence pack page

**Feature:** Scoring and Signal Engine + Evidence Pack (per-property)  
**Files:** `apps/web/app/recovery/[assessment]/page.tsx:46` · `packages/recovery-engine/src/evidencePack.ts`  
**What to build:** Replace the binary `result.kind === "ok" ? result.pack : null` check with an exhaustive `switch (result.kind)` that renders a distinct, accurate UI state for each of the five discriminated outcomes: `ok`, `no_property`, `no_signals`, `no_owner`, `no_state_template`. Zero engine changes required — the discrimination is already done by `buildEvidencePack`. Sample copy: `no_owner` → "DATA INTEGRITY ALERT — This property has no linked owner record. Reconcile the rating system before drafting a notice." `no_state_template` → "This state is not yet supported — contact support."  
**Why it matters:** The current binary branch collapses `no_owner` and `no_state_template` into the same "all signals clean" copy as `no_signals`. An officer reads "Nothing to recover" for a property with a suspected mismatch and a broken owner link. This is the kind of factually wrong empty state that, when a council director finds it six months post-go-live, triggers a cancellation conversation.  
**Effort:** 0.5 days  
**Gauntlet finding closed:** Scoring Engine W3 · Evidence Pack BUG-1  
**Ratio:** 9

---

### #5 — Always-visible Strata Convert button (remove filter-mode gating)

**Feature:** Recovery Audit Dashboard  
**File:** `apps/web/app/recovery/page.tsx:818`  
**What to build:** Remove the `showStrataConvert={recoveryType === "strata_conversion"}` prop. Derive visibility directly from `hasStrataParent` on the candidate data. Add a "1 workflow available" indicator next to the `mismatch.strata_parent_still_rated` signal badge so officers know a click-through action exists regardless of which filter is active.  
**Why it matters:** The strata Convert button is the highest-value single action in the product — it triggers the workflow to reclassify a parent assessment into N child CTs before the next levy run. It is currently invisible unless the user has specifically selected the Strata Conversion filter AND the warn-600 Tailwind bug is fixed. Actions surface from data, not filter modes.  
**Effort:** 0.5 days  
**Gauntlet finding closed:** Recovery Dashboard W7 + F2  
**Ratio:** 8

---

### #6 — Address-normalisation consistency in the concession audit section

**Feature:** Scoring and Signal Engine  
**File:** `packages/recovery-engine/src/evidencePack.ts:514-517`  
**What to build:** Replace `.toLowerCase().includes()` address comparison with `normaliseAddress()` — the function already exists in the same file. One-line fix.  
**Why it matters:** The concession audit section is the evidence a council's legal team reads before suspending a pensioner's rebate. The `id.pensioner_not_at_property` signal fires using `normaliseAddress()`, but the pack's "Match" column uses `.includes()`. When the two produce different answers — which they can for abbreviated suburb names or transposed unit/street order — the pack is internally contradictory. A legal reviewer will flag it and lose confidence in the entire platform.  
**Effort:** 0.25 days  
**Gauntlet finding closed:** Scoring Engine W4  
**Ratio:** 8

---

### #7 — Add `loading.tsx` skeleton to the evidence pack route

**Feature:** Evidence Pack (per-property)  
**File:** Create `apps/web/app/recovery/[assessment]/loading.tsx`  
**What to build:** A three-panel skeleton matching the page's structure: grey stats card, grey map placeholder with "Visual evidence" label, three collapsed grey accordion rows. Renders immediately from Next.js App Router before any server data fetches.  
**Why it matters:** The page is a pure async Server Component that calls `getEvaluationContext()` synchronously during render. On a cold Postgres path the entire page tree stalls for 1–5 seconds showing a blank white screen. Council officers on council-grade laptops over VPN notice this immediately.  
**Effort:** 0.25 days  
**Gauntlet finding closed:** Evidence Pack BUG-5 (no loading state)  
**Ratio:** 8

---

### #8 — Discriminated HTTP error responses for `no_owner` and `no_state_template`

**Feature:** Evidence Pack Generator (Backend)  
**Files:** `apps/web/app/api/evidence/[file]/route.ts` · `apps/web/app/api/evidence/[file]/pdf/route.ts`  
**What to build:** Map each `EvidencePackResult` kind to a distinct HTTP status and structured body: `no_owner` → 422 with `{ code: "owner_missing", actionRequired: "Reconcile owner record in the rating system before generating this pack." }`. `no_state_template` → 501 with `{ code: "jurisdiction_unsupported", supportedStates: ["WA", "NSW", "QLD"] }`. Three-branch addition to the result handler.  
**Why it matters:** Currently both states return a 404 with a generic "Evidence pack not available" message, indistinguishable from "assessment number does not exist." A clerk who hits `no_owner` will waste time verifying the assessment number. A non-WA council will see a dead-end with no explanation. Distinct status codes allow the UI to render distinct, actionable messages.  
**Effort:** 0.5 days  
**Gauntlet finding closed:** Evidence Pack Generator F1 + F2  
**Ratio:** 8

---

### #9 — PDF-specific rate limit keyed on `(tenantId, userId)`

**Feature:** Evidence Pack Generator (Backend)  
**File:** `apps/web/app/api/evidence/[file]/pdf/route.ts`  
**What to build:** Add a `rateLimitComposite({ tenantId, userId })` check at the top of the PDF route handler, before context hydration. Max 5 PDFs/minute per user. Reuse the existing `rateLimitComposite` helper — zero new infrastructure.  
**Why it matters:** pdfkit renders synchronously on the Node.js main thread. A burst of 20 concurrent PDF requests will each build a full `EvaluationContext`, run `renderEvidencePdf`, and hold the resulting ~500KB Buffer in memory before flushing. At serverless concurrency limits this can exhaust available memory before the IP rate limiter notices. The PDF path is an order of magnitude more expensive than the `.md`/`.html` path.  
**Effort:** 0.25 days  
**Gauntlet finding closed:** Evidence Pack Generator W5  
**Ratio:** 7

---

### #10 — Persistent URL state for all filter dimensions on the Recovery Dashboard

**Feature:** Recovery Audit Dashboard  
**File:** `apps/web/app/recovery/page.tsx:242-276`  
**What to build:** Encode `severity`, `recoveryType`, `signalFilter`, and page `offset` into the URL query string using `router.replace` (not `push`). Make the encoding bidirectional: reading URL params on mount sets filter state, state changes write URL params. The `?signal=` initial-value path already partially does this — make the full system consistent.  
**Why it matters:** A clerk running a "Concession review" batch who drills into a candidate and presses Back lands on `/recovery` with all filters reset to defaults. For a council with 40 concession candidates this means 39 extra clicks and 39 context resets per triage session. Every filtered view also becomes bookmarkable and shareable — a manager can send `?recoveryType=cadastre_lag&severity=high` to a clerk and they land in exactly the right queue.  
**Effort:** 1.5 days  
**Gauntlet finding closed:** Recovery Dashboard W4 · Evidence Pack FLOW-1  
**Ratio:** 5.3 (composite, counts back-navigation fix on both features)

---

## 4. Things to Cut

The following elements add complexity without commensurate value at the current phase. Remove them before the M7 pilot to reduce maintenance surface and cognitive overhead.

1. **`estimateUplift` deprecated alias** (`packages/recovery-engine/src/scoring.ts`). It is re-exported as a deprecated alias for `estimateUpliftHeuristic` but is still imported by `evidencePack.ts`. Every reference to a deprecated alias inside the same package is a lie the TypeScript compiler accepts silently. Remove the alias; update the one import to `estimateUpliftHeuristic`. Cost: minutes. Gain: the codebase means what it says.

2. **The `renderHtmlPack` regex pipeline (~130 lines)** in `apps/web/app/api/evidence/[file]/route.ts`. The code comments its own renderer as pre-production ("Will be replaced by a sanitizer-backed library before any production deploy"). The TODO should be a deploy gate, not a comment. Replace the 130-line regex pipeline with `unified().use(remarkParse).use(remarkRehype).use(rehypeSanitize).use(rehypeStringify)` — approximately 10 lines. This fixes consecutive-blockquote fragmentation and double-escaping of `&` in ABN strings simultaneously.

3. **The `!pack` binary branch in the evidence pack page** (`apps/web/app/recovery/[assessment]/page.tsx:46`). Replace with the exhaustive `switch` described in Recommendation #4. A binary branch will silently fall through when new discriminated-union variants are added. An exhaustive switch produces a TypeScript type error when a variant has no branch — future-proofing for free.

4. **`LiveGrantsWidget` on the `/recovery` page.** It is a second data source, a second loading state, a second error state, and a second API call on a page that already loads a full candidate set. The grants feed belongs on `/alerts`. On `/recovery` it interrupts the triage workflow. Move it to a collapsible sidebar panel or remove it from this page entirely.

5. **The `overtaxedCandidates` non-enumerable property pattern** on the `findMismatches` return array. Attaching typed data as a non-enumerable property on an array breaks every standard consumer — JSON serialisation, spread, `Array.from`. Return a plain object `{ candidates, overtaxedCandidates }` when the overtaxed surface is added to the UI. The current shape was a workaround; it should be retired when the feature ships.

6. **`getProperty(assessment)` fallback call on the non-ok path** (`page.tsx:47`). This call only drives the binary error UI. Once the exhaustive discriminated switch (Recommendation #4) is in place, this call and its import are dead code.

7. **`DEFAULT_NOW` module-private closure** in `evidencePack.ts`. It is `new Date()` behind a name. The indirection adds a named export that tests do not use (they inject via `options.now`). Inline it.

8. **Duplicated `formatAud` function** in `evidencePdf.ts` and `apps/web/lib/utils.ts`. One source of truth; import from shared utils.

---

## 5. Jaw-Drop Roadmap

Three features that would make a council director demo this to peers.

---

### JD-1 — One-click statutory notice drafter

An officer reviews an evidence pack, confirms they are satisfied with the evidence, and clicks "Draft notice." In two seconds the platform produces a complete, formally worded rate-notice pre-populated with the council's letterhead, the proprietor's name and postal address, the specific tenement grant date, the computed liability, the backdating calculation, the statutory basis (LGA s.6.76 or Rates and Charges (Rebates and Deferments) Act 1992 for concessions), and the officer's name. The officer reads it in 15 seconds, makes one edit, and exports it as a PDF. The PDF embeds a unique, council-verifiable integrity hash.

**Why this jaw-drops:** "The system wrote the notice." A task that takes a rates officer 15–30 minutes per property collapses to 45 seconds. A council director who sees this demo forwards it to every rates officer in the state.

**Implementation path:** A `/api/evidence/[assessment]/notice` route that interpolates pack data into a statutory notice template per jurisdiction. No LLM required for v1 — pure template interpolation from fields already in the evidence pack. Layer LLM refinement in v2 once the template is validated on pilot data.

---

### JD-2 — Cryptographic PDF non-repudiation layer

Every generated PDF embeds a unique SHA-256 hash of its content and an HMAC signed with `(tenantId + packId + userId + timestamp)`. The hash appears in the PDF footer as a human-readable reference ("Document integrity ref: a3f7c2d8") and is stored in the audit log. A council's legal team can verify any downloaded pack by posting the PDF bytes to a public `/api/verify` endpoint that re-derives the hash and confirms a match against the audit row.

**Why this jaw-drops:** When a ratepayer's solicitor challenges the evidence six months later, the council produces the PDF and a one-line API confirmation that the document is unmodified since generation. No other LGA software platform has ever provided this. A council director pitching this to their audit committee calls it "statutory-grade evidentiary integrity that survives a rates tribunal challenge."

**Implementation path:** Post-render SHA-256 of the `Buffer`, HMAC with an operator secret, embed in PDF `Info` dict and footer. Audit row stores the hash. Public verification endpoint: `POST /api/verify/pack` with PDF bytes, returns `{ match: true, generatedAt, operatorId, assessmentNumber }`.

---

### JD-3 — Overtaxed-ratepayer surface with automatic council liability flag

The recovery engine already computes `overtaxedCandidates` in `findMismatches` and attaches them as a non-enumerable property on the result — the data is there, invisible to any UI. Add a second section below the recovery candidate list: "Properties the engine identifies as possibly over-rated — estimated overpayment $Y across X properties." Use a muted blue visual treatment (not red/amber) to distinguish this as a "review and refund" workflow from the amber "recover" workflow.

**Why this jaw-drops:** Discovering that a council is overtaxing ratepayers is a material governance finding, a financial liability, and a reputational risk. A council director who sees this surfaced proactively — not after a ratepayer complaint — will forward the screenshot to their CEO. It proves the platform has integrity, not just revenue motivation. No other rates-recovery tool in Australia proactively surfaces this.

**Implementation path:** Expose `overtaxedCandidates` from the `findMismatches` return as a proper typed field (converting from the non-enumerable pattern — see Things to Cut #5). Add the stat card and candidate list section in `/recovery/page.tsx`. Link to the same evidence pack flow.

---

## 6. Quick Wins

Items completable in under one day, ordered by impact/effort ratio. Ship these as a single branch this week — they require no architectural change and zero new dependencies.

| Priority | Item | File(s) | Effort | Ratio | Gauntlet Ref |
|:---:|---|---|:---:|:---:|---|
| 1 | Fix PDF context isolation — replace `getEvaluationContext()` | `pdf/route.ts:91` | 0.25d | 10 | Backend W1 |
| 2 | Fix Tailwind warn color stops — add warn-100 through warn-600 | `tailwind.config.ts:41-45` | 0.5d | 9 | Dashboard W1 |
| 3 | Fix PDF operator name regex — restore spaces in attestation | `evidencePdf.ts:94` | 0.25d | 9 | Pack BUG-3 |
| 4 | Discriminated error states — switch on `result.kind` | `[assessment]/page.tsx:46` | 0.5d | 9 | Engine W3 · Pack BUG-1 |
| 5 | Address-normalisation consistency in concession audit | `evidencePack.ts:514` | 0.25d | 8 | Engine W4 |
| 6 | Add `loading.tsx` skeleton to evidence pack route | `[assessment]/loading.tsx` (new) | 0.25d | 8 | Pack BUG-5 |
| 7 | Always-visible Strata Convert button | `recovery/page.tsx:818` | 0.5d | 8 | Dashboard W7 |
| 8 | Discriminated HTTP error responses (`no_owner` → 422, `no_state_template` → 501) | `[file]/route.ts` · `pdf/route.ts` | 0.5d | 8 | Backend F1+F2 |
| 9 | PDF-specific rate limit `(tenantId, userId)` | `pdf/route.ts` | 0.25d | 7 | Backend W5 |
| 10 | Fix signal count badge — candidates not firings | `recovery/page.tsx:559` | 0.25d | 5 | Dashboard W6 |

**Total effort for all ten quick wins: 3.5 engineering days.**  
**Score projection after quick wins:** Dashboard 59→73 · Pack 65→81 · Engine 75→85 · Backend 68→88.

---

## Source Reports

Individual feature reports at:
- `elevate/recovery-audit-dashboard-recovery--elevation.md`
- `elevate/evidence-pack-per-property-recovery-assessment--elevation.md`
- `elevate/scoring-and-signal-engine-ratesassist-recovery-engine-package-elevation.md`
- `elevate/evidence-pack-generator-backend-api-evidence-file-api-evidence-file-pdf-elevation.md`
- `elevate/feature-map.md`

---

*End of master elevation report. Recommended first action: ship the ten quick wins as a single branch `fix/elevation-quick-wins` (3.5 days). No merge without sign-off from Brodie.*
