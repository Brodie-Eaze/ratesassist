# RatesAssist — Complete Project Index

> **Every single file, page, API route, component, library, and document — in one place.**

| | |
|---|---|
| **Project root** | `/Users/Brodie/RatesAssist/` |
| **Git repo** | Local, `main` branch, 1 initial commit |
| **Live URL (local)** | http://localhost:3000 |
| **Date** | 2026-05-08 |

---

## 1. Top-level documents (10 files)

The strategic + planning + go-to-market layer. Every one of these is also exported as `.docx` for sharing.

| File | Purpose | Words ≈ |
|---|---|---|
| [`RatesAssist.md`](RatesAssist.md) | **Master specification** — 18 sections, branded, doc-controlled. The single source of truth for what RatesAssist is, how it works, and what it must comply with. | ~12,000 |
| [`README.md`](README.md) | Project entry point + quickstart | ~1,400 |
| [`OVERNIGHT-REPORT.md`](OVERNIGHT-REPORT.md) | Build report from the autonomous overnight session | ~2,200 |
| [`PILOT-PITCH.md`](PILOT-PITCH.md) | One-page external pitch for the first council CFO with FAQ appendix | ~700 |
| [`PILOT-RUNBOOK.md`](PILOT-RUNBOOK.md) | Operational runbook — pre-pilot checklist, 5 stages, daily ops, troubleshooting, exit criteria | ~1,800 |
| [`SECURITY.md`](SECURITY.md) | External-facing security posture, certifications path, vendor risk, disclosure process | ~1,200 |
| [`PRIVACY.md`](PRIVACY.md) | External-facing privacy posture, AI-specific protections, NDB process, retention schedule | ~1,400 |
| [`ENTITY-OPTIONS.md`](ENTITY-OPTIONS.md) | 3 entity vehicles × 2 commitment levels × 5 mum-equity tiers, with cap tables and tax notes | ~2,000 |
| [`BRAND-CANDIDATES.md`](BRAND-CANDIDATES.md) | RatesAssist confirmed; 13 alternatives + rationale; 7-step availability checklist | ~1,000 |
| [`MUM-DISCOVERY.md`](MUM-DISCOVERY.md) | Discovery sheet for the founding-domain-expert call | ~500 |

---

## 2. Outreach drafts (2 files)

Ready-to-send (after your review) emails for the two key external partners.

| File | To | Purpose |
|---|---|---|
| [`outreach/techone-partner.md`](outreach/techone-partner.md) | TechnologyOne ISV partner programme | API access for CiAnywhere + partner status |
| [`outreach/nearmap-eval.md`](outreach/nearmap-eval.md) | Nearmap AU sales | Aerial imagery + AI change-detection eval |

---

## 3. MCP server prototype (3 source files)

Original Model Context Protocol server — runnable today, plugs into Claude Desktop.

| File | Lines | Purpose |
|---|---|---|
| [`src/index.ts`](src/index.ts) | ~600 | MCP server with 12 tools (echo, search, mining mismatch, evidence pack, etc.) |
| [`src/mock-data.ts`](src/mock-data.ts) | ~250 | Property + owner + transaction seed data |
| [`src/wa-tenements.ts`](src/wa-tenements.ts) | ~110 | DMIRS-style tenement seed data |

Build: `npm install && npm run build` then wire to Claude Desktop via `~/Library/Application Support/Claude/claude_desktop_config.json`.

---

## 4. Web app — pages (15 surfaces)

Every page accessible from the sidebar.

| Route | File | What it does |
|---|---|---|
| `/` | [`web/app/page.tsx`](web/app/page.tsx) | **Officer Chat** — agentic multi-tool LLM with signal awareness, suggestion prompts, branded chrome |
| `/properties` | [`web/app/properties/page.tsx`](web/app/properties/page.tsx) | Property explorer — search/filter, full record, embedded map with tenement coverage |
| `/map` | [`web/app/map/page.tsx`](web/app/map/page.tsx) | **Portfolio Map** — Leaflet, 14 basemap providers, real DMIRS WMS overlay, live vector polygons toggle, council filter |
| `/discovery` | [`web/app/discovery/page.tsx`](web/app/discovery/page.tsx) | **Autonomous Discovery Engine** — 6-stage pipeline, real-time activity feed, watchlist, outcome ledger |
| `/recovery` | [`web/app/recovery/page.tsx`](web/app/recovery/page.tsx) | **Recovery Audit** — multi-signal candidate list with composite scores, signal trails, severity filter |
| `/recovery/[id]` | [`web/app/recovery/[assessment]/page.tsx`](web/app/recovery/[assessment]/page.tsx) | Evidence pack viewer with map, full markdown rendering, print-to-PDF export |
| `/signals` | [`web/app/signals/page.tsx`](web/app/signals/page.tsx) | **Signal Catalogue** — 10 signals across 6 categories with weights, sources, descriptions, hit counts |
| `/aerial` | [`web/app/aerial/page.tsx`](web/app/aerial/page.tsx) | Aerial Evidence — split-pane with candidate list, satellite map, side analysis panel |
| `/intel` | [`web/app/intel/page.tsx`](web/app/intel/page.tsx) | **RatesIntel Dashboards** — collection trend (area chart), severity (pie), per-council (bars), top candidates, top overdue |
| `/reconciliation` | [`web/app/reconciliation/page.tsx`](web/app/reconciliation/page.tsx) | Bank deposit matching with auto-match / suggested / unmatched workflows |
| `/certificates` | [`web/app/certificates/page.tsx`](web/app/certificates/page.tsx) | Statutory rates certificate generator (s.6.76 / s.603 / QLD) with downloadable artefact |
| `/activity` | [`web/app/activity/page.tsx`](web/app/activity/page.tsx) | Immutable audit log viewer with category filtering |
| `/tenants` | [`web/app/tenants/page.tsx`](web/app/tenants/page.tsx) | **Multi-tenant + plug-in architecture** — 8 tenants × 23 adapters × cross-council k-anonymous benchmarks (3 tabs) |
| `/connections` | [`web/app/connections/page.tsx`](web/app/connections/page.tsx) | Integration health dashboard for every external system |
| `/citizen` | [`web/app/citizen/page.tsx`](web/app/citizen/page.tsx) | **RatesChat** — public-facing ratepayer self-service chat with separate brand chrome |

---

## 5. Web app — API routes (11 endpoints)

Backend layer.

| Route | File | What it does |
|---|---|---|
| `POST /api/chat` | [`web/app/api/chat/route.ts`](web/app/api/chat/route.ts) | LLM tool-use loop — Anthropic Claude live OR deterministic agentic mock |
| `GET /api/data` | [`web/app/api/data/route.ts`](web/app/api/data/route.ts) | Full data dump (properties, owners, tenements, mismatches, stats) — powers the static surfaces |
| `POST /api/tools/[name]` | [`web/app/api/tools/[name]/route.ts`](web/app/api/tools/[name]/route.ts) | Direct tool invocation — every tool callable via REST without going through the LLM |
| `GET /api/discovery` | [`web/app/api/discovery/route.ts`](web/app/api/discovery/route.ts) | Autonomous-engine pipeline state, activity feed, watchlist, outcomes |
| `GET /api/signals` | [`web/app/api/signals/route.ts`](web/app/api/signals/route.ts) | Detection signal catalogue + per-signal hit counts |
| `GET /api/integrations` | [`web/app/api/integrations/route.ts`](web/app/api/integrations/route.ts) | External integration health (TechOne, DMIRS, Nearmap, ABN, etc.) |
| `GET /api/reconciliation` | [`web/app/api/reconciliation/route.ts`](web/app/api/reconciliation/route.ts) | Bank deposit reconciliation candidates |
| `GET /api/activity` | [`web/app/api/activity/route.ts`](web/app/api/activity/route.ts) | Audit log events |
| `GET /api/tenants` | [`web/app/api/tenants/route.ts`](web/app/api/tenants/route.ts) | Multi-tenant registry + adapter catalogue + cross-council benchmarks |
| `GET /api/spatial/[layer]` | [`web/app/api/spatial/[layer]/route.ts`](web/app/api/spatial/[layer]/route.ts) | Live SLIP/DMIRS GeoJSON proxy (mining tenements, cadastre) |
| `GET /api/evidence/[file]` | [`web/app/api/evidence/[file]/route.ts`](web/app/api/evidence/[file]/route.ts) | Evidence pack export — `.md` and printable `.html` formats |

---

## 6. Web app — components (7 React components)

Reusable UI building blocks.

| File | Purpose |
|---|---|
| [`web/components/Brand.tsx`](web/components/Brand.tsx) | RatesAssist wordmark + product badge |
| [`web/components/Sidebar.tsx`](web/components/Sidebar.tsx) | Left navigation with grouped sections (Workspace, Recovery, Intel, Operations, Admin, Public) |
| [`web/components/Chat.tsx`](web/components/Chat.tsx) | Chat interface with tool-call indicator, busy state, persistent history |
| [`web/components/Markdown.tsx`](web/components/Markdown.tsx) | GFM markdown renderer with custom prose styling |
| [`web/components/PortfolioMap.tsx`](web/components/PortfolioMap.tsx) | Leaflet wrapper with SSR-safe dynamic import + AU defaults |
| [`web/components/MapInner.tsx`](web/components/MapInner.tsx) | Actual Leaflet implementation — basemaps, WMS overlays, live GeoJSON, popups, buffer rings |
| [`web/components/IntelCharts.tsx`](web/components/IntelCharts.tsx) | Recharts: collection trend (area), severity (pie), per-council (bar) |

---

## 7. Web app — library modules (11 modules)

The brain. Pure logic, no React.

| File | Purpose |
|---|---|
| [`web/lib/types.ts`](web/lib/types.ts) | Domain types — Property, Owner, Tenement, MismatchCandidate, SignalDef, SignalHit, etc. |
| [`web/lib/data.ts`](web/lib/data.ts) | In-memory data layer — 8 councils, 115 properties, 79 owners, 20 tenements, 23 integrations, 13 activity events, 7 bank deposits |
| [`web/lib/recovery.ts`](web/lib/recovery.ts) | **Multi-signal detection engine** — 10 signals, weighted composite scoring, evidence pack generation |
| [`web/lib/tools.ts`](web/lib/tools.ts) | LLM tool catalogue (14 tools) + handlers — search, lookup, audit, draft, verify, fetch |
| [`web/lib/llm.ts`](web/lib/llm.ts) | Anthropic Claude tool-use loop + agentic mock fallback (13 intent routes) |
| [`web/lib/dmirs.ts`](web/lib/dmirs.ts) | DMIRS WFS integration with cache + offline-safe fallback |
| [`web/lib/abn.ts`](web/lib/abn.ts) | ATO ABN Lookup integration with mock fallback |
| [`web/lib/spatial.ts`](web/lib/spatial.ts) | SLIP REST API proxy — fetch real GeoJSON polygons by bbox + layer; buffer polygon helper |
| [`web/lib/basemaps.ts`](web/lib/basemaps.ts) | 14 basemap providers (OSM, Esri ×4, CARTO ×2, OpenTopoMap, Mapbox ×4, MapTiler, Nearmap) + 2 WMS overlays |
| [`web/lib/tenants.ts`](web/lib/tenants.ts) | Multi-tenant registry — adapter status, capabilities, isolation tier, cross-council k-anonymous benchmarks |
| [`web/lib/utils.ts`](web/lib/utils.ts) | `cn()`, `formatAud()`, `shortDate()` — small helpers |

---

## 8. Configuration files

| File | Purpose |
|---|---|
| [`.gitignore`](.gitignore) | node_modules, build artefacts, .env.local, .docx, .next/ |
| [`.env.example`](.env.example) | All env vars documented (Anthropic, Mapbox, Nearmap, MapTiler, ABN GUID, etc.) |
| [`web/package.json`](web/package.json) | Next.js 14.2.35, React 18.3, Anthropic SDK, react-leaflet, recharts, react-markdown |
| [`web/tsconfig.json`](web/tsconfig.json) | Strict TypeScript, bundler module resolution, `@/*` path alias |
| [`web/tailwind.config.ts`](web/tailwind.config.ts) | RatesAssist brand palette (ink, accent, success, warn, critical) + Arial typography |
| [`web/next.config.js`](web/next.config.js) | Server Actions enabled, body size limit |
| [`web/postcss.config.js`](web/postcss.config.js) | Tailwind + Autoprefixer pipeline |
| [`package.json`](package.json) | Top-level (MCP server) — Anthropic MCP SDK + Zod |
| [`tsconfig.json`](tsconfig.json) | MCP server TS config (Node16 module resolution) |

---

## 9. Detection signals — the secret sauce

10 signals across 6 categories, defined in [`web/lib/recovery.ts`](web/lib/recovery.ts):

| Category | Signal | Weight | Source |
|---|---|---|---|
| Register | Producing tenement on rural/vacant rate | +0.55 | DMIRS MINEDEX (WA) / state mining registers |
| Register | Producing GPL on vacant rate (solar/infra) | +0.55 | DMIRS MINEDEX |
| Register | Live mining lease on rural/vacant rate | +0.45 | DMIRS MINEDEX |
| Register | Exploration tenement only — review | +0.20 | DMIRS MINEDEX |
| Identity | Owner ABN cancelled or suspended | +0.30 | ATO ABN Lookup |
| Identity | Tenement holder differs from rated owner | +0.30 | DMIRS + TechOne owner record |
| Corporate | Industry indicator in owner name vs rural rate | +0.20 | ASIC company register + ABN Lookup |
| Behavioural | Owner portfolio is mining-dominant | +0.20 | Internal portfolio analysis |
| Spatial | High-value rural — outlier in suburb | +0.15 | Internal spatial-pattern analysis |
| Aerial | Recent aerial change detected | +0.30 | Nearmap AI change feed |

Composite score = sum of weights, capped at 1.0. Severity: high ≥ 0.60, medium ≥ 0.35, low ≥ 0.15. Tenement-class signals are mutually exclusive.

---

## 10. LLM tool catalogue

14 tools exposed to Claude (and to direct API callers), defined in [`web/lib/tools.ts`](web/lib/tools.ts):

| Tool | Purpose |
|---|---|
| `search_property` | Search by address, suburb, postcode, assessment |
| `search_by_owner` | Owner name search with optional suburb filter |
| `get_property_detail` | Full record incl. owners, tenements, notes |
| `get_transaction_history` | Levies, payments, adjustments, interest |
| `list_overdue` | Outstanding-balance debtors |
| `find_mining_mismatches` | Multi-signal recovery audit (the headline) |
| `generate_evidence_pack` | Council-grade reclassification case file |
| `recovery_summary` | Aggregate recovery position |
| `daily_briefing` | Morning operations + recovery summary |
| `draft_payment_reminder` | Personalised reminder (preview-only) |
| `draft_chase_all_overdue` | Batch chase preview |
| `verify_abn` | ATO ABN Lookup |
| `fetch_dmirs_tenements` | Live DMIRS data fetch |
| `list_councils` | Tenant portfolio enumeration |

---

## 11. How to run

```bash
# Web app
cd /Users/Brodie/RatesAssist/web
npm install        # if not already
npm run dev        # http://localhost:3000

# MCP server (for Claude Desktop)
cd /Users/Brodie/RatesAssist
npm install
npm run build      # produces build/index.js
```

To enable live Claude in the chat:
```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." >> /Users/Brodie/RatesAssist/web/.env.local
# restart dev server
```

To enable premium basemaps (Mapbox / Nearmap / MapTiler):
```bash
echo "NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ..." >> /Users/Brodie/RatesAssist/web/.env.local
# (and others as you have keys)
```

---

## 12. Counts at a glance

| | Count |
|---|---|
| Top-level documents | 10 |
| Outreach drafts | 2 |
| MCP server source files | 3 |
| Web app pages | 15 |
| Web API routes | 11 |
| Web components | 7 |
| Web library modules | 11 |
| Detection signals | 10 |
| LLM tools | 14 |
| Basemap providers | 14 |
| WMS overlay sources | 2 (DMIRS + Landgate) |
| Active integrations | 23 |
| Tenants in demo | 8 |
| Properties seeded | 115 |
| Owners seeded | 79 |
| Tenements seeded | 20 |
| Mismatch candidates surfaced | 21 |
| Annual recovery uplift (demo) | $146,899 |
| Total recovery pipeline (demo) | $587,596 |
| **Files committed to git** | **76** |
| **Lines of code (approx.)** | **~12,000** |

---

## 13. What's intentionally NOT here

To be clear about scope — these are deliberate next-stage items:

- **Postgres + PostGIS** — currently in-memory; production needs a real DB
- **Per-tenant credential vaulting** (AWS Secrets Manager) — currently env-var
- **WorkOS Microsoft Entra SSO** — currently demo user
- **Real ML calibration head** — scoring is rule-based today; ML layer is documented in [`RatesAssist.md` §10](RatesAssist.md) but not implemented
- **Real Nearmap AI change-feed integration** — currently a defined signal with weight + source, ready to wire when API key arrives
- **Production CI/CD pipeline** — local dev only
- **ISO 27001 / IRAP / SOC 2 evidence collection** — certifications target Year 2 per the spec
- **Real test suite** — smoke tests via curl + manual; vitest/Playwright deferred

Each is documented in [`RatesAssist.md`](RatesAssist.md) Sections 11–13 (security, compliance, devops) with the implementation path.

---

## 14. Git state

```
Repo:        /Users/Brodie/RatesAssist/
Branch:      main
Commits:     1 (initial)
Files:       76
Status:      clean
```

To push to a remote later:
```bash
cd /Users/Brodie/RatesAssist
git remote add origin git@github.com:YOUR-ORG/RatesAssist.git
git push -u origin main
```

---

*RatesAssist — Vertical AI for Australian local government rates.*
*Project home: `/Users/Brodie/RatesAssist/`*
