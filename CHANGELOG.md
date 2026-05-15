# RatesAssist — Changelog

All notable changes to RatesAssist are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows a phase-tagged versioning scheme.

| | |
|---|---|
| **Document** | Project changelog |
| **Audience** | Councils, auditors, contributors |
| **Owner** | Brodie · `engineering@ratesassist.com.au` |
| **Last reviewed** | 2026-05-15 |
| **Review cycle** | On every tagged release |

---

## [Unreleased]

### Added
- `scripts/perf-bench.ts` + `npm run perf` — recovery-engine benchmark
  over a synthesised 5,000-property dataset; asserts full sweep < 2s.
  Emits a dated report under `reports/` with a diff against the prior
  bench file.
- `internal/OBSERVABILITY.md` — log destinations (BetterStack AU / Sumo
  Sydney / CloudWatch ap-southeast-2 / Datadog), 7-year audit retention,
  recommended log queries, alerting matrix, metrics roadmap.
- `internal/PROGRESS-SCORECARD.md` — 10-dimension audit score before /
  after the five fix tracks; gaps and strengths owned honestly.

### Changed
- `apps/web/lib/logger.ts` — explicit `LogLevel` union, `RA_LOG_SHIP`
  switch for log-collector ingestion, `RA_PINO_TRANSPORT` for
  json/pretty/file routing, structured `error` serializer so
  log analysers index `error.type` and `error.message` as columns.
- `README.md` — rewritten as a public-facing entry point. Leads with
  the problem statement, three pillars (Detection / Evidence /
  Recovery), ASCII architecture diagram, AU-residency claims, and a
  LIVE / STUB / PLANNED integrations table that matches the runtime
  `/connections` page.

### Planned
- Phase 2 Postgres rollout with immutable audit log (see `SECURITY.md`,
  `DATA-CLASSIFICATION-MATRIX.md`).
- Phase 3 field-level encryption and PII redaction pipeline.
- Phase 4 SSO (WorkOS), RBAC, application-level MFA.
- Phase 6 AWS Sydney migration with KMS, VPC, WAF, CSP/HSTS hardening,
  Prometheus metrics on `/api/metrics`, OpenTelemetry traces.

---

## [v1.3.0-review-hardened] — 2026-05-14

### Fixed
- Uplift calculator rejects NaN / Infinity / zero / negative GRV / UV
  values with `missing_grv` / `missing_uv` / `invalid_input` errors
  instead of producing `$NaN/yr` downstream (C1).
- Lifecycle signals deduplicate per kind — two upstream
  `construction_completed` entries fire the composite exactly once
  rather than double-counting (C3).
- Change-date parsing tightened to strict ISO `yyyy-mm-dd` with
  1900-01-01 floor and `evalDate + 1d` ceiling; bogus dates now reject
  rather than silently flooring to zero years (C13).

### Changed
- Negative-uplift candidates are routed to a frozen, non-enumerable
  `overtaxedCandidates` array on the findMismatches result. The CFO
  recovery headline never includes a candidate that is actually being
  overtaxed (C2).
- `PropertyMap`: perf cap on `maxNativeZoom = 17` to match Esri's real
  coverage in remote WA; high-zoom blank-tile fix; Sentinel-2 always-on
  basemap fallback for parcels outside Esri Imagery coverage.

### Added
- Stale-GRV caveat: `grvAsAt` older than three years from the
  evaluation date emits a caveat asking the clerk to verify the
  Valuer-General figure before quoting it (C12).

### Security
- No new sub-processors. No change to data classification.

---

## [v1.2.0-accurate-uplift] — 2026-05-14

### Added
- `packages/contract/src/rateTables/wa-2025-26.ts` — six WA councils
  (TPS, ESH, SST, KAL, MEK, ASH) × eight land-use categories
  (Residential / Commercial / Industrial / Vacant / Rural / Pastoral /
  Mining / MiningOther). Each row carries rate-in-dollar, minimum
  payment, basis (GRV or UV), council source URL, retrieval date,
  verified flag, carried-forward flag, and a provenance note that the
  UI renders verbatim.
- `packages/recovery-engine/src/upliftCalculator.ts` — accurate uplift
  formula `annual_rates = max(value × rateInDollar, minimumPayment)`
  with GRV/UV basis routing, full formula trail, and WA LGA s.6.81
  3-year conservative / 5-year statutory backdating brackets.
- Six property-lifecycle change signals: `change.subdivision_detected`,
  `change.construction_approved`, `change.construction_completed`,
  `change.renovation_detected`, `change.gru_revaluation_pending`,
  `change.commercial_use_observed`. Each fires from a
  `changeDetectionByAssessment` entry and stacks additively.

### Changed
- `findMismatches` now routes through the accurate path when a rate
  table + `correctLandUse` hypothesis are present, falling back to the
  heuristic only when one is missing — the candidate's `rateFormula`
  field marks `"heuristic"` so the UI flags it explicitly.

### Security
- Every rate table ships with `verified: false` because live council
  pages 404'd at build time; the UI surfaces the caveat next to every
  number. Honest provenance; no silent fabrication.

---

## [v1.1.0-world-class-map] — 2026-05-14

### Added
- `PropertyMap` — replaces `_GrantMap` with a single component shared
  between `/alerts/[tenementId]` and `/recovery/[assessment]`.
- Real cadastre polygon fetch from SLIP, animated red dashed parcel
  hero, gold-filled tenement × parcel overlap layer, stats overlay,
  scale bar + click-to-measure, zoom-to-detail pills, north arrow,
  cursor lat/lng readout, print mode (`?print=1`).
- `apps/web/lib/polygonClip.ts` — Sutherland-Hodgman polygon clipper
  for the overlap layer.

### Changed
- Five basemap layers (Hybrid / Satellite / Street / Topo / SLIP) with
  toggle row top-left.

### Fixed
- Next 14 params handling on `/onboarding/[code]` no longer treats
  params as a Promise.

---

## [v1.0.0-pilot-ready] — 2026-05-11

### Added
- **Tamper-evident audit hash chain** — `genesisHash`,
  `computeRowHash`, `verifyChain` over canonicalised audit rows; new
  `verify_audit_chain` tool + `/api/audit/verify-chain` endpoint with
  ETag and RBAC.
- Email notification stub — high-severity candidate alerts emit
  through a logged transport; `/api/notify` scoped logger.
- Public marketing landing page at `/landing` for unauthed visitors.

### Security
- Audit chain is a Phase 9 stub for transport — production-grade
  append-only storage (AWS QLDB or S3 Object Lock) is tracked for
  Phase 6. Ring-buffer eviction breaks the chain in dev; this is
  documented in the implementation rather than hidden.

---

## [v0.9.0-techone-emits-tengraph] — 2026-05-11

### Added
- TechOne CSV ingest — new `import_rating_roll` tool with two-phase
  commit (preview → commitToken → confirm). RFC-4180 parser, Zod
  schema, per-row error collection, deterministic owner IDs.
- `POST /api/councils/[code]/import` — JSON or multipart upload (10 MB
  cap, `write.user_management` gate, audit-logged, invalidates the
  cached `EvaluationContext` on commit).
- 4-step onboarding wizard at `/onboarding/[code]`.
- `reg.environmental_approval_active` signal — fires once per property
  when any intersecting tenement carries an active EMITS approval.
- Tengraph deep-link in the evidence pack.

---

## [v0.8.0-wa-landgate-address-mismatch] — 2026-05-11

### Added
- `reg.address_mismatch_landgate` signal — fires when caller surfaces a
  medium/high-severity Landgate × council address-record discrepancy.
- `internal/LANDGATE-ACCESS.md` — concrete pathway to live Landgate
  restricted-tier data via council-licensed feeds and direct
  subscription.

### Changed
- `TARGET_STATE_SCOPE = "WA"` in `packages/contract/src/constants.ts`;
  schemas tightened to `z.literal("WA")` where applicable.
- Recovery / intel / tenants pages render a subtle "Scope: Western
  Australia" banner; multi-state fixtures (BRK, MTI) preserved but
  filtered out at the UI layer.

---

## [v0.7.0-live-grants-and-add-council] — 2026-05-11

### Added
- Live DMIRS grants widget pinned to `/recovery` and `/intel`, with an
  honest `SOURCE: LIVE | SEEDED` badge.
- Add-Council UI flow with two-phase commit + audit log; `add_council`
  schema validates code, state, centroid bounds, and population.

### Changed
- Live grants surface 5 brand-new tenements pulled from DMIRS via SLIP
  on each load — no mock substitution.

---

## [v0.6.0-lag-signal] — 2026-05-11

### Added
- `reg.dmirs_ahead_of_landgate` signal (weight 0.50, no exclusive
  group) — fires when a Live DMIRS tenement intersects a Landgate
  parcel whose landuse code does not yet reflect the mining activity.
  The headline detection edge.
- `packages/spatial/src/lagWindow.ts` — `findLagWindowCandidates`,
  `buildLandgateLocateUrl`, landuse normaliser, severity heuristic,
  honest source labelling (live | seeded | cache).
- `packages/adapter-demo/src/handlers/lagWindow.ts` +
  `/api/recovery/lag-window`.

### Documented
- Public SLIP cadastre layer (LGATE-001) exposes no attributes; the
  workaround is DPIRD-003 (Generalised Agricultural Land Use of WA)
  for the public-tier proxy. Headline upgrade for councils: connect
  their TechOne / Landgate restricted feed to go from generalised-zone
  confidence to parcel-PIN precision.

---

## [v0.5.0-government-grade] — 2026-05-10

### Added
- Audit log integration in every mutating tool handler:
  `update_owner_contact`, `add_property_note`,
  `generate_statutory_certificate` (fail-closed),
  `draft_payment_reminder`, `draft_chase_all_overdue`.
- In-memory ring buffer at
  `packages/adapter-demo/src/audit/inMemoryAuditStore.ts` (FIFO cap
  10,000) with DB-schema-compatible row shape.
- `recordMutation()` facade with best-effort vs fail-closed semantics.
- `list_audit_log` tool with `read.audit_log` permission gate.
- `RequestContext` extended with `actorId`, `actorKind`, `ip`,
  `userAgent`.

### Security
- Statutory certificates refuse to emit if the audit write fails
  (fail-closed). Best-effort handlers log audit failures at error
  level without blocking the user mutation.

---

## [v0.4.0-unified-recovery] — 2026-05-08

### Changed
- Grant alerts merged into the unified Recovery view as a stacking
  signal alongside DMIRS / SLIP / ABR mismatches. Each candidate now
  carries every applicable signal in one evidence pack rather than
  being surfaced through separate workflows.

### Added
- Stacking-signal scoring on the Recovery list.
- Cross-signal evidence pack rendering.

### Fixed
- De-duplication of candidates that previously appeared in both the
  grant-alerts and recovery surfaces.

### Security
- No new sub-processors; no change to data flows.

---

## [v0.3.1-grant-detail] — 2026-04 _(approximate)_

### Added
- Grant detail page with map preview of the affected geography.
- Per-grant evidence pack render.

### Changed
- Grant alert list links through to the new detail page.

### Security
- No change to data classification.

---

## [v0.3.0-grant-alerts] — 2026-04 _(approximate)_

### Added
- Live grant feed ingest (Commonwealth + state programmes).
- `/alerts` page surfacing actionable grant signals.

### Changed
- Adapter layer extended to normalise grant feeds into the RatesAssist
  domain model.

### Security
- Public-data ingest only; no new sub-processors.

---

## [v0.2.2-realdata] — 2026-03 _(approximate)_

### Added
- Real DMIRS data validated end-to-end against the production adapter.
- Vercel deploy pinned to Sydney edge region (`syd1`).

### Changed
- Replaced synthetic fixtures with real DMIRS responses in the
  canonical demo flow.

### Fixed
- Adapter parser edge cases discovered against real-world tenement
  records.

### Security
- AU-region edge execution confirmed for all chat traffic.

---

## [v0.2.1-phase1b] — 2026-02 _(approximate)_

### Changed
- Web tier converted to MCP-based architecture; tools served over the
  MCP transport rather than ad-hoc HTTP.
- CI integrated with ship-check gating.

### Added
- `ship-check` script enforcing pre-deploy invariants.

### Security
- Tool surface explicitly allowlisted at the MCP boundary.

---

## [v0.2.0-phase1a] — 2026-02 _(approximate)_

### Changed
- Phase 1A monorepo restructure: workspaces under `apps/` and
  `packages/`.

### Added
- Shared TypeScript base config.
- Workspace tooling.

### Security
- No change to data flows.

---

## [v0.1-prototype] — 2026-01 _(approximate)_

### Added
- Initial prototype: chat surface against synthetic DMIRS data;
  deterministic anomaly scoring; tool-grounded narration.

### Security
- Pre-pilot prototype; no real personal information processed.

---

*Dates marked _(approximate)_ are derived from git tag history.*

*Last reviewed: 2026-05-15 · Next review: on next tagged release.*
