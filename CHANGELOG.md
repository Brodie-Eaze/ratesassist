# RatesAssist — Changelog

All notable changes to RatesAssist are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows a phase-tagged versioning scheme.

| | |
|---|---|
| **Document** | Project changelog |
| **Audience** | Councils, auditors, contributors |
| **Owner** | Brodie · `engineering@ratesassist.com.au` |
| **Last reviewed** | 2026-05-08 |
| **Review cycle** | On every tagged release |

---

## [Unreleased]

### Planned
- Phase 2 Postgres rollout with immutable audit log (see `SECURITY.md`, `DATA-CLASSIFICATION-MATRIX.md`).
- Phase 3 field-level encryption and PII redaction pipeline.
- Phase 4 SSO (WorkOS), RBAC, application-level MFA.
- Phase 6 AWS Sydney migration with KMS, VPC, WAF, CSP/HSTS hardening.

---

## [v0.4.0-unified-recovery] — 2026-05-08

### Changed
- Grant alerts merged into the unified Recovery view as a stacking signal alongside DMIRS / SLIP / ABR mismatches. Each candidate now carries every applicable signal in one evidence pack rather than being surfaced through separate workflows.

### Added
- Stacking-signal scoring on the Recovery list.
- Cross-signal evidence pack rendering.

### Fixed
- De-duplication of candidates that previously appeared in both the grant-alerts and recovery surfaces.

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
- Adapter layer extended to normalise grant feeds into the RatesAssist domain model.

### Security
- Public-data ingest only; no new sub-processors.

---

## [v0.2.2-realdata] — 2026-03 _(approximate)_

### Added
- Real DMIRS data validated end-to-end against the production adapter.
- Vercel deploy pinned to Sydney edge region (`syd1`).

### Changed
- Replaced synthetic fixtures with real DMIRS responses in the canonical demo flow.

### Fixed
- Adapter parser edge cases discovered against real-world tenement records.

### Security
- AU-region edge execution confirmed for all chat traffic.

---

## [v0.2.1-phase1b] — 2026-02 _(approximate)_

### Changed
- Web tier converted to MCP-based architecture; tools served over the MCP transport rather than ad-hoc HTTP.
- CI integrated with ship-check gating.

### Added
- `ship-check` script enforcing pre-deploy invariants.

### Security
- Tool surface explicitly allowlisted at the MCP boundary.

---

## [v0.2.0-phase1a] — 2026-02 _(approximate)_

### Changed
- Phase 1A monorepo restructure: workspaces under `apps/` and `packages/`.

### Added
- Shared TypeScript base config.
- Workspace tooling.

### Security
- No change to data flows.

---

## [v0.1-prototype] — 2026-01 _(approximate)_

### Added
- Initial prototype: chat surface against synthetic DMIRS data; deterministic anomaly scoring; tool-grounded narration.

### Security
- Pre-pilot prototype; no real personal information processed.

---

*Dates marked _(approximate)_ are derived from git tag history and will be reconciled to exact tag dates in the next changelog review.*

*Last reviewed: 2026-05-08 · Next review: on next tagged release.*
