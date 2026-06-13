# RatesAssist — Edge-Sharpening Research (WA)

> Deep research across 6 vectors (law, data, methodology, competition, revenue scope, product/AI) to find what's **beyond** a self-taught 20-year WA rates expert's tacit knowledge. Synthesised 2026-06-05 from 6 parallel primary-sourced agents (~90 sources). Every $ figure flagged **(S)** sourced or **(I)** illustrative. Nothing fabricated.

---

## The reframe (what this is really about)

The expert's edge is **20 years of parcel-level pattern recognition in the mining mis-classification niche**. It is real and it makes $30–50M/yr. But self-taught, niche-anchored, tacit knowledge has three structural blind spots — and that's exactly where "what's out there" lives:

1. **She finds errors one parcel at a time, by eye.** The world has *systemic statistical* methods (IAAO ratio studies) that find **category-level** under-assessment across 100k parcels at once — errors invisible to manual review.
2. **She cross-references the datasets she knows** (DMIRS, Landgate). There are **10+ more free WA-gov signal datasets** she isn't systematically joining.
3. **She's anchored to mining.** There are **12+ other recoverable-revenue categories** — and the *biggest single one (supplementary-valuation gaps) isn't mining at all*, plausibly $30–60M/yr sector-wide.

Plus two meta-risks: her knowledge lives **in her head** (key-man risk), and every recovery must **survive a SAT challenge** (defensibility science). The five edges below close all of this.

**Honest grounding:** RatesAssist already encodes a lot of this (33+ signals incl. EPA approvals, aerial change, construction-completed, a rural outlier, 5 pensioner signals, the 5-year cap). The research *validates* the build and isolates what's genuinely net-new. This doc marks **[NEW]**, **[DEEPEN]** (have it, can sharpen), **[HAVE]** (validated).

---

## Two facts to act on immediately

### FACT 1 — Confirm the back-rating citation: s.6.39 vs s.6.81 (legal)
`upliftCalculator.ts` correctly caps at **5 years statutory / 3 years conservative** and surfaces both — good and honest. But `evidencePack.ts` cites **LGA s.6.81** ("rates that ought to have been imposed"). The legal deep-dive found the rate-record amendment power is **LGA s.6.39(2)** — *"may amend the rate record for the 5 years preceding the current financial year"* — confirmed against Hansard on the 2025 mining-licences Bill ("the five preceding years … under section 6.39"). **Action:** WA-lawyer confirm which section authorises back-rating (likely s.6.39 for the amendment + s.6.81 for recovery of the debt). A wrong section citation in an evidence pack is a SAT-objection gift. **Queued — legal, not a blind code change.**

### FACT 2 — Build a miscellaneous-licence legal-status GUARD [NEW, trust-critical]
*Shire of Mount Magnet v Atlantic Vanadium* [2025] WASC 274 held occupied **miscellaneous licences** rateable — but the **Local Government Amendment (Rating of Certain Mining Licences) Bill 2025** (passed Legislative Assembly 13 Nov 2025; Council debate adjourned) would *retroactively extinguish* misc-licence rates **FY2017-18 → FY2025-26** and force **refunds within 28 days**. **If RatesAssist flags misc-licence back-rates and that Bill becomes law, we hand a council a refund liability, not a recovery.** Action: a `legalStatus` field per exemption/tenure category in the signal registry; suppress misc-licence recovery flags until Royal Assent status is confirmed. Track the Bill. **This is the single most important honesty guardrail surfaced.**

---

## EDGE 1 — Statistical detection: IAAO ratio studies [NEW — biggest methodological unlock]

Self-taught practitioners find outliers they *notice*. IAAO assessment-quality science finds **distributional** errors across the whole roll, with court-defensible thresholds. None of this is in the product today (we have one single-parcel outlier signal, `spat.outlier.high_value_rural`).

| Metric | What it finds | IAAO threshold (verified) |
|---|---|---|
| **Sales-ratio / median ASR** | Category assessed above/below market | median 0.90–1.10 |
| **COD** (Coefficient of Dispersion) | *Non-uniformity* within a category → hidden mis-classified parcels dragging spread | residential 5–15; other-residential 5–20; **vacant land 5–25** |
| **PRD / PRB** | *Vertical inequity* — high-value parcels under-assessed (exactly the mining/industrial-hiding-in-rural pattern) | PRD 0.98–1.03; PRB −0.05…+0.05 (action outside ±0.10) |
| **Mass appraisal / CAMA delta** | Model-predicted value − assessed value, for *every* parcel (sold or not) | top-decile delta = lead list |

**Why it's the edge:** a WA council's rural-category COD is almost certainly ~35–40 (no formal ratio study exists). BC Assessment runs rural at **14**. That gap is simultaneously (a) a detection method that finds what manual can't, and (b) a killer governance/sales artifact.

**Build:** an **"Assessment Roll Quality Report"** (the MPAC / BC Assessment model) — per-council COD/PRD/PRB per category, every cycle. *No WA council currently receives this.* It reframes RatesAssist from "found money" to "rating-integrity assurance" (procurement-friendly; speaks to OAG audit findings — see Edge 5). Proven at scale: Cook County's ML mass-appraisal shifted **$350M** of burden off homeowners and *"regressivity almost entirely disappeared"* (Univ. of Chicago).

---

## EDGE 2 — New data signals (the data edge)

Each free WA/AU dataset is a signal that real use ≠ rated category. Ranked highest-signal × lowest-cost first.

| # | Source | Signal | Access | Status |
|---|---|---|---|---|
| 1 | **DMIRS MINEDEX/DMIRS-003 (extended)** — producing status, commodity, tonnage; daily | producing tenement rated rural | free WFS / DASC; CC-BY(-NC) | **[DEEPEN]** core, pull production fields |
| 2 | **EPA Part V prescribed premises** (DWER Environment Online) | any active industrial licence on rural/vacant = very high-confidence | search-only (scrape or FOI extract) | **[DEEPEN]** have `reg.environmental_approval_active`; widen to all 89 categories |
| 3 | **Clean Energy Regulator LRET register** (monthly CSV) | wind/solar farm on rural UV | free; ABR cross-match for address | **[NEW]** fast-growing in WA |
| 4 | **ABR Business Location File** (govt-agency bulk) | active ABN at "vacant" parcel | free, govt eligibility | **[NEW]** universal screen; unlocks all cross-refs |
| 5 | **ACMA RRL** (`spectra_rrl.zip`, daily, coords) | telco/industrial radio site on rural/residential | free daily bulk | **[NEW]** authoritative tower source |
| 6 | **DWER water-abstraction licences** | irrigation/industrial water use = not vacant | Water Register; bulk fee-based | **[NEW]** negotiate govt extract |
| 7 | **WAPIMS petroleum/geothermal titles** | petroleum title on pastoral UV | GeoVIEW/SLIP | **[NEW]** |
| 8 | **ABARES/DPIRD ALUM land-use** | ALUM "intensive use"/"irrigated ag" vs rural rating | free CC-BY; one-time spatial join | **[NEW]** static reference layer |
| 9 | **Landgate transfers / sale-price** | sale ≫ GRV/UV = market sees value rating doesn't | paid Landgate data | **[NEW, paid]** queue |

**Entity resolution [DEEPEN]:** we have `id.industry_indicator_in_owner_name` (string match). The upgrade is a **graph**: title proprietor (ACN) → ASIC officers/shareholders → ultimate controller; flag *industrial/mining ultimate owner on rural-rated land*. (AU has no public UBO register yet — ASIC chain-walk or approved-broker API.)

---

## EDGE 3 — New revenue categories beyond mining (the scope edge)

Ranked by recoverable-$ × ease. **The #1 is bigger than mining and we already have the seed signal.**

| Rank | Category | WA statewide (I unless noted) | Ease | Status |
|---|---|---|---|---|
| 1 | **Supplementary-valuation gaps** — new build/extension not captured between GRV cycles; council misses the 3-mo (metro)/6-mo (regional) interim-valuation window | **$30–60M/yr** (I) | High | **[DEEPEN]** have `change.construction_completed`; build the **"Completion-Gap Scanner"** (permits × Landgate roll) |
| 2 | **STRA / short-stay** rated residential, operating commercial | $1.6–2.4M (I); **11,556 registered (S)** | High | **[NEW]** STRA register live since Jan 2025 — afternoon reconciliation |
| 3 | **Caravan/tourist parks** rated UV rural | $2–5M (I) | High | **[NEW]** councils hold the licences |
| 4 | **Charitable/Crown exemption leakage** ("exclusively" test; commercialised charities) | $2–10M (I) | Med-High | **[NEW]** stale-exemption auditor vs ACNC + planning |
| 5 | **FIFO accommodation villages** — s.6.29 12-month capital-improvements GRV trigger never applied | $1–3M (I) | Med | **[DEEPEN]** direct mining adjacency; her sweet spot |
| 6 | **Renewable energy** on rural UV | $2–5M (I) | Med | **[NEW]** (see Edge 2 #3) |
| 7 | **Pensioner-rebate leakage** (moved/deceased/commercial-use) | $1–3M (I); 2019 OAG: validation **stopped 2005 (S)** | Med | **[HAVE]** 5 pensioner signals already — STRA cross-check is new & tractable |
| 8 | **Interest/penalty under-application** (below the 11% statutory max) | variable, $1–5M+ (I) | High | **[NEW]** pure internal-ledger, zero external data |
| 9 | Intensive ag (DWER), telco towers (ACMA), mineral processing on freehold, vacant-developer/subdivision lag, strata mixed-use | $0.5–2M each (I) | Med | **[NEW/DEEPEN]** |

---

## EDGE 4 — Under-used legal levers

- **5-year back-rating cap** [HAVE] — keep surfacing 3y-conservative + 5y-statutory; confirm s.6.39 (Fact 1).
- **Interim-valuation windows** [DEEPEN] — 3-mo metro / 6-mo regional submission cap; missing it forfeits backdated yield → the Completion-Gap Scanner.
- **Mining capital-improvements GRV trigger (s.6.29)** [DEEPEN] — 12-month rule for accommodation/admin/workshops → FIFO-village module.
- **Charitable "exclusively" exemption audit** [NEW] — once granted, never reviewed; SAT applies "exclusively" strictly.
- **s.36 general-interest review** [NEW] — challenge *systemic* under-valuation across a whole district in one SAT action, not parcel-by-parcel. Almost never used.
- **Differential-category mis-assignment (s.6.33)** [NEW] — zoning/use changed, category didn't; back-rate 5y.

---

## EDGE 5 — Moat + defensibility (so the edge outlives one person)

- **Knowledge elicitation [NEW]:** run **Critical Decision Method** interviews on 20–30 of her past recoveries + think-aloud sessions → populate a **Signal Registry** (each signal: definition, evidence type, known false-positive, provenance) + **Case Vault**. Add a **human-in-the-loop labelling queue** so the system learns from her every day and keeps improving after she's gone. *Turns the moat from a person into an institutional asset.*
- **Expert-system → ML path:** rules now (explainable, defensible) → supervised model at 500+ labels → CV change-detection → agentic monitoring. Don't rush past the defensible-rules stage.
- **SAT-defensibility architecture [DEEPEN]:** evidence packs exist; add (a) **data-provenance chain** on every claim (source authority + access method + data-cut date), (b) **SHAP per-feature weights** on any ML flag, (c) **reproducibility** (replay logic on the data snapshot), (d) **natural-justice notice** draft in the case file (28-day method-change / 42-day s.6.76 windows). Roll presumed correct under VoLA s.26(5) — the challenger bears the practical onus, so a complete pack wins.
- **Governance framing [NEW]:** WA OAG 2024-25 audits flag *"inadequate review of changes in rates systems"* and *"undercharging ratepayers."* Position RatesAssist as a **rating-integrity control** that closes a named audit finding — not just found-money. Easier procurement, board-friendly.

---

## Competitive truth + go-to-market

**Global white space:** no firm offers AU councils **AI-driven, proactive, success-fee classification recovery.** Valuation firms (Opteon, Acumentis/Hegney, HTW) do *reactive* statutory valuations or *owner-side* objections. ERPs (TechOne, ReadyTech/SynergySoft — WA-dominant, has mining-tenement rate modelling) hold the data but have **no anomaly layer**. Data players (Nearmap, Cotality, Geoscape) are *inputs*, not competitors. UK (Colliers, Gerald Eve) and US (Ryan, O'Connor, Ownwell) contingency firms all work the **owner side** (cutting assessments) — the exact inverse. 

- **Only medium-term threat:** TechnologyOne builds an anomaly layer natively (their AI today is resident-services-only). Mitigation: deep WA-regulatory moat + become the standard first; position as an *analytics layer on top of TechOne/ReadyTech*, never a replacement.
- **GTM unlock:** **WALGA Preferred Supplier Program** panel **PSP003-001 (Valuation Services)** → engage any of 138 WA councils without full tender. Prioritise accreditation.
- **Contingency legality:** the 25% legal-fee uplift cap is for *legal* services; commercial success-fee service contracts to councils are viable (US "tax-ferret" precedent). Confirm contract structure under the WA LG Act. **Queued — legal.**

---

## Recommended build roadmap (reversible-first)

1. **[NEW] Misc-licence legal-status guard** (Fact 2) — small, trust-critical, do first.
2. **[NEW] IAAO Roll-Quality module** (COD/PRD/PRB per category) + Assessment Roll Quality Report — the biggest net-new edge; pure functions (like the intersection work), highly testable.
3. **[DEEPEN] Completion-Gap Scanner** (supplementary-valuation gaps) — the largest $; we have the seed signal.
4. **[NEW] STRA reconciler** + **[NEW] interest-accrual checker** — highest effort:recovery ratio, low data friction.
5. **[NEW] Signal-catalogue additions** — LRET/renewables, caravan parks, telco (ACMA), exemption-staleness, intensive-ag.
6. **[DEEPEN] Entity-resolution graph** + **[NEW] data adapters** (ABR, ACMA RRL, LRET, ABARES ALUM).
7. **[Process] CDM knowledge-elicitation** sessions with the expert → Signal Registry/Case Vault.

---

## Queued (paid / legal / contract / human)

- **Legal:** s.6.39-vs-s.6.81 back-rating citation; misc-licence Bill Royal-Assent status; success-fee contract structure under WA LG Act; council standing to initiate a Landgate review.
- **Paid data:** Landgate transfers/sale-price + valuation bulk; DWER water-licence govt extract; ABR govt-agency bulk eligibility; Nearmap commercial imagery (cm-scale change detection); MINEDEX CC-BY-**NC** commercial-use confirmation for council work.
- **Access:** SLIP free account for login-gated layers (DPLH-083 pastoral, etc.).

---

## Sources
~90 primary sources across the 6 agents — legislation.wa.gov.au (LGA 1995, VoLA 1978), DLGSC rating policies, Landgate, SAT, WA OAG, IAAO Standards (Ratio Studies, Mass Appraisal), BC Assessment, MPAC, UK VOA Rating Manual, data.wa.gov.au / SLIP, CER, ACMA, ABR, ABARES, WALGA PSP, Lincoln Institute, Cook County. Full URLs in the per-agent research outputs (run 2026-06-05).
```
