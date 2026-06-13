# RatesAssist Feature Map
Generated: 2026-06-09

---

## 1. Recovery Audit Dashboard
**URL:** `/recovery`
**Promise:** Show every mis-rated property in the council portfolio ranked by estimated recovery opportunity, filterable by signal family and severity.
**Completeness:** 90/100
**Biggest gap:** No server-side pagination — the full candidate set loads in one request; at production scale (thousands of parcels) this will become slow. The "Confirm reclassification" write action is absent — clerks see candidates but cannot commit a reclassification decision from this screen.
**Priority:** P0

---

## 2. Evidence Pack (per-property)
**URL:** `/recovery/[assessment]`
**Promise:** Generate a council-grade reclassification brief for a single parcel: current vs correct rates, all firing signals, visual map, title-state cross-reference, concession audit, and downloadable PDF and HTML artefacts.
**Completeness:** 85/100
**Biggest gap:** Rate-formula path falls back to heuristic multiplier for any council without a verified `rateTablesByCouncil` entry (most councils). Statutory-grade PDF exists but the QR/letterhead branding and formal layout are minimal stubs. No "approve" or "escalate" action from the page — pack consumption is read-only.
**Priority:** P0

---

## 3. Signal Catalogue
**URL:** `/signals`
**Promise:** Expose every detection signal: its weight, authoritative source, category, description, and the count of candidates it currently fires on, so officers and councils can trust and audit the engine.
**Completeness:** 95/100
**Biggest gap:** No ability to override/suppress a signal weight at the tenant level. No changelog showing when signals were added or re-weighted.
**Priority:** P1

---

## 4. Roll Quality (IAAO Uniformity Review)
**URL:** `/roll-quality`
**Promise:** Detect systemic non-uniformity across the rating roll using IAAO Coefficient of Dispersion per land-use × suburb stratum, surfacing categories where parcels may not belong.
**Completeness:** 80/100
**Biggest gap:** COD outlier assessments are listed by code only — no drill-through to the property detail or recovery pack. No export of flagged strata. IAAO band thresholds are hardcoded rather than per-council-configurable. No trend over time.
**Priority:** P1

---

## 5. Portfolio Map
**URL:** `/map`
**Promise:** Visualise the full portfolio on a multi-basemap interactive map with tenement overlays, filter by council/type, see recovery uplift and overdue stats in view, and optionally enable live vector cadastral and DMIRS polygons.
**Completeness:** 80/100
**Biggest gap:** Live vector polygon mode (Landgate cadastral + DMIRS) requires external API keys that are not configured in demo; falls back silently. No click-through to individual property or evidence pack from the map markers. Nearmap premium imagery layer is declared in the panel but not wired.
**Priority:** P1

---

## 6. Aerial Change Detection
**URL:** `/aerial`
**Promise:** Show a per-candidate satellite view with DMIRS tenement overlay, confidence bar, and recovery estimate to give officers visual confirmation before acting on a detection signal.
**Completeness:** 65/100
**Biggest gap:** The "Nearmap AI change-detection feed" referenced in the `aerial.change_detected_recent` signal definition is not integrated — the aerial view uses static Esri imagery only. No before/after image comparison. No direct action from this screen (no link to approve or flag). Essentially a read-only visual layer with no Nearmap subscription wired.
**Priority:** P1

---

## 7. Dashboards (RatesIntel)
**URL:** `/intel`
**Promise:** Cross-council portfolio summary: annual rate revenue, collection rate, recovery candidates by severity, per-council breakdown table, collection trend chart, and top overdue/candidate widgets.
**Completeness:** 78/100
**Biggest gap:** Collection trend chart uses static synthetic data ("+3.2% YoY" badge is hardcoded). Per-council drill-through links are absent — the table shows figures but clicking a row does nothing. Inter-state expansion is locked out by a WA filter with no UI toggle.
**Priority:** P1

---

## 8. Autonomous Discovery Engine
**URL:** `/discovery`
**Promise:** Show a live view of the continuous detection pipeline (ingest → intersect → reconcile → score → triage → feedback) with stage throughput, watchlist, activity feed, and outcome ledger, demonstrating what the platform will do at scale.
**Completeness:** 55/100
**Biggest gap:** Explicitly labelled "Illustrative" — all stage metrics, throughput figures, and outcome data are synthetic. The pipeline stages are not running autonomously; there is no background job scheduler wired to any live cron or queue. This page describes the future state, not current operation.
**Priority:** P2

---

## 9. Strata Conversion Wizard
**URL:** `/strata/[assessment]`
**Promise:** Guide a rates officer through the complete lifecycle of converting a strata-parent assessment to its child CTs via a two-phase commit state machine: detect → upload plan → preview children → import → done.
**Completeness:** 82/100
**Biggest gap:** Child CTs are entered manually — no Landgate restricted-tier pull to pre-populate them from the `strataChildren` array when available. No email notification to the strata manager on completion. The "children_imported" terminal state writes to in-memory storage only; no durable persistence in production DB.
**Priority:** P0

---

## 10. Reconciliation
**URL:** `/reconciliation`
**Promise:** Auto-match incoming bank deposits to assessment accounts using BPAY reference, amount + name fuzzy match, and bank-feed memo; surface suggested matches for officer confirmation and route unmatched deposits to triage.
**Completeness:** 60/100
**Biggest gap:** The "Confirm" button on suggested matches and the "Triage" action on unmatched deposits are UI stubs — they have no wired API call. No real bank feed integration (Monoova, CBA CommBiz, etc.). Data is demo-only with no live bank connection.
**Priority:** P1

---

## 11. Activity and Audit Log
**URL:** `/activity`
**Promise:** Provide an immutable, tamper-evident, 7-year-retained audit log of every read, write, comms, and auth action across the tenancy, filterable by category, for state-records compliance.
**Completeness:** 75/100
**Biggest gap:** The underlying store is in-memory (not append-only Postgres or QLDB); the hash-chain verifiability is real but the backing store is mutable by privileged operators. Export-on-demand per tenant is referenced in the security page but has no UI flow. Infinite scroll / cursor pagination absent — full log loads at once.
**Priority:** P0

---

## 12. Connections (Integration Health)
**URL:** `/connections`
**Promise:** Show the health status of every integration (DMIRS, Landgate, ABN Lookup, Water Corp, bank feeds, etc.) so officers and admins can see what data sources are live, degraded, or unconfigured.
**Completeness:** 70/100
**Biggest gap:** ChevronRight on each card implies a drill-through detail view that does not exist. No "reconnect" or "configure" action from the UI — read-only. Integration statuses are synthesised from a fixture rather than live health probes.
**Priority:** P2

---

## 13. Onboarding Wizard (Council Import)
**URL:** `/onboarding/[code]`
**Promise:** Walk a new council through confirming details, uploading their rating-roll CSV (with drag-and-drop, preview, and error reporting), choosing a merge strategy, and committing the import — emerging with the recovery engine ready to sweep.
**Completeness:** 85/100
**Biggest gap:** Import lands in the in-memory DataStore — not a durable production database. No supplemental import paths for the extended data files (Landgate title data, Water Corp eligibility, rate schedule) from the wizard itself (those are separate API routes without a UI). No progress indicator for large files.
**Priority:** P0

---

## 14. Tenants and Plug-in Architecture
**URL:** `/tenants`
**Promise:** Show all council tenants, their rating-system adapter status, auxiliary integrations, usage metrics, and a cross-council benchmark comparison (k-anonymity enforced), plus an adapter catalogue showing what platforms can be connected.
**Completeness:** 72/100
**Biggest gap:** Benchmark panel requires 5 opted-in tenants to activate (k-anonymity guard) and currently shows a "not yet met" placeholder. The adapter catalogue lists TechOne, Authority, Civica, etc. as "Roadmap" — none have a real adapter implementation. Adding a new tenant triggers an in-memory registration only.
**Priority:** P1

---

## 15. Properties Browser
**URL:** `/properties`
**Promise:** Search and browse every property in the active portfolio across all councils; see address, land use, valuation, balance, owner details, tenement coverage and a parcel map; link through to the evidence pack for mining-affected parcels.
**Completeness:** 80/100
**Biggest gap:** No sorting of the list (e.g. by balance, by valuation). No bulk export of filtered results. No edit/write capability from this screen — property data can only change via the CSV import. Assessment-number search is a client-side substring filter on demo data only (no server-side search index).
**Priority:** P1

---

## 16. AI Officer Assistant (Chat)
**URL:** Sidebar widget (global)
**Promise:** An agentic MCP-connected chat assistant that can answer officer queries, look up property and owner data, check grants, and run recovery analysis using natural language over the platform's tool set.
**Completeness:** 70/100
**Biggest gap:** Kill switch (`RA_CHAT_KILL`) and rate-limiting are in place but the LLM provider key (`ANTHROPIC_API_KEY`) is not provisioned in the demo environment — the chat banner shows "API key not configured". Tool surface covers the adapter-demo MCP handlers but does not expose write-path tools (strata conversion, concession update, note creation) to the assistant. Citizen-mode variant is implemented but untested against real portal users.
**Priority:** P1

---

## 17. Privacy and Erasure
**URL:** `/privacy` (public) + `/api/privacy/erasure` (API)
**Promise:** Give ratepayers a public-facing privacy notice and provide a GDPR/Privacy Act 1988-compliant subject-erasure API endpoint for councils to action deletion requests.
**Completeness:** 65/100
**Biggest gap:** The erasure endpoint accepts requests but the actual deletion cascade (property, owner, audit-log pseudonymisation) is not implemented beyond a stub. No UI for officers to track or queue erasure requests. Privacy notice content is a placeholder.
**Priority:** P2

---

## 18. Security / Trust Pages
**URL:** `/security`, `/trust`, `/trust/sub-processors`
**Promise:** Provide councils' privacy officers and IT managers with a public security-posture page, sub-processor list, and links to request PIA, SOC 2 bridging letters, and incident-response runbook.
**Completeness:** 85/100
**Biggest gap:** SOC 2 Type I and ISO 27001 engagements are scheduled (Q3/Q4 2026) but not yet completed — certifications section says "none held". The audit-log backing store is mutable until Phase 6 hardening (QLDB/S3 Object Lock). MFA is not yet mandatory (Phase 4 roadmap). SSO via WorkOS is Phase 4.
**Priority:** P2

---

## 19. Scoring and Signal Engine (Backend)
**URL:** `packages/recovery-engine/src/scoring.ts`, `signals.ts`
**Promise:** Evaluate 33+ weighted signals against every property in the evaluation context, enforce exclusive-group constraints, and produce a composite confidence score with full evidence strings.
**Completeness:** 88/100
**Biggest gap:** Signal weights are hand-set priors, not outcome-calibrated — Phase 8 ML calibration has not run (no labelled pilot data yet). The EMITS, Water Corp eligibility, Landgate restricted-tier, and change-detection maps are all optional context fields that are absent in the demo adapter, meaning most of the newer signals never fire on demo data. `aerial.change_detected_recent` depends on Nearmap AI feed not yet integrated.
**Priority:** P0

---

## 20. Evidence Pack Generator (Backend)
**URL:** `packages/recovery-engine/src/evidencePack.ts` + `/api/evidence/[file]` + `/api/evidence/[file]/pdf`
**Promise:** Produce a fully-cited, deterministic markdown and PDF evidence pack for any assessment number — including rate formula, backdating calculation, headline signals, signal breakdown, title state, and concession audit sections.
**Completeness:** 80/100
**Biggest gap:** PDF output lacks statutory letterhead, council logo injection, and formal layout required for lodgement with the Valuer-General or Wardens Court. Rate-formula path requires a verified `rateTablesByCouncil` entry to escape heuristic mode — absent for most councils in demo. Pack ID is deterministic per-day but not globally unique across tenants (no tenant prefix).
**Priority:** P0

---

## 21. CSV Export
**URL:** `/api/exports/csv`
**Promise:** Allow officers to export the full candidate list as a CSV for offline analysis or bulk upload to the council's rating system.
**Completeness:** 60/100
**Biggest gap:** No UI surface for this — it is an API-only route with no button in the Recovery Audit dashboard or Properties browser. No column selection or date-range filtering. Not linked from any page.
**Priority:** P1

---

## 22. Supplemental Data Import APIs
**URL:** `/api/councils/[code]/import-landgate-title-data`, `/api/councils/[code]/import-rate-schedule`, `/api/councils/[code]/import-wc-eligibility`
**Promise:** Accept supplemental CSV uploads (Landgate title data, council rate schedules, Water Corp eligibility feed) to populate the advanced signal contexts that power the VEN/CT/PIN, concession, and accurate-uplift signal families.
**Completeness:** 55/100
**Biggest gap:** No UI wizard for any of these three imports — they are API-only endpoints. Without them, the 12 VEN/CT/PIN signals and 5 concession signals never fire on real data. No documentation surfaced to council admins on what format is required. In-memory only.
**Priority:** P0

---

## 23. Live DMIRS Grants Feed Widget
**URL:** Embedded in `/recovery` and `/intel`
**Promise:** Display a live feed of recently-granted DMIRS mining tenements to prove the upstream data connection is real and show officers what new grants may affect their portfolio.
**Completeness:** 85/100
**Biggest gap:** Widget polls a live DMIRS endpoint but has no configurable council-boundary filter — it shows all WA grants, not just those intersecting the active tenant's portfolio. No alert or push-notification when a grant intersects a tracked assessment.
**Priority:** P1

---

## Summary Table

| Feature | URL | Completeness | Priority |
|---|---|---|---|
| Recovery Audit Dashboard | /recovery | 90 | P0 |
| Evidence Pack | /recovery/[assessment] | 85 | P0 |
| Signal Catalogue | /signals | 95 | P1 |
| Roll Quality | /roll-quality | 80 | P1 |
| Portfolio Map | /map | 80 | P1 |
| Aerial Change Detection | /aerial | 65 | P1 |
| Dashboards (RatesIntel) | /intel | 78 | P1 |
| Autonomous Discovery Engine | /discovery | 55 | P2 |
| Strata Conversion Wizard | /strata/[assessment] | 82 | P0 |
| Reconciliation | /reconciliation | 60 | P1 |
| Activity and Audit Log | /activity | 75 | P0 |
| Connections (Integration Health) | /connections | 70 | P2 |
| Onboarding Wizard | /onboarding/[code] | 85 | P0 |
| Tenants and Plug-in Architecture | /tenants | 72 | P1 |
| Properties Browser | /properties | 80 | P1 |
| AI Officer Assistant | Sidebar | 70 | P1 |
| Privacy and Erasure | /privacy + API | 65 | P2 |
| Security / Trust Pages | /security, /trust | 85 | P2 |
| Scoring and Signal Engine | packages/recovery-engine | 88 | P0 |
| Evidence Pack Generator | packages/recovery-engine + API | 80 | P0 |
| CSV Export | /api/exports/csv | 60 | P1 |
| Supplemental Data Import APIs | /api/councils/[code]/import-* | 55 | P0 |
| Live DMIRS Grants Feed | Embedded widget | 85 | P1 |
