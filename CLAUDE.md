# CLAUDE.md — RatesAssist

> Auto-loaded every session. Read this before touching anything.

## What this project is

**RatesAssist** is an AI-native rating-integrity and revenue-recovery platform for Australian local government (WA-first). It cross-references a council's rating roll against authoritative registers (DMIRS, Landgate, ABR, EPA, aerial feeds), scores each parcel against a 33+ signal detection engine, quantifies the recoverable rates within the statutory back-rating cap, and produces council-grade, challenge-proof evidence packs. Commercial model: success fee on recovered revenue.

## Stack

| Layer | Technology |
|---|---|
| Monorepo | npm workspaces (`apps/web` + 7 packages) |
| Web | Next.js 14 App Router, TypeScript strict |
| Packages | `adapter-demo`, `audit-core`, `contract`, `db`, `identity`, `recovery-engine`, `spatial` |
| Database | pglite locally / Postgres (RDS Multi-AZ) in prod |
| Auth | HMAC sessions, multi-tenant by council `tenantId` |
| Infra | AWS Sydney `ap-southeast-2`, ECS, ALB, RDS, Terraform in `infra/` |
| LLM | Anthropic Claude (Sonnet 4 / 4.5) via `apps/web/lib/llm.ts` |
| Test | Vitest, 1,034 tests |

## How to run

```bash
# Install
npm install

# Dev server (port 3000)
npm run dev:web

# All tests
npm test

# Typecheck (all workspaces)
npm run typecheck

# Full ship-check (typecheck + tests + build + audit)
npm run ship-check

# Performance benchmark
npm run perf

# Live DMIRS pull
npm run dmirs-pull
```

Open: http://localhost:3000/landing

## Where the logic lives

```
packages/recovery-engine/src/
  engine.ts          — the 33+ signal evaluator + composite scorer
  ratioStudy.ts      — IAAO ratio-study engine (COD, PRD, PRB, peer dispersion)
  legalRisk.ts       — misc-licence contested-law guard
  evidencePack.ts    — council-grade evidence pack renderer
  uplift.ts          — accurate rates uplift calculator

packages/spatial/src/
  slip.ts            — DMIRS SLIP / ArcGIS REST (LIVE)
  dmirs.ts           — DMIRS MINEDEX (LIVE)
  tenementMapping.ts — live feature → Tenement mapper
  intersection.ts    — tenement ∩ parcel ray-cast (PNPOLY)
  liveContext.ts     — compose: bbox → SLIP → map → intersect → group
  sarig.ts           — SA SARIG mining adapter (mirrors DMIRS)
  dataSources.ts     — national data-source catalogue

apps/web/
  app/api/           — Next.js route handlers (all auth-gated, tenant-scoped)
  app/               — pages: /recovery /signals /map /roll-quality /alerts etc.
  lib/clients.ts     — buildContextFromDb (live-tenement flag: RA_LIVE_TENEMENTS)
  lib/llm.ts         — Anthropic client

packages/contract/src/index.ts  — the platform's public API (all types + zod schemas)
packages/db/                    — immutable audit chain, 7-year retention, RLS migrations
infra/terraform/                — AWS topology (authored, not yet applied)
infra/sql/                      — NOBYPASSRLS app-role script
```

## Key env vars

| Var | Purpose | Default |
|---|---|---|
| `RA_LIVE_TENEMENTS` | Enable live DMIRS geometry pipeline | `false` (DB fallback) |
| `DATABASE_URL` | Postgres connection string | pglite in-process if absent |
| `ANTHROPIC_API_KEY` | Claude API key | required for chat |
| `RA_AUTH_SECRET` | HMAC session secret | required |
| `RA_DB_POOL_MAX` | DB pool ceiling | 10 |

Never commit real values. `.env.local` is gitignored.

## The rails — what Claude must never do

- **Never commit/branch/push** without explicit instruction from Brodie.
- **Never deploy, apply terraform, or run migrations** on real infrastructure — these are human-gated.
- **Never handle AWS credentials, API keys, or database passwords** — Brodie supplies these directly.
- **Never merge to main** — all work goes on branches + shadow-PRs for review.
- **Never suppress legal-risk warnings** without confirmed legislative change (misc-licence Bill 2025 status must be human-confirmed before escalating warn→suppress).
- **PII-first** — assume real council/ratepayer data; classify, encrypt, audit by default.

## Critical gotchas

1. **s.6.39 vs s.6.81** — the back-rating power is believed to be s.6.39(2) LGA 1995 (5 preceding years); code currently also cites s.6.81. Pending WA property lawyer confirmation (`Q-edge-legal-6.39`). Both figures are surfaced; neither is over-claimed.

2. **Misc-licence Bill 2025** — LG Amendment (Rating of Certain Mining Licences) Bill 2025 would retrospectively extinguish rates on type-`L` tenements. Code warns at the top of the evidence pack (per WASC 274 — currently rateable). If Bill gets Royal Assent, escalate warn → hard-suppress. Check `Q-edge-misclicence`.

3. **Live tenements flag** — `RA_LIVE_TENEMENTS=1` activates the live SLIP pipeline. Default OFF so prod always has a DB fallback. SLIP has a ~1 sq-deg area cap — rural LGAs > 1 sq-deg gracefully DB-fallback.

4. **134 files were uncommitted** before the June 2026 push — everything from the IAAO engine, live-data pipeline, and legal-risk guard landed in one commit.

5. **Tenant isolation is mandatory** — every API route must scope data to `tenantFromAssessmentNumber` + `sessionMayAccessTenant` before any computation. The cross-tenant IDOR was found + fixed in iter4; any new routes must follow the same pattern.

6. **pglite locally, Postgres in prod** — `lib/db.ts` selects the driver based on `DATABASE_URL`. Tests run against pglite. Never assume the local driver in production paths.

## Docs map

| Doc | What it is |
|---|---|
| `README.md` | Engineering overview, quick start, live-data integration status |
| `RatesAssist.md` | Master product + engineering spec (v1.0) |
| `RatesAssist-PRD.md` | Full product requirements document |
| `PRD.md` | Lightweight PRD summary |
| `internal/EDGE-SHARPENING-WA.md` | Edge strategy + deep research (~90 primary sources) |
| `internal/SCORECARD.md` | Ship-readiness scorecard |
| `internal/OPERATE-HANDOFF.md` | Human go-live runbook |
| `SECURITY.md` | Security posture |
| `PRIVACY.md` | Privacy program |

## Companion files

- HQ goals: `~/HQ/ratesassist/goals/active.md`
- Memory: `~/.claude/projects/-Users-Brodie-FA-OS-/memory/project_ratesassist.md`
- GitHub: `https://github.com/Brodie-Eaze/ratesassist`
