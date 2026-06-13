# PRD.md — RatesAssist

> Lightweight PRD summary. Full requirements: [`RatesAssist-PRD.md`](./RatesAssist-PRD.md)

## Problem statement

WA councils systematically under-rate properties — especially on mining and rural land. Producing tenements on rural-rated parcels, recently-granted mining licences, and subdivisions that haven't flowed through to the Landgate roll go unbilled for years. Officers find these one parcel at a time, manually. No council has a systematic, data-driven tool to find and recover them.

## Target user

**Rating officers** at WA local government councils (~537 councils) — the person who manages the rating roll, handles ratepayer queries, and issues rate notices. Secondary users: council CFOs (revenue impact), ICT managers (integration + security sign-off), and ratepayers (public transparency via `/citizen`).

## Core features

| Feature | Status |
|---|---|
| **33+ signal detection engine** — DMIRS × Landgate × ABR × EMITS × aerial | Pilot-ready |
| **Evidence packs** — formula trail, source URLs, caveats, no silent fabrication | Pilot-ready |
| **Accurate uplift calculator** — council rate table or explicit heuristic | Pilot-ready |
| **Live DMIRS tenement pipeline** — geometry fetched + intersected in real time | Pilot-ready (`RA_LIVE_TENEMENTS`) |
| **IAAO Assessment Roll Quality** — COD / PRD / PRB + peer dispersion | Pilot-ready (`/roll-quality`) |
| **Legal-risk guard** — contested-law callout on misc-licence recoveries | Pilot-ready |
| **Multi-tenant isolation** — per-council data scoping, HMAC sessions, RLS | Pilot-ready |
| **Tamper-evident audit chain** — Ed25519-signed, 7-year retention | Pilot-ready |
| **Council-grade PDF evidence packs** | Pilot-ready |
| **Mapping** — DMIRS, Landgate, SARIG, DEA satellite overlays | Pilot-ready |
| AWS prod deploy (ALB + ECS + RDS Multi-AZ) | Human-gated — see M7 |
| TechOne / Civica live adapter | Phase 2 |

## Success metrics

| Metric | Target |
|---|---|
| Recovery rate identified per council sweep | > $50K average |
| Evidence-pack accuracy (no formula errors) | 100% |
| Time from roll import to first evidence pack | < 5 minutes |
| p99 response time at 5,000 concurrent officers | < 1,500ms |
| Tests green | 1,034 / 1,034 |
| Ship-readiness score | ≥ 95 / 100 |

## Current status

**Pilot-ready.** All code complete. 1,034 tests green. Typecheck clean. Ship-readiness 80/100 (capped — scale unproven until load test runs against real ALB). Deployed path is fully authored in `infra/terraform/`; human-gated on Brodie's `terraform apply`.

## Next milestone

**M7 — GO-LIVE (human-gated).** The full sequence lives in `internal/OPERATE-HANDOFF.md`:

1. S3+KMS Terraform state backend
2. `terraform apply` (RDS + ECS + ALB + ACM)
3. DNS + ACM cert on `app.ratesassist.com.au`
4. Secrets → AWS Secrets Manager (prod API key, auth secret, DB creds)
5. Run DB migrations on RDS + provision NOBYPASSRLS `app_user` role
6. Run M3 load test against the real ALB (k6, 5k sustained / 15k burst)
7. Legal wall: DPAs (incl. Anthropic AU), cyber + E&O insurance, counsel sign-off
8. Signed pilot agreement with first council

**Nothing in M7 is automated.** Brodie executes every step.

## Open questions (human-gated)

| ID | Question |
|---|---|
| Q-edge-legal-6.39 | WA property lawyer confirm s.6.39 vs s.6.81 back-rating citation |
| Q-edge-misclicence | Confirm Royal Assent status of LG Amendment (Rating of Certain Mining Licences) Bill 2025 |
| Q-edge-contingency | WA local-government lawyer confirm success-fee contract enforceability |
| Q-edge-paid-data | Landgate sale-price bulk data; ABR Business Location File; Nearmap; MINEDEX CC-BY-NC confirm |
| Q-edge-walga-psp | Apply for WALGA PSP003-001 (Valuation Services) panel — GTM unlock for 138 WA councils |
| Q-ra-aws | Terraform apply + ECS + RDS deploy |
| Q-ra-loadtest | k6 load test against real ALB |
| Q-ra-legal | DPAs, cyber/E&O insurance, legal sign-off before any real council PII |
