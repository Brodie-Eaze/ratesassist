<!--
  ╔═══════════════════════════════════════════════════════════════════╗
  ║                          R A T E S A S S I S T                    ║
  ║      Product Requirements Document — Vertical AI for WA rates      ║
  ╚═══════════════════════════════════════════════════════════════════╝
-->

# RatesAssist — Product Requirements Document (PRD)

| | |
|---|---|
| **Product** | RatesAssist — AI-native rating-integrity & revenue-recovery platform for Australian local government |
| **Document** | Product Requirements Document |
| **Version** | 1.0 |
| **Date** | 2026-06-06 |
| **Owner** | Brodie (founder) |
| **Status** | Draft for pilot — engineering pilot-ready; go-live gated on human approvals (deploy, legal, data) |
| **Initial market** | Western Australia (WA) councils. Multi-state is parked, kept as reversible off-by-default code. |
| **Companion docs** | `README.md` (engineering overview) · `internal/EDGE-SHARPENING-WA.md` (strategy + research) · `internal/EDGE-DATA-STRATEGY-WA.md` (data) · `~/HQ/ratesassist/goals/active.md` (live milestones) |

---

## 1. TL;DR

WA councils lose **tens of millions of dollars a year** to property that is **mis-classified for rating** — most visibly, producing mining tenements still rated "rural" or "vacant" on the unimproved-value basis. The expertise to find this leakage is rare, tacit, and manual (one expert recovers $30–50M/yr by hand). **RatesAssist productises that expertise**: it cross-references the council's rating roll against authoritative registers (DMIRS, Landgate, ABR, EPA, environmental and aerial feeds), scores each parcel against a catalogue of weighted detection signals, quantifies the recoverable rates within the statutory back-rating limit, and renders a **council-grade, challenge-proof evidence pack** ready to issue. Commercially it runs on a **success fee** on recovered revenue — zero cost to the council until money is found.

This PRD defines what the product is, who it serves, what it must do, the bar it must meet (security, privacy, compliance, scale), how we measure success, and what remains gated on human action.

---

## 2. Problem & opportunity

### 2.1 The problem
- WA rates are levied on a value basis the **Valuer-General sets** (Landgate) under the *Valuation of Land Act 1978*: **GRV** (Gross Rental Value — most urban/commercial property) or **UV** (Unimproved Value — rural, pastoral, mining). The council *receives* the value and applies its rate-in-the-dollar.
- The basis applied to a parcel is set by its **predominant use** and is **rarely re-reviewed after assignment**. When use changes (a tenement starts producing, a shed becomes a processing plant, a paddock becomes a solar farm), the rating **lags for years**.
- Detecting the lag requires cross-referencing **registers that don't talk to the rating system** (DMIRS tenements, Landgate cadastre, EPA licences, ABR business records) — specialist work that few councils do systematically.
- The result is a structural revenue gap, an **equity problem** (correctly-rated ratepayers subsidise the gap), and a **governance finding** (the WA OAG flags "inadequate review of changes in rates systems").

### 2.2 Why now
- WA government registers are increasingly **machine-readable** (DMIRS MINEDEX/SLIP daily; data.wa.gov.au open data; ABR bulk; ACMA daily).
- **AI** makes the cross-dataset join + the defensible-evidence generation tractable at council scale (100k+ parcels) for the first time.
- The recovery expertise is **key-person-dependent and self-taught** — formalising it into software is both a moat and a continuity insurance.

### 2.3 The opportunity (sizing — directional)
- WA local government collected **~$2.948B** in rates (ABS, 2023-24). Even **1–2% systematic leakage = $29–60M/yr** recoverable across the sector.
- Mining mis-classification is the headline wedge; the research surfaced **12+ additional recoverable categories** (supplementary-valuation gaps — plausibly the single biggest — STRA/short-stay, renewables on rural land, FIFO villages, exemption leakage, etc.).
- **Global white space:** no competitor offers AU councils **proactive, AI-driven, success-fee classification recovery.** (Valuation firms do reactive statutory valuations; ERPs hold the data but no anomaly layer; UK/US contingency firms work the *owner* side — the inverse.)

---

## 3. Goals & non-goals

### 3.1 Goals (v1, WA pilot)
1. **Detect** mis-classified parcels in a council's roll with high precision and an auditable reason for every flag.
2. **Quantify** the recoverable rates per candidate, bracketed by the **statutory back-rating limit**, with the full formula trail.
3. **Defend** every recovery: an evidence pack that survives a Landgate objection / State Administrative Tribunal (SAT) challenge.
4. **Operate** at officer scale (thousands of concurrent users) on AU-resident infrastructure, with tamper-evident audit and multi-tenant isolation.
5. **Win the pilot:** prove recoverable $ on a real council's data and convert to a success-fee engagement.

### 3.2 Non-goals (v1 — explicitly out)
- **Replacing the council ERP** (TechOne, ReadyTech/SynergySoft). RatesAssist is an **analytics + evidence layer on top**, never a system-of-record swap.
- **Automatically issuing** reclassifications or back-rate notices. The system **computes and instructs; a human officer acts.** (Natural-justice + Valuer-General independence make full autonomy inappropriate.)
- **Public ratepayer chat at 50k concurrent** (RatesChat) — a separate later goal; do not over-build for it now.
- **Multi-state expansion** (SA/QLD/NSW/VIC) — parked; reversible off-by-default adapters only.
- **Moving money.** RatesAssist never touches a council's ledger or banking.

---

## 4. Target users & personas

| Persona | Who | Primary job | What they need |
|---|---|---|---|
| **Rates Officer** | Day-to-day council rates staff (works *in* TechOne/SynergySoft) | Find + action mis-rated parcels without manual cross-referencing | A ranked candidate list, one-click evidence pack, plain explanations |
| **The Expert** | Senior, often self-taught rates specialist (the $30–50M/yr recoverer) | Encode 20 years of tacit heuristics; triage edge cases | A signal catalogue that captures her rules; a human-in-the-loop review queue |
| **Council CFO / Executive** | Finance/exec sponsor | Defensible revenue uplift + rating-integrity governance | Roll-quality reporting (IAAO), recovery pipeline $, OAG-aligned assurance framing |
| **Council ICT / Procurement / Audit** | The buyer's gatekeepers | Approve a vendor on security, privacy, residency | SECURITY/PRIVACY posture, AU residency, audit trail, DPA, tenant isolation evidence |
| **Operator (founder/ops)** | Runs the platform + pilots | Onboard a council, run a recovery cycle, stay compliant | Runbooks, observability, the approval queue for irreversible steps |

---

## 5. Jobs-to-be-done

- *When* a producing tenement sits on rural-rated land, *I want* to be told which parcel, why, and how much is recoverable over how many years, *so I can* issue a defensible reclassification.
- *When* a CFO asks "is our roll fair and complete," *I want* an IAAO roll-quality report per category, *so I can* answer with a number a regulator accepts.
- *When* a recovery rests on contested law (e.g. a miscellaneous licence), *I want* a clear legal-risk warning before I act, *so I don't* hand the council a refund liability.
- *When* a ratepayer objects, *I want* a reproducible, source-cited evidence pack, *so I can* defend the position at SAT.

---

## 6. Product overview — the three pillars + the edge

```
   DETECTION              →        EVIDENCE              →        RECOVERY
 33+ weighted signals          council-grade pack            uplift × rate-in-$
 DMIRS × Landgate ×            formula trail + source        bracketed by the
 ABR × EPA × aerial            URL + caveats + legal         5-year statutory
 + IAAO roll-quality           risk callouts                 back-rating cap
```

**The intelligence edge (what a self-taught manual practitioner can't do at scale):**
- **Live register data** — DMIRS tenement features fetched live and intersected against parcels (not seeded fixtures).
- **IAAO assessment-quality science** — Coefficient of Dispersion / PRD / PRB ratio studies that find *systemic, category-level* under-assessment across the whole roll, with court-defensible thresholds — surfaced as an **Assessment Roll Quality report** no WA council currently receives.
- **Legal-risk guards** — contested-law recoveries (e.g. miscellaneous licences under the 2025 Bill) carry a prominent warning before they're pursued.
- **Defensibility by construction** — provenance on every claim, no silent fabrication, statutory caps enforced.

---

## 7. Functional requirements

### 7.1 Data ingest
- **FR-IN-1** Ingest a council's rating roll (assessment №, address, suburb, land-use category, GRV/UV valuation, annual rates, owner). v1 via **CSV export** from TechOne/SynergySoft; REST adapter is Phase 2.
- **FR-IN-2** Pull **live** authoritative registers: DMIRS MINEDEX + SLIP/ArcGIS tenements (LIVE), ABR ABN status (live with credential), with honest fallback to seeded fixtures when a credential/DSA is absent — never a silent fake.
- **FR-IN-3** Every external source carries a **status label** (LIVE / STUB / PLANNED) visible in `/connections` and in the contract types.

### 7.2 Detection engine
- **FR-DET-1** Evaluate each property against the **signal catalogue** (33+ weighted, sourced signals): producing-tenement-on-rural, DMIRS-ahead-of-Landgate, recent-grant appeal window, environmental approval, address mismatch, cancelled ABN, subdivision/construction change, pensioner-rebate leakage, spatial outlier, strata mis-allocation, etc.
- **FR-DET-2** Compose signals into a **composite confidence score** with exclusive-group constraints (one tenement-class signal per property) and severity bands (high ≥ 0.60 / medium ≥ 0.35 / low ≥ 0.15).
- **FR-DET-3** **Live spatial intersection** — map live tenement geometry → parcels (ray-cast point-in-polygon) to populate `intersectsAssessmentNumbers`, flag-gated (`RA_LIVE_TENEMENTS`, default off, DB fallback on any failure).
- **FR-DET-4** **IAAO roll-quality** — compute per (land-use × suburb) stratum dispersion (COD) vs the IAAO band; flag exceeding strata with their outlier parcels; guard under-sampled strata (< IAAO minimum). Market-calibrated COD/PRD/PRB engine ready for sale-price data.

### 7.3 Recovery quantification
- **FR-REC-1** Compute recoverable uplift = (correct basis − current) × rate-in-the-dollar, routing through the council's **published differential-rate table** when available; explicitly mark heuristic fallback when not.
- **FR-REC-2** Bracket backdated arrears by **both** a conservative (3-year) and the **statutory (5-year)** back-rating ceiling. *(WA LGA 1995 — exact section pending legal confirmation: code cites s.6.81; research indicates s.6.39(2) "5 preceding years" is the rate-record amendment power. Surface both figures honestly; do not over-claim.)*
- **FR-REC-3** Never fabricate: missing rate table / stale GRV / invalid date → typed error + `heuristic` flag, never a guessed number.

### 7.4 Evidence & defensibility
- **FR-EV-1** Render a **council-grade evidence pack** per candidate: property ID, owner of record, fired signals with evidence strings + source URLs, the formula trail, title state, and caveats.
- **FR-EV-2** **Legal-risk callouts** at the top of the pack for contested-law recoveries (miscellaneous-licence WASC 274 / Bill 2025 advisory) — warn, don't suppress.
- **FR-EV-3** Pack is **reproducible** (re-runs to the same output on the same data snapshot) and exportable (markdown + PDF).

### 7.5 Surfaces (app)
- **FR-UI-1** Officer surfaces: Recovery Audit (candidate list), Properties, Portfolio Map (zoomable), Signal Catalogue, Aerial Evidence, Discovery Engine, **Roll Quality** (IAAO report), Dashboards (Intel), Reconciliation, Activity Log, Citizen Chat.
- **FR-UI-2** Officer chat (Claude) with an **allowlisted tool** surface — agents can only call contract-defined tools; unknown tools are refused.
- **FR-UI-3** A `/connections` page mirrors live integration status for an ICT reviewer.

### 7.6 Multi-tenancy & access
- **FR-MT-1** Every read/write is **tenant-scoped** by council; cross-tenant access is refused unless `platform_admin`. Enforced in API routes *and* DB (Postgres RLS via a `NOBYPASSRLS` app role).
- **FR-MT-2** Role-based access (rates_officer / rates_supervisor / platform_admin) gates sensitive reads (audit log, PII unmask).

### 7.7 Audit
- **FR-AU-1** Every mutation + agent dispatch is recorded in a **tamper-evident, hash-linked audit chain** with a verify endpoint; 7-year retention (LGA 1995 / State Records Act 2000).

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| **Performance** | 5,000-property council sweep < ~20 ms (in-engine); read p95 < 800 ms / p99 < 1500 ms; chat p95 < 6 s. |
| **Scale** | Design for **5,000 concurrent officers**, load-test bar **15,000 burst (3× headroom)**, zero data-integrity breaks under concurrency, graceful 429 backpressure. (Not 50k — officer app.) |
| **Availability** | SLOs + error budgets; golden-signal dashboards + alerts; DR drill green; runbooks for top failures. |
| **Security** | OWASP-clean; rate limiting (global/per-route/per-tenant); secrets in Secrets Manager (not `.env`); HMAC sessions; no secret sprawl. |
| **Privacy** | PII-first: classify, encrypt-at-rest, retention enforced, RTBF path, DPA per sub-processor (incl. Anthropic AU). |
| **Compliance** | SOC 2 readiness posture; tamper-evident audit; fair-process (natural justice) notices; honest marketing claims. |
| **Data residency** | All application data + audit logs **in Australia** (AWS `ap-southeast-2`); LLM via AU endpoint where available, disclosed otherwise. |
| **Observability** | Structured logging (pino), correlation IDs, Sentry, tracing of agent calls (prompt/cost/latency). |

---

## 9. Architecture (summary)

- **Monorepo** (npm workspaces): `apps/web` (Next.js 14 App Router) + packages: `contract` (public API: types, zod tool schemas, WA rate tables), `recovery-engine` (signals, scoring, uplift, evidence packs, IAAO ratio studies, legal-risk), `spatial` (SLIP/ArcGIS, DMIRS WFS, live tenement mapping + intersection, lag-window), `identity` (ABR ABN client), `db` (audit chain + retention), `adapter-demo` (reference RatesAdapter — every council platform implements the same contract), `audit-core`.
- **The contract package is the platform's public API** — no engine reaches around it to a platform-specific client.
- **Local:** pglite (in-memory) for dev. **Prod target:** Postgres on RDS Multi-AZ + RDS Proxy, ECS autoscaled behind ALB + ACM, in `ap-southeast-2` (Terraform authored + `validate`-green; **apply is human-gated**).
- **Quality bar:** TypeScript strict; **1,034 tests green**; typecheck 0; ship-readiness gating.

---

## 10. Success metrics

**Pilot (per council):**
- **Recoverable $ surfaced** (headline) and **$ confirmed** by the expert/officer.
- **Precision** of flagged candidates (officer-confirmed ÷ flagged).
- **Time-to-first-evidence-pack** (target: minutes, vs days manual).
- **Roll-quality delta** — categories brought within the IAAO COD band.

**Product / platform:**
- Detection precision ≥ target on the golden set; **zero silent-fabrication** incidents.
- p99 within SLO at the load-test bar; zero cross-tenant leakage findings.
- Activation: council onboarded → first confirmed recovery.

**Business:**
- Pilot → signed success-fee engagement; **NRR / expansion** across the council's categories; pipeline of councils via WALGA Preferred Supplier Panel.

---

## 11. Business model

- **RatesRecovery** — anomaly + mis-classification detection with evidence packs. **10–15% success fee** on recovered rates, capped over a defined window. The headline line; zero upfront to the council.
- **RatesAssist** — officer productivity layer (chat + workflows). Per-seat subscription.
- **RatesIntel** — manager/exec reporting incl. the IAAO Roll-Quality report. Per-council/yr.
- **RatesChat** — public ratepayer chat. Per-council/yr (later).
- **GTM unlock:** WALGA **PSP003-001 (Valuation Services)** panel → engage 138 WA councils without a full tender.

---

## 12. Scope, milestones & roadmap

### 12.1 Production-readiness (GOAL 1) — officer scale
`M0` connectivity audit ✅ · `M1` production data tier (reversible done; apply gated) · `M2` throughput + resilience (rate-limit/autoscale done; cache/async on load-test evidence) · `M3` k6 load harness ✅ · `M4` perf remediation ✅ · `M5` day-2 ops ✅ · `M6` ship gate (scorecard; capped until scale proven on real infra).

### 12.2 The edge (GOAL 2) — live-data intelligence
`E0` edge data research ✅ · `E2` mapping overlays ✅ · `E5a` data-source adapter pattern ✅ · `E5c` **live DMIRS→scorecard pipeline** ✅ · `E5d` **edge-sharpening deep research** ✅ · `E6` **IAAO ratio-study engine** ✅ · `E6b` **tenant-scoped Roll-Quality API** ✅ · `E6c` **Roll-Quality UI** ✅ · `E7` **miscellaneous-licence legal-risk guard** ✅. *Open:* `E3` government-scale eval-context (100k+/tenant, gated on load-test evidence) · `E4` adversarial council review.

### 12.3 Next candidate work (reversible)
New detection signals from the research (STRA short-stay, renewables-on-rural, supplementary-valuation Completion-Gap scanner, exemption-staleness, interest under-application); entity-resolution graph; knowledge-elicitation (CDM) to encode the expert's heuristics; new data adapters (ABR bulk, ACMA, LRET) behind their access gates.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Recovery reversed by law** (e.g. misc-licence Bill 2025 retrospectively extinguishes + refunds) | Legal-risk guard warns before pursuing (E7); track Bill status; escalate warn→suppress if enacted. |
| **Wrong statutory citation** in an evidence pack (s.6.81 vs s.6.39) | Surface both 3y/5y figures; **legal confirmation queued** before relying on the section number. |
| **False positives** (an expensive parcel correctly rated) | IAAO outliers are **triage for review, not auto-recovery**; under-sampled strata guarded; human-in-the-loop. |
| **Key-person dependency** on the expert | Encode tacit heuristics into the signal catalogue (knowledge elicitation); HITL labelling. |
| **ERP incumbent builds it** (TechOne) | Deep WA-regulatory moat + success-fee model they can't easily replicate; position as a layer, not a replacement. |
| **Data access** (Landgate sale data, ABR bulk are paid/gated) | Free-tier capabilities ship now; paid adapters queued behind procurement; market-calibrated IAAO lights up when sale data lands. |
| **Scale unproven on real infra** | Load-test harness authored; the run + deploy are human-gated; score honestly capped until proven. |

---

## 14. Open questions & dependencies (human-gated — in the approval queue)

- **Deploy:** AWS account + OIDC, `terraform apply`, app-role SQL, secrets, DNS/ACM, the k6 run against the real ALB → then a **public URL** exists (today the app is **local-only**).
- **Legal:** back-rating citation (s.6.39 vs s.6.81); miscellaneous-licence Bill status; success-fee contract enforceability under the WA LG Act; council standing to initiate a Landgate review.
- **Paid data:** Landgate sale-price/valuation bulk (unlocks full market-calibrated IAAO), ABR Business Location File, Nearmap imagery; MINEDEX CC-BY-NC commercial-use confirmation.
- **GTM:** WALGA PSP accreditation; the pilot council + signed MoU; DPAs + cyber/E&O insurance before any real PII.

---

## 15. Appendix — glossary

- **GRV / UV** — Gross Rental Value / Unimproved Value: the two WA rating bases set by the Valuer-General.
- **Rate-in-the-dollar** — the council's multiplier applied to the value to produce the rates levied.
- **Tenement** — a mining title (M=mining lease, E=exploration, P=prospecting, G=general-purpose, L=miscellaneous licence).
- **DMIRS / MINEDEX / SLIP / TENGRAPH** — WA mines department + its registers/spatial platform.
- **Landgate** — WA land authority; home of the Valuer-General + cadastre.
- **SAT** — State Administrative Tribunal (WA) — where valuation/rating objections are reviewed.
- **IAAO / COD / PRD / PRB** — International Association of Assessing Officers + its uniformity/equity statistics.
- **Back-rating** — recovering rates for prior years after a correction (capped: conservative 3y / statutory 5y).
- **LIVE / STUB / PLANNED** — the platform's honest integration-status vocabulary.

---

*RatesAssist — Vertical AI for Australian local government rates. © RatesAssist (entity TBC). Confidential.*
