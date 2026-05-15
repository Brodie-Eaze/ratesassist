<!--
  ╔═══════════════════════════════════════════════════════════════════╗
  ║                          R A T E S A S S I S T                    ║
  ║       Vertical AI for Australian local government rates           ║
  ╚═══════════════════════════════════════════════════════════════════╝
-->

# RatesAssist

[![CI](https://img.shields.io/badge/CI-passing-brightgreen.svg)](./.github/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](./.nvmrc)
[![Tests](https://img.shields.io/badge/tests-86-brightgreen.svg)](./TESTING.md)
[![Region](https://img.shields.io/badge/region-AU%20Sydney-blue.svg)](./SECURITY.md)
[![Status](https://img.shields.io/badge/status-pilot--ready-success.svg)](./internal/PROGRESS-SCORECARD.md)
[![Perf](https://img.shields.io/badge/5%2C000%20properties-%3C20ms-success.svg)](./reports)

> **WA councils miss tens of millions in mis-rated property revenue.
> We find it.**
> RatesAssist cross-references rating records against DMIRS, Landgate,
> ABR, EMITS, and aerial change-detection feeds, surfaces the parcels
> that have slipped, and produces council-grade evidence packs ready to
> issue.

| | |
|---|---|
| **Status** | Pilot-ready (WA, pre-revenue) |
| **Stack** | TypeScript, MCP, Anthropic Claude, AWS Sydney (Phase 6) |
| **Data residency** | All application data + audit logs in Australia |
| **Audit posture** | Tamper-evident chain, 7-year retention (LGA 1995 / State Records Act 2000) |
| **Test count** | 86 tests, all green |
| **Perf** | 5,000-property council sweep in < 20 ms ([reports/](./reports)) |

---

## The three pillars

```
                   ┌──────────────────────────────────┐
                   │           RatesAssist            │
                   │  Vertical AI for council rates   │
                   └─────────────────┬────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
 ┌──────────────┐            ┌──────────────┐            ┌──────────────┐
 │  DETECTION   │            │  EVIDENCE    │            │  RECOVERY    │
 ├──────────────┤            ├──────────────┤            ├──────────────┤
 │ 22 signals   │  ───────►  │ Audit-grade  │  ───────►  │ Accurate     │
 │ DMIRS ×      │            │ pack per     │            │ uplift +     │
 │ Landgate ×   │            │ candidate    │            │ backdated    │
 │ ABR × EMITS  │            │ formula +    │            │ arrears with │
 │ × aerial     │            │ source URL   │            │ LGA s.6.81   │
 │ change feed  │            │ + caveats    │            │ statutory    │
 │              │            │              │            │ cap          │
 └──────────────┘            └──────────────┘            └──────────────┘
```

1. **Detection.** The recovery engine evaluates 22 calibrated signals
   per property — producing tenements on rural-rated land, DMIRS records
   ahead of the Landgate cadastre (the headline edge), cancelled ABNs,
   recent grants inside the 30-day appeal window, subdivisions, EMITS
   environmental approvals, aerial change detections — and composes
   them into a confidence score with exclusive-group constraints. Every
   signal cites its authoritative source.

2. **Evidence.** Each candidate renders a council-grade evidence pack —
   the formula trail (`GRV $620,000 × 22.5c/$ = $1,395`), the source
   URL of the council's published schedule of rates, every fired signal
   with its evidence string, and caveats (stale GRV, unverified rate
   table, statutory cap reached). No silent fabrication; the engine
   refuses to guess.

3. **Recovery.** The accurate uplift calculator routes through the
   council's published differential-rate table when one is available
   and falls back to a heuristic ratio (8× / 4× / 1.5×) only when no
   table is on file — explicitly marked. Backdating is bracketed at
   both the conservative 3-year practical cap and the WA LGA 1995
   s.6.81 5-year statutory ceiling.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Dev server (Next.js, port 3000)
npm run dev:web

# 3. Open the public landing page
open http://localhost:3000/landing
```

Other useful commands:

```bash
npm test                # 86 tests across all workspaces
npm run typecheck       # tsc --noEmit, all workspaces
npm run ship-check      # typecheck + tests + build + audit + wiring guard
npm run perf            # 5,000-property recovery sweep benchmark
npm run smoke           # end-to-end smoke against the in-process MCP
npm run dmirs-pull      # live DMIRS tenement pull for a council
```

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  apps/web                    Next.js 14, AU-Sydney edge        │
│  - /landing  /recovery  /signals  /map  /alerts  /citizen      │
│  - /api/tools/[name]  MCP allowlist proxy                      │
│  - /api/spatial/[layer]  SLIP / Landgate reads                 │
│  - /api/audit/*  tamper-evident chain + verify                 │
│  - /api/ready  /api/health  /api/version                       │
└────────────┬─────────────────────────────┬─────────────────────┘
             │                             │
             ▼                             ▼
┌────────────────────────┐    ┌────────────────────────────────┐
│ packages/recovery-     │    │ packages/spatial                │
│ engine                 │    │ - SLIP / ArcGIS REST            │
│ - 22-signal catalogue  │    │ - DMIRS WFS probes              │
│ - composite scoring    │    │ - Landgate cadastre reads       │
│ - exclusive groups     │    │ - EMITS environmental approvals │
│ - accurate uplift      │    │ - Lag-window cross-register     │
│ - WA s.6.81 backdating │    │ - Tengraph deep links           │
└──────────┬─────────────┘    └────────────────────────────────┘
           │                              │
           ▼                              ▼
┌──────────────────────────────────────────────────────────────┐
│ packages/contract  (the platform's public API)               │
│  - domain types  - tool schemas (zod)  - WA rate tables      │
│  - OpenAPI generator  - CSV ingest schema                    │
└──────────────────────────────────────────────────────────────┘
           ▲                              ▲
           │                              │
┌──────────┴─────────────┐    ┌───────────┴────────────────────┐
│ packages/identity      │    │ packages/db                    │
│ - ABN Lookup client    │    │ - immutable audit chain        │
│ - strict-mode failure  │    │ - 7-year retention store       │
└────────────────────────┘    └────────────────────────────────┘

           ▲
           │ (stdio MCP — adapter-demo today; TechOne/Civica next)
           │
┌──────────┴─────────────────────────────────────────────────┐
│ packages/adapter-demo  — reference RatesAdapter            │
│ Every council platform implements the same contract.       │
└────────────────────────────────────────────────────────────┘
```

The contract package is the platform's public API. Every consumer
(`apps/web`, the MCP adapter, future TechOne / Civica adapters) speaks
to it. No engine reaches around the contract to a platform-specific
client.

---

## Tech stack — AU-residency claim called out

| Layer | Technology | AU residency posture |
|---|---|---|
| Application code | TypeScript 5.6, Node 20 | — |
| Web tier | Next.js 14, Vercel **Sydney edge (`syd1`)** | **In place** — pinned in `vercel.json` |
| Production target | AWS Sydney (`ap-southeast-2`) | **Planned Phase 6** |
| Audit log | Tamper-evident chain (Ed25519 signatures over hash chain) | 7-year retention in-region |
| LLM | Anthropic Claude (Sonnet 4 / 4.5) | AU endpoint where available; otherwise US — disclosed in `PRIVACY-IMPACT-ASSESSMENT.md` |
| Identity | Microsoft Entra SSO + ABR ABN Lookup (AU government) | **Planned Phase 4 (SSO)** / **In place (ABN)** |
| Search / spatial | SLIP (WA Government ArcGIS REST), DMIRS WFS, Landgate cadastre | AU government sources only |
| Observability | pino → BetterStack AU / Sumo Sydney / CloudWatch `ap-southeast-2` | See [`internal/OBSERVABILITY.md`](./internal/OBSERVABILITY.md) |

See [`SECURITY.md`](./SECURITY.md) and [`PRIVACY.md`](./PRIVACY.md) for the
full posture.

---

## Live-data integrations

These tables describe what is wired today. We deliberately distinguish
**LIVE** (fetches real upstream data) from **STUB** (the code paths
exist; live calls return seeded fixtures until a credential or DSA
lands) from **LIVE-WITH-GUID** (calls live data only when the operator
supplies a credential, otherwise honest mock).

| Source | Status | Used for | Path |
|---|---|---|---|
| **DMIRS MINEDEX (WA)** | **LIVE** | Tenement records, recent grants, holder names | `packages/spatial/src/dmirs.ts` |
| **DMIRS SLIP / ArcGIS REST** | **LIVE** | Tenement geometry, intersection joins | `packages/spatial/src/slip.ts` |
| **ABR ABN Lookup** | **LIVE-WITH-GUID** | Owner ABN status (Active / Cancelled / Suspended) | `packages/identity/src/abn.ts` |
| **Landgate cadastre (RPDLU/landuse)** | **STUB** (subscription pending — see [`internal/LANDGATE-ACCESS.md`](./internal/LANDGATE-ACCESS.md)) | Address × landuse reconciliation, parcel polygons | `packages/spatial/src/landgateRestricted.ts` |
| **EMITS environmental approvals** | **STUB** (no public JSON endpoint; deep-links land on EMITS portal) | Active Mining Proposals on intersecting tenements | `packages/spatial/src/emits.ts` |
| **Tengraph** | **STUB** (deep-link in evidence pack) | DMIRS Tengraph context | `packages/spatial/src/tengraph.ts` |
| **TechOne CiAnywhere** | **STUB** (CSV ingest live; REST adapter Phase 2) | Council rating roll ingest | `scripts/import-rating-roll.ts` |
| **Civica Authority** | **PLANNED Phase 2** | Alternative rating-system adapter | — |
| **Nearmap AI change feed** | **STUB** | Aerial change-detection signals | mocked into `EvaluationContext` |
| **Anthropic Claude** | **LIVE-WITH-KEY** | Conversational surface | `apps/web/lib/llm.ts` |

The integration cards in `/connections` mirror this table at runtime so a
council ICT reviewer can see the status without reading code.

---

## Where to go next

| Audience | Read |
|---|---|
| **Council ICT / audit / procurement** | [`SECURITY.md`](./SECURITY.md), [`PRIVACY.md`](./PRIVACY.md), [`DATA-CLASSIFICATION-MATRIX.md`](./DATA-CLASSIFICATION-MATRIX.md), [`PRIVACY-IMPACT-ASSESSMENT.md`](./PRIVACY-IMPACT-ASSESSMENT.md) |
| **Deploying** | [`DEPLOY.md`](./DEPLOY.md), [`internal/PRODUCTION-CHECKLIST.md`](./internal/PRODUCTION-CHECKLIST.md) (when present), [`internal/OBSERVABILITY.md`](./internal/OBSERVABILITY.md) |
| **Engineers extending the platform** | [`RatesAssist.md`](./RatesAssist.md) (master spec), [`PRODUCTION-PLAN.md`](./PRODUCTION-PLAN.md), [`internal/UPLIFT-FORMULA.md`](./internal/UPLIFT-FORMULA.md), [`packages/contract/src/index.ts`](./packages/contract/src/index.ts) |
| **Investors / board members** | [`internal/PROGRESS-SCORECARD.md`](./internal/PROGRESS-SCORECARD.md), [`internal/PILOT-PITCH.md`](./internal/PILOT-PITCH.md) |
| **On-call** | [`ON-CALL.md`](./ON-CALL.md), [`INCIDENT-RESPONSE-RUNBOOK.md`](./INCIDENT-RESPONSE-RUNBOOK.md), [`SLA.md`](./SLA.md) |
| **Operators running a pilot** | [`internal/PILOT-RUNBOOK.md`](./internal/PILOT-RUNBOOK.md) |

---

## Honesty principles

These appear in the data, the evidence packs, and the dashboards — not
just the marketing:

- **No silent fabrication.** When the accurate path cannot be taken (no
  rate table, missing GRV, invalid change date), the engine surfaces a
  typed error and the UI flags the candidate as `heuristic`. We never
  pretend we have data we don't.
- **Every figure carries its formula.** Each candidate's
  `rateFormula` field is a human-readable trail (`GRV × rate = …`) plus
  the council's source URL. A CFO can audit the math line by line.
- **Caveats over assertions.** Stale GRV (Valuer-General older than 3
  years), unverified rate table, statutory cap reached, same-category
  guard, overtaxation detected — each emits a caveat that travels with
  the candidate to the evidence pack.
- **Status is always visible.** The integrations table above, the
  `/connections` page in the app, and the contract types all use the
  same LIVE / STUB / PLANNED vocabulary.

---

## Contact

| Role | Email |
|---|---|
| General | `hello@ratesassist.com.au` *(provisional)* |
| Pilots | `pilots@ratesassist.com.au` *(provisional)* |
| Security | `security@ratesassist.com.au` *(provisional)* |
| Privacy | `privacy@ratesassist.com.au` *(provisional)* |

---

*RatesAssist — Vertical AI for Australian local government rates.*
*© RatesAssist (entity TBC). Confidential.*
