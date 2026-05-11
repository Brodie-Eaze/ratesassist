<!--
  ╔═══════════════════════════════════════════════════════════════════╗
  ║                                                                   ║
  ║                          R A T E S A S S I S T                    ║
  ║                                                                   ║
  ║       Vertical AI for Australian local government rates           ║
  ║                                                                   ║
  ╚═══════════════════════════════════════════════════════════════════╝
-->

# RatesAssist
### Master Specification

> **Vertical AI software for Australian local government rates departments.**
> Productivity. Recovery. Intelligence. Citizen self-service.

---

| | |
|---|---|
| **Document** | RatesAssist Master Specification |
| **Version** | 0.1 — Foundational |
| **Status** | Pre-pilot. Internal working document. |
| **Owner** | Brodie |
| **Domain co-founder** | Pending — see [`ENTITY-OPTIONS.md`](ENTITY-OPTIONS.md) |
| **Last updated** | 2026-05-08 |
| **Confidentiality** | Confidential — not for external distribution |
| **Distribution** | Founders, designated advisors |
| **Supersedes** | None |
| **Next review** | On completion of Phase 0 (validation) |

---

## Document purpose

This document is the single source of truth for **what RatesAssist is, how it works, and what it must comply with** during build and rollout. It is written for three audiences:

1. **Founders** — strategic alignment and decision-making.
2. **Engineering** — to execute the build with no ambiguity on architecture, data model, integrations, or compliance posture.
3. **External advisors** (legal, security, accountancy, regulatory) — to brief them on context with zero verbal handover.

It is opinionated, complete, and intended to be *amended in place* as the company learns. Do not create derivative summaries — refer back here.

---

## Table of Contents

- [1. Executive Summary](#1-executive-summary)
- [2. Problem Statement](#2-problem-statement)
- [3. Product Overview](#3-product-overview)
- [4. Users & Personas](#4-users--personas)
- [5. Capability Catalogue](#5-capability-catalogue)
- [6. Platform Integrations](#6-platform-integrations)
- [7. Cross-Council Intelligence](#7-cross-council-intelligence)
- [8. System Architecture](#8-system-architecture)
- [9. Data Model](#9-data-model)
- [10. AI / LLM Architecture](#10-ai--llm-architecture)
- [11. Security Architecture](#11-security-architecture)
- [12. Compliance & Regulatory](#12-compliance--regulatory)
- [13. DevOps & Infrastructure](#13-devops--infrastructure)
- [14. Pricing & Go-to-Market](#14-pricing--go-to-market)
- [15. Phased Roadmap](#15-phased-roadmap)
- [16. Risks & Mitigations](#16-risks--mitigations)
- [17. Team & Hiring Plan](#17-team--hiring-plan)
- [18. Open Questions](#18-open-questions)
- [Appendix A — Companion Documents](#appendix-a--companion-documents)
- [Appendix B — Glossary](#appendix-b--glossary)
- [Appendix C — Document Control](#appendix-c--document-control)

---

## 1. Executive Summary

### What it is

**RatesAssist** is an AI-native software platform for Australian council rates departments. It overlays existing council systems of record (TechnologyOne CiAnywhere "OneCouncil", Civica Authority) and a curated set of authoritative external datasets (DMIRS mining tenements, Landgate cadastral, Nearmap aerial imagery, ASIC, ATO ABN Lookup, state Valuer-General feeds) to deliver four integrated products:

| Product | Purpose | Buyer |
|---|---|---|
| **RatesAssist** | Officer chat productivity layer | Director Corporate Services / CFO |
| **RatesRecovery** | Anomaly + mining-mismatch detection with evidence packs | CEO / GM / CFO |
| **RatesIntel** | Manager dashboards + cross-council benchmarking | CFO / GM / Council |
| **RatesChat** | Public-facing ratepayer self-service | Director Customer Service / CIO |

### Why now

Three converging forces:

1. **Generative AI** is now reliable enough for production officer workflows when wrapped with proper grounding, audit, and tool-use patterns.
2. **Council tooling** has not been seriously refreshed in 20 years. Officers describe their day as fighting the platform.
3. **Multi-source integration** is finally feasible at SaaS economics — DMIRS + Landgate + Nearmap + TechOne stitched together produces intelligence no single platform can deliver.

The window to establish the category-defining brand in AU council vertical AI is open and narrow.

### Why us

A single irreplaceable asset: a **senior TechOne rates configurator currently running rates departments for multiple councils, manually identifying $30–50M annually in mis-classified rates.** RatesAssist productises this expertise, multiplies its throughput by 5–10×, and extends it to the broader Australian council market.

Combine that with a founder who can ship product end-to-end and the unit economics of AI-native vertical SaaS, and the result is a credible $20–80M ARR opportunity over a five-year horizon.

### Headline numbers

| Metric | 12 months | 24 months | 60 months |
|---|---|---|---|
| Live councils | 3–5 | 15–25 | 80–150 |
| Recurring ARR | $300k–$700k | $5–15M | $40–80M |
| Recovery success-fee revenue (annualised) | $1–3M | $4–10M | $10–30M |
| Headcount | 2 | 6–9 | 25–40 |

These are targets, not promises. Anchored to mum's manual recovery baseline plus realistic SaaS attach rates.

### Revenue model

Hybrid:

- **SaaS subscription** for productivity and reporting tiers (predictable revenue)
- **Success-fee on recovered rates** for the recovery tier (high-margin, council-aligned, no procurement friction)
- **Per-conversation usage** for citizen chat (cost pass-through with margin)

### Defensibility

Five compounding moats: multi-source integration complexity, calibration-data flywheel, certified vendor status (TechOne partner + ISO 27001 + IRAP path), council-to-council reference selling, and state-specific regulatory expertise that takes years to internalise.

### Strategic posture

**Build for AU public sector from day one.** Every architectural decision (data residency, audit, accessibility, statutory compliance) is taken as if a NSW Auditor-General is reviewing it next week. This is slower than consumer SaaS but materially derisks the path to $50k+ contract values and panel placements.

---

## 2. Problem Statement

### 2.1 The user's day today

A rates officer in an Australian council manages four broad categories of work:

1. **Inquiry handling** — phone, email, counter, conveyancer requests, statutory certificate applications.
2. **Lifecycle events** — owner changes after settlement, address updates, supplementary valuations, pensioner rebates.
3. **Revenue management** — debtor chase, payment arrangements, hardship assessments, bank reconciliation.
4. **Anomaly remediation** — finding and correcting rating mis-classifications (mining tenements, land-use changes, vacant-land-not-vacant, undeclared improvements).

Each of these involves repeated context switching across legacy systems with poor search, opaque field semantics, and screen-heavy workflows. Officers describe their work as "the platform fighting me."

### 2.2 The platform reality

The dominant Australian council rating platforms — **TechnologyOne CiAnywhere (OneCouncil)** and **Civica Authority** (formerly Pathway) — are highly capable systems of record but were architected pre-AI, pre-mobile, and pre-conversational-UX. A typical rates lookup that is conceptually one question requires 3–6 screens, partial-text search is weak, and cross-record correlation is manual.

These platforms are unlikely to be replaced. They are deeply embedded, govern statutory processes, and represent millions of dollars in capitalised council investment. RatesAssist therefore positions as a **complementary layer**, not a replacement.

### 2.3 The under-collection problem

Australian councils operate under state-specific rating legislation (NSW *Local Government Act 1993*, WA *Local Government Act 1995*, QLD *Local Government Regulation 2012*, etc.). All states permit differential rating — applying different cents-in-the-dollar rates by land-use category. Mining, commercial, and industrial categories typically carry rates 5–20× higher than residential or rural-agricultural.

When a property's land use changes — a tenement is granted, a vacant block is built on, a residential property is converted to commercial use, a solar farm is installed — the rating record in the council system often does not catch up. Reasons include:

- Manual notification dependency from state agencies.
- Insufficient officer time to monitor large rural areas.
- No automated cross-reference between council rating data and authoritative external registers.
- No standardised aerial-change-detection workflow.

The result: councils systematically under-collect rates from the parties whose land use most justifies higher rating. In WA mining shires this is particularly acute and well-documented.

### 2.4 The citizen-facing problem

Council customer service centres handle high call volumes, with rates enquiries typically the largest single category. Many enquiries are routine — balance lookups, direct-debit setup, statutory certificates. Officers' time is consumed servicing trivially-answerable questions, displacing higher-value work.

### 2.5 The strategic gap

The Australian local government technology market has been historically slow to adopt modern productivity tooling. Generative AI is the first technology shift in two decades that creates a clear, near-term productivity multiplier *and* a defensible new product category (AI-driven anomaly detection across multi-source datasets). The window to establish a category-defining vertical AI brand is open, and narrow. Generic AI tools cannot deliver this value because they lack platform integration, domain calibration, and council-specific compliance posture.

---

## 3. Product Overview

RatesAssist is one platform with four addressable products that share a single backbone.

### 3.1 RatesAssist (productivity layer)

A natural-language interface for rates officers, operating against live council data. Replaces screen-jumping with conversation. Delivers measurable time-saving on repetitive workflows (lookup, drafting, reconciliation). Foundation product; everything else extends it.

| | |
|---|---|
| **Buyer** | Director of Corporate Services / CFO |
| **Pricing** | $99–249 per officer per month |
| **Pitch** | *"Cuts officer admin time 30–50%. Pays back in week one."* |
| **Anchor metric** | Average enquiry handling time (minutes per call) |

### 3.2 RatesRecovery (anomaly + mismatch detection)

The headline revenue line. Cross-references council rating data against DMIRS tenements, Landgate cadastral, Nearmap aerial imagery, and ASIC ownership data to systematically surface mis-classified properties. Generates per-candidate evidence packs. Tracks recovery outcomes and provable revenue uplift.

| | |
|---|---|
| **Buyer** | Council CEO / GM / CFO |
| **Pricing** | Success fee at 10–15% of net additional rates collected, capped at 24 months from correction date. Optional flat retainer ($30–80k/yr) for predictability. |
| **Pitch** | *"We find what your team doesn't have time to find. You only pay on what you actually collect."* |
| **Anchor metric** | Recovered rates ($) per quarter |

### 3.3 RatesIntel (executive reporting & cross-council)

Manager and executive dashboards. Aggregates KPIs across the council and (with permission) anonymously across the buyer's peer group. Surfaces trend anomalies, forecasts cash collection, benchmarks against comparable councils.

| | |
|---|---|
| **Buyer** | CFO / GM / elected councillors (board reporting) |
| **Pricing** | $20–60k per council per year |
| **Pitch** | *"The state of your rates department, before your auditor sees it."* |
| **Anchor metric** | Time to generate board report (hours → minutes) |

### 3.4 RatesChat (citizen self-service)

Public-facing chat embedded in the council website. Authenticated ratepayers handle balance enquiries, direct debit setup, rebate applications, statutory certificate requests, and dispute lodgement without staff involvement.

| | |
|---|---|
| **Buyer** | Director Customer Service / CIO |
| **Pricing** | $15–40k per council per year + per-conversation cost pass-through above fair-use threshold |
| **Pitch** | *"30–50% rates-call deflection. Cheaper than hiring another officer."* |
| **Anchor metric** | Call deflection rate (%) |

### 3.5 The integrated picture

These products are not independent SKUs — they share an MCP backbone, a multi-tenant data layer, and a unified compliance posture. A council typically starts with **either** RatesAssist or RatesRecovery (whichever resonates with the buyer), then expands within 12 months. Average revenue per council at full footprint: **$80k–$200k/year recurring + recovery-fee upside**.

---

## 4. Users & Personas

### 4.1 Internal users (council staff)

| Persona | Role | Daily volume | What RatesAssist gives them |
|---|---|---|---|
| Rates Officer (frontline) | Phone/counter enquiry, lifecycle updates | 30–60 enquiries/day | 5–10× faster lookup, drafted comms, fewer screens |
| Senior Rates Officer | Complex cases, statutory certs, hardship | 15–25 cases/day | Workflow tools, evidence pack generation |
| Rates Coordinator / Team Lead | Workload allocation, escalations, training | 5–10/day | Briefings, exception lists, audit trail |
| Revenue / Finance Manager | Collection KPI, reporting, cashflow | Weekly | RatesIntel dashboards |
| Director Corporate Services / CFO | Strategic decisions, audit, board reporting | Monthly | Cross-council benchmarking, recovery ROI proof |
| GM / CEO | High-level only | Quarterly | Recovery success summary, peer comparison |

### 4.2 External users

| Persona | Role | What they do |
|---|---|---|
| Ratepayer (resident) | Pays rates | Self-service enquiry, payment, applications |
| Ratepayer (commercial / property holding) | Multi-property management | Bulk balance lookup, certificate procurement |
| Conveyancer / solicitor | Settlement support | Section 603 / 184 / equivalent certs |
| Pensioner | Eligibility-driven | Rebate application |
| Auditor (Audit Office of WA / NSW Audit Office / etc.) | Statutory audit | Read-only access to audit-trail exports |

### 4.3 Special: domain co-founder

A current senior TechOne rates configurator running multiple councils, with an unmatched manual recovery track record. Plays three irreplaceable roles:

- **Customer zero** — the platform deploys to her existing council portfolio for v1 validation.
- **Calibration source** — her tacit knowledge of "what looks wrong" trains the anomaly scoring.
- **Distribution channel** — direct relationships with council CFOs across her network short-circuit cold sales.

Equity, role, and time commitment are formalised in [`ENTITY-OPTIONS.md`](ENTITY-OPTIONS.md).

---

## 5. Capability Catalogue

A complete feature catalogue across all four products. Sequencing in [Section 15](#15-phased-roadmap).

### 5.1 Lookup & search

- Property by address (full or partial), suburb, postcode, assessment number
- Property by owner name, owner phone, owner email, ABN, ACN
- Owner profile across all linked properties in one or more councils
- Linked records: rebate, hardship, payment arrangement, direct debit, attached documents
- Spatial search (*"all properties within 500m of [address]"*)
- Tenement search (*"all WA tenements within this LGA boundary"*)
- Document search (*"every notice sent to this address in the last 5 years"*)
- Saved queries / shareable saved searches per officer

### 5.2 Property detail surfaces

- Full property record card (assessment, address, owner, valuation, balance, history)
- Transaction history with running balance
- Valuation history and supplementary valuation events
- Rates levy + adjustment + interest breakdown
- Tenure / owner change timeline with prior owner records
- Map view with cadastral overlay + aerial imagery + tenement overlay
- Document gallery (notices, certs, correspondence)

### 5.3 Lifecycle workflows (writes)

- Owner change after settlement (incoming notice from PEXA / titles → owner update + final-notice-to-vendor + welcome-to-purchaser)
- Address change for postal correspondence
- Direct debit setup, change, suspension
- Payment arrangement creation, modification, breach handling
- Pensioner rebate application capture, eligibility check, system update
- Hardship assessment with options drafting and determination letter
- Section 603 / 184 / 132 / state-equivalent statutory certificates with PDF generation

All write operations follow the **preview-then-confirm** pattern: tool returns a structured proposal, user explicitly confirms before commit. No silent state changes.

### 5.4 Communication

- Personalised payment reminder drafting (friendly / firm / final) per debtor
- Batch debtor chase with preview gallery
- SMS via Twilio / MessageMedia / council's SMS gateway
- Email via council's exchange / SendGrid / etc.
- Email enquiry triage (incoming → categorise → draft reply → flag for review)
- Outbound campaigns (annual notice, supplementary, overdue waves)
- Counter / call-centre quick-action mode (sub-2-second response)

### 5.5 Reconciliation

- Bank deposit batch matching (CSV / camt.053 / direct bank-feed)
- Suspense account triage (unidentified payments → likely-match suggestions)
- Period close support (month-end, quarter-end exception lists)
- Cash receipt vs. ledger drift detection

### 5.6 Anomaly detection (RatesRecovery core)

- Mining tenement vs. rating classification mismatch
- **DMIRS ahead of Landgate cadastre** (`reg.dmirs_ahead_of_landgate`, weight 0.50): the platform's headline cross-register signal. Joins live DMIRS grants against the public WA landuse classification (Landgate / DPIRD); fires inside the multi-week-to-multi-month lag window where a producing mining lease sits on a parcel still classified Rural / Vacant. The highest-confidence recovery opportunity available before any council audit cycle, surfaced live at `/recovery` under the "⚡ Cadastre lag (high-confidence)" filter. See `internal/SIGNAL-dmirs-ahead-of-landgate.md`.
- **Newly-granted tenement alerts** (DMIRS via SLIP): a fresh LIVE grant on a parcel currently rated rural/vacant is the headline sales-trigger event — the council can lawfully reclassify the parcel to a higher rate category and recover up to three years of backdated arrears within statutory limits. Surfaced live in the officer console at `/alerts`, with the 30-day wardens-court appeal window flagged as "provisional".
- Vacant-land-not-vacant detection via aerial imagery
- Undeclared improvement detection (new structures since last valuation)
- Solar farm detection (high-revenue reclassification opportunity)
- Subdivision detection ahead of titles update
- Land-clearing / commercial use change
- Tenement holder vs. rated owner mismatch (common after lease transfer)
- Producing-tenement-on-rural-rate (highest priority recovery candidates)
- Address-variant deduplication (Bob Smith vs Robert Smith on multiple records)
- Rebate-eligible-but-unclaimed pensioner detection

### 5.7 Evidence pack generation (RatesRecovery)

For each candidate, generate a council-ready evidence document containing:

- Property identification (assessment, address, cadastral diagram)
- Current rating classification + historical changes
- Proposed rating classification + statutory basis (cite the specific Act + section)
- Authoritative external evidence (tenement record, aerial imagery, ABN lookup)
- Estimated annual rates uplift
- Suggested arrears recovery amount (within statutory backdating limit per state)
- Owner contact details
- Draft reclassification notice (state-appropriate template)
- Draft objection-rights-and-process notice
- Audit trail of the data sources and timestamps used

Evidence packs are the artefact rates officers (and their legal teams) will scrutinise. Quality of output here is product-defining.

### 5.8 Reporting (RatesIntel)

- Daily officer briefing (per-officer, per-council)
- Weekly manager dashboard (collection rate, arrears aging, % on arrangements, EOM cash forecast)
- Monthly council board pack
- Quarterly cross-council benchmarking (anonymised peer comparison)
- Annual audit prep pack
- Custom cohort reports (*"all properties on hardship arrangements over 12 months"*)
- Anomaly detection alerts on sudden behaviour change (*"Account X stopped paying after 11 years"*)
- Forecasting (30/60/90 day cash collection, full-year revenue projection)

### 5.9 Citizen self-service (RatesChat)

- Authenticated balance / payment enquiry
- Self-service direct debit setup
- Pensioner rebate application capture (with document upload)
- Statutory certificate ordering with payment
- Dispute lodgement with structured intake
- FAQ chat for council-specific information
- Hand-off to human officer with full transcript

### 5.10 Administrative

- User management with role-based access control
- Council configuration (rating categories, certificate templates, brand)
- Workflow customisation per council
- Audit log of all reads and writes
- Officer-level performance metrics (with privacy guardrails)
- Backup & export (*"get me everything you have on this council"*)

---

## 6. Platform Integrations

### 6.1 Primary (rating system of record)

#### TechnologyOne CiAnywhere — OneCouncil Property & Rating *(target #1)*

- **Integration vector:** CiAnywhere REST API (preferred) / ECM Web Services (fallback) / direct DB read (legacy councils, with caveat)
- **Authentication:** OAuth 2.0 client credentials per council instance
- **Capabilities required:** GET property, GET owner, GET transactions, PATCH owner contact, POST note, GET document
- **Rate limits:** per-council, must implement back-off
- **Partner status:** pursue TechOne ISV partnership for distribution + roadmap visibility
- **Strategic note:** TechOne has ~70% share of large/metro AU councils + most of NZ. Partnership is a multiplier.

#### Civica Authority *(formerly Pathway, target #2)*

- **Integration vector:** Civica REST API where enabled; otherwise file-based exchange (CSV nightly)
- **Authentication:** API key per council
- **Coverage:** strong in NSW + smaller councils
- **Strategic:** partner application after first 3 TechOne councils live

Other systems (**Open Office**, **PCA**, **MagiQ**) deferred to phase 3+.

### 6.2 Mining / land use (RatesRecovery)

- **DMIRS — MINEDEX / GeoVIEW.WA** — public WFS feeds + downloadable shapefile + REST endpoints; daily ingestion
- **Geological Survey of Queensland** — QLD equivalent (phase 2)
- **MinView (NSW)** — NSW equivalent (phase 2)
- **GeoVic** — Victorian equivalent (phase 2)
- **State royalty data** — quarterly published reports per state, used for confidence scoring

### 6.3 Cadastral / spatial

- **Landgate SLIP** (WA cadastral)
- **NSW Spatial Services / Six Maps** (NSW)
- **Vicmap** (Victoria)
- **QLD Globe / DCDB** (Queensland)
- **PSMA / Geoscape G-NAF** (national address dataset, paid)

### 6.4 Aerial imagery

- **Nearmap** *(target #1 — strongest AI change detection product)*
- **Metromap** — competitive alternative, often cheaper
- **Geoscape Buildings + Surfaces** — derived datasets, useful for anomaly scoring

### 6.5 Identity / entity

- **ABN Lookup (ATO)** — free public API, validates ABN and entity name
- **ASIC Connect** — director details for company-owned properties (free + paid tiers)
- **PEXA** — incoming property transfer notifications (membership required, complex)

### 6.6 Valuation

- **WA Valuer-General / Landgate** (statutory valuations)
- **NSW Valuer General**
- **VG Vic, QLD VG, etc.**
- **CoreLogic / Domain** — supplementary valuation cross-check (commercial)

### 6.7 Communications

- **Twilio** — SMS + voice, default
- **MessageMedia** — Australian-owned alternative, often preferred by councils
- **SendGrid / AWS SES** — transactional email
- **Council's own Exchange / Microsoft 365** — when council mandates

### 6.8 Payments

- **BPAY** — view-only; council's existing biller setup
- **Stripe** — for RatesChat citizen payments where council permits
- **Eway / SecurePay** — common Australian processors
- **Direct debit (BECS)** — via the council's existing bank arrangement

### 6.9 Document & e-signature

- **DocuSign / Adobe Sign** — payment arrangements, rebate forms
- **AWS S3 / Azure Blob** — document storage with KMS encryption
- **Council's own EDRMS** (Content Manager / Objective / Trim) — write-back required for compliance

### 6.10 Identity & access

- **Microsoft Entra ID (Azure AD)** — SSO, default for council staff
- **Google Workspace** — secondary
- **Auth0 / WorkOS** — for our own platform identity
- **MyGovID / VANguard** — explored for citizen authentication in RatesChat

### 6.11 Observability

- **Datadog / Grafana Cloud** — metrics + logs (AU region)
- **Sentry** — error tracking
- **OpenTelemetry** — instrumentation standard

---

## 7. Cross-Council Intelligence

This is the category that compounds value over time and is uncopyable without our customer footprint.

### 7.1 Within-tenant intelligence

For a single council:

- Trend detection (*"hardship applications up 40% MoM — investigate"*)
- Officer performance metrics (anonymised by default)
- Workflow bottleneck identification
- Anomaly scoring calibration as feedback loop

### 7.2 Cross-tenant intelligence (with consent)

For councils opted into peer benchmarking:

- Anonymised collection rate comparison
- Rate-setting comparison (*"your residential rate is 12% above peer median"*)
- Rebate uptake comparison
- Recovery rate comparison
- Workflow efficiency comparison

Anonymisation requires k-anonymity (no group smaller than 5 councils) and aggregation thresholds. **No raw cross-tenant data exchange.**

### 7.3 Domain expert codification

Mum's tacit knowledge becomes encoded over time as:

- Heuristics in the anomaly scoring engine
- Heuristics in evidence-pack templates
- Workflow defaults per council size / state / geography
- Training data for fine-tuned classifier models (later phase)

### 7.4 Network effects

Each new council:

- Adds calibration data points for anomaly detection
- Validates additional integration patterns
- Extends reference list for sales
- Increases the value of the cross-council intelligence layer for all customers

---

## 8. System Architecture

### 8.1 High-level architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Council Officer (web)                         │
│                       Council Citizen (web)                         │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────────────────┐
│  RatesAssist Web App (Next.js, AU-hosted)                           │
│  - Chat UI                                                          │
│  - Workflow UI (forms, evidence pack viewers, dashboards)           │
│  - Admin UI                                                         │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ Internal HTTPS / mTLS
┌──────────────────────▼──────────────────────────────────────────────┐
│  RatesAssist Backend (Node/TypeScript, AU-hosted)                   │
│  - REST API (sessions, users, billing, audit)                       │
│  - LLM orchestration (Anthropic Claude API, AU region)              │
│  - MCP host: connects to per-council MCP servers                    │
│  - Tenant config + policy engine                                    │
│  - Audit log writer (immutable)                                     │
└────┬───────────────────────────┬───────────────────────────┬────────┘
     │                           │                           │
     │ MCP (stdio or HTTP)       │ Anthropic API             │ Internal
     │                           │                           │
┌────▼─────────┐         ┌───────▼────────┐         ┌────────▼────────┐
│ MCP Servers  │         │ Claude         │         │ Postgres (RDS)  │
│ (per-tenant) │         │ Sonnet 4.6 /   │         │ - Tenant config │
│              │         │ Opus 4.7 /     │         │ - User accounts │
│              │         │ Haiku 4.5      │         │ - Audit log     │
└──┬───────────┘         └────────────────┘         │ - Calibration   │
   │                                                │ - Cross-council │
   │ Per-council integrations:                      │   benchmarks    │
   │  - TechOne CiAnywhere (OAuth)                  └─────────────────┘
   │  - DMIRS / Landgate (public)
   │  - Nearmap (API key)
   │  - ABN/ASIC
   │  - SMS/email gateways
   │  - Council EDRMS
```

### 8.2 Component breakdown

#### 8.2.1 Frontend (RatesAssist Web)

- **Stack:** Next.js 15+, TypeScript, TailwindCSS, shadcn/ui
- **Hosting:** Vercel AU region OR AWS Sydney (ap-southeast-2) via OpenNext
- **Authentication:** Microsoft Entra SSO via WorkOS (officer side); MyGovID / email-link (citizen side)
- **Key surfaces:**
  - Chat (officer)
  - Property explorer (forms, maps, document gallery)
  - Workflow runners (dispute, rebate, reconcile)
  - Evidence pack viewer + editor
  - Dashboards (RatesIntel)
  - Admin (tenant config, users, billing, audit)
  - Citizen chat (RatesChat) — separate route, separate brand

#### 8.2.2 Backend (RatesAssist Core)

- **Stack:** Node.js 22, TypeScript, Hono / Fastify, Drizzle ORM
- **Hosting:** AWS Sydney (ap-southeast-2) — Fargate or Lambda + API Gateway
- **Database:** Postgres (Aurora Serverless v2), AU region only
- **Cache:** Redis (ElastiCache) for session + tenant config
- **Object storage:** S3 (Sydney) for document artefacts, evidence packs, exports
- **Queueing:** SQS for async work (data ingestion, evidence pack generation, batch comms)
- **Secrets:** AWS Secrets Manager + KMS

#### 8.2.3 MCP servers (per-tenant)

- A logical MCP server bundle exposing tools relevant to the tenant's stack
- Tools call through to the council's specific TechOne/Civica instance using credentials stored in Secrets Manager and never logged
- MCP runs in-process within the backend (preferred for latency) OR in separate containers (when hardening boundaries are required)

#### 8.2.4 LLM orchestration

- Anthropic Claude API as the model layer — Sonnet 4.6 default, Opus 4.7 for complex reasoning, Haiku 4.5 for fast lookups
- AU data residency where Anthropic offers it; verified per request
- Prompt caching enabled (system prompt, tool catalogue, council context)
- Tool-use loop: model → tool selection → MCP call → tool result → model → user
- Structured output for evidence packs and reports

#### 8.2.5 Data ingestion services

Standalone scheduled workers:

- DMIRS tenement refresh (daily)
- Landgate cadastral refresh (weekly)
- Nearmap change-detection sync (per-council, scheduled)
- ABN/ASIC verification (on-demand + nightly batch)
- Cross-council benchmark aggregation (weekly)

### 8.3 Multi-tenant model

**Tenant = council.** A single user (e.g. mum) may have access across multiple tenants via membership.

**Isolation strategy:**

- Logical isolation in Postgres via row-level security (RLS) keyed on `tenant_id`
- All tables tenant-scoped except shared reference data (DMIRS tenements, etc.)
- Per-tenant credentials (TechOne tokens, etc.) stored in Secrets Manager with tenant-keyed paths
- Per-tenant rate limiting at the API gateway
- Per-tenant audit log partition

**Optional physical isolation:** offered for councils with strict security posture (separate VPC, separate database, +50% premium). Default is logical.

### 8.4 Authentication & authorisation

#### Officer side

- Microsoft Entra SSO via WorkOS
- Roles: `viewer`, `officer`, `senior_officer`, `coordinator`, `manager`, `admin`
- Permissions: granular per tool (e.g. `tool.send_sms`, `tool.write_owner`, `tool.generate_evidence_pack`)
- Session: short-lived JWT + rolling refresh
- Step-up for high-risk operations (batch chase, owner edit, certificate generation)

#### Citizen side

- Email magic link OR MyGovID (where supported)
- Property linkage: ratepayer must prove ownership via assessment number + verifiable detail (last payment amount or notice number)
- Per-property authorisation

### 8.5 Audit & logging

Every read and write produces an audit event:

- **Who** — user, role, tenant, IP, device
- **When** — timestamp + monotonic sequence
- **What** — tool name, parameters, result hash
- **Why** — linked conversation ID, optional officer-supplied reason

Audit log:

- Immutable (append-only, with periodic Merkle-tree anchoring for tamper detection)
- Retained 7 years (state records compliance)
- Exportable per tenant on demand and on offboarding

---

## 9. Data Model

A condensed, illustrative subset of the core entities. Full DDL is maintained in `/db/schema/` of the production codebase.

### 9.1 Core entities

```
tenants                     -- council registrations (global)
  id, name, state, abn, techone_instance_url, civica_instance_url, ...

users                       -- people with access (global)
  id, email, name, sso_subject, ...

tenant_memberships          -- which users access which tenants + roles
  tenant_id, user_id, role, permissions[], created_at, ...

properties                  -- mirror of TechOne assessments (per tenant)
  id, tenant_id, assessment_number, address, cadastral_id,
  current_classification, valuation, annual_rates, balance, ...

owners                      -- mirror of TechOne owner records (per tenant)
  id, tenant_id, external_id, name, abn, postal_address, ...

property_owners             -- many-to-many (per tenant)
  property_id, owner_id, role, since, until, ...

transactions                -- ledger entries (per tenant)
  id, tenant_id, property_id, date, type, amount, reference, balance, ...

documents                   -- attached docs (per tenant)
  id, tenant_id, property_id, type, storage_uri, sha256, ...

tenements                   -- DMIRS feed (global, refreshed daily)
  id, tenement_code, type, status, holder, abn, commodity[],
  area_hectares, polygon, granted_date, expiry_date, is_producing, ...

cadastral_parcels           -- Landgate (global, refreshed weekly)
  id, parcel_id, polygon, lot_plan, lga_code, ...

mismatch_candidates         -- detected anomalies (per tenant)
  id, tenant_id, property_id, kind, evidence_refs[],
  confidence, estimated_uplift_aud, status, opened_at, resolved_at, ...

evidence_packs              -- generated artefacts (per tenant)
  id, tenant_id, mismatch_id, version, storage_uri, sha256,
  generated_at, generated_by, ...

audit_events                -- immutable (per tenant, partitioned)
  id, tenant_id, ts, user_id, action, parameters_json,
  result_hash, conversation_id, ...

conversations               -- chat sessions (per tenant)
  id, tenant_id, user_id, started_at, ended_at, messages[], ...

cross_council_benchmarks    -- aggregated, k-anonymous (global)
  metric, period, peer_group, p25, p50, p75, p90, ...
```

### 9.2 Privacy classification

Every column carries a privacy classification tag in metadata:

| Class | Examples | Treatment |
|---|---|---|
| **Public** | assessment number, address, land-use category | logged, sent to LLM |
| **Internal** | valuation, rates amount, balance | logged, sent to LLM with role check |
| **Sensitive** | owner contact details, payment method, hardship status | logged hash only, redacted from LLM by default |
| **Highly sensitive** | pensioner status, medical hardship grounds | field-level encryption, never sent to LLM |

Classification drives logging, encryption at rest, redaction in LLM prompts, and export controls.

### 9.3 Data flow into LLM

The LLM never receives raw bulk data. Patterns:

- **Lookup tools** return scoped, filtered fields
- **Summary tools** aggregate before returning
- **Sensitive fields** redacted unless the user role grants access
- **PII minimisation** — owner names included only when the question requires identification

Audit log captures the exact data that left the system to the LLM, so a council can verify retrospectively.

---

## 10. AI / LLM Architecture

### 10.1 Model selection

| Use case | Model | Reason |
|---|---|---|
| Default chat | Claude Sonnet 4.6 | Best cost/quality balance |
| Complex reasoning (evidence pack, dispute analysis) | Claude Opus 4.7 (1M context) | Long-context + sharper inference |
| Fast lookup / triage | Claude Haiku 4.5 | Sub-second latency, cheap |
| Citizen chat | Haiku 4.5 → Sonnet on escalation | Cost control |

All models accessed via Anthropic API (AU region where available). No third-party LLMs in v1.

### 10.2 Prompt architecture

**System prompt** (~3–5k tokens, cached):

- Council context (name, state, key policies)
- Officer role + permissions
- Available tools (catalogue)
- Safety policies (no auto-send, no destructive actions, redaction rules)
- Output format guidance

**Per-conversation context:**

- Recent message history
- Active property / case context
- Officer's saved searches and preferences

**Tool-use loop:**

- Model issues tool call → MCP host validates → MCP server executes → result returned → model continues
- Step-up authentication enforced server-side, not relied on the model

### 10.3 Hallucination safeguards

- **Tool-grounded only** — the model is instructed never to assert balance/owner/property facts not retrieved via a tool in the current conversation
- **Citation required** — every factual claim returned to the user has the tool call ID it came from
- **Disagreement protocol** — when the model has competing information, it surfaces both and asks
- **Anomaly-detection guard** — scoring is deterministic (rule + ML), not LLM-generated; the LLM only narrates and presents
- **Evidence pack QA** — structured-output schemas enforced; deterministic post-processing validates required fields, statutory citations, dollar calculations

### 10.4 Prompt caching

- System prompt cached (5-minute TTL, refreshed on tenant config change)
- Tool catalogue cached
- Council context cached
- Cost reduction: 70–90% on repeat conversation turns

### 10.5 Cost model (per officer per month)

| Variable | Value |
|---|---|
| Avg conversations per day per officer | 30 |
| Avg turns per conversation | 4 |
| Avg input tokens per turn (with caching) | 1,500 |
| Avg output tokens per turn | 400 |
| Sonnet pricing (cached) | ~$0.30 input + $0.30 output / officer / day |
| Monthly per officer | **~$10–15 LLM cost** |
| Pricing at $99–249/seat | **85–94% gross margin** |

---

## 11. Security Architecture

See [`SECURITY.md`](SECURITY.md) for the externally-shareable security posture summary. The version below is the canonical engineering reference.

### 11.1 Threat model

Primary threats:

1. Unauthorised access to council data (insider or external)
2. Cross-tenant data leakage
3. Compromise of council credentials (TechOne, Nearmap)
4. LLM prompt injection from external content (incoming emails, document text)
5. Data exfiltration via LLM output
6. Tampering with audit logs
7. Compromise via supply chain (npm, container base images)

### 11.2 Controls

#### Network

- VPC with private subnets for compute and data
- Public surfaces (web app, API gateway) with WAF (AWS WAF + Cloudflare)
- Per-tenant inbound IP allowlist option for sensitive councils
- All traffic TLS 1.3

#### Compute

- Container-based (Fargate or Lambda)
- Image scanning (Trivy, Snyk) on every build
- No SSH; ephemeral sessions only
- Least-privilege IAM
- CIS-benchmark hardened base images

#### Data

- Encryption at rest (KMS, customer-managed keys per tenant for premium tier)
- Encryption in transit (TLS 1.3)
- Field-level encryption for highly-sensitive fields (pensioner status, hardship grounds)
- Tokenisation of bank account numbers
- Backup encryption + AU-region replication
- Immutable audit log with Merkle anchoring
- Right-to-be-forgotten workflow with per-state-Privacy-Act considerations

#### Identity

- SSO mandatory for officers (Microsoft Entra)
- MFA enforced; FIDO2 preferred
- Session bindings to device + IP
- Step-up auth for high-risk operations
- Just-in-time provisioning + automatic deprovisioning on SSO removal

#### Application

- Input validation on every API + tool call
- Output encoding to prevent injection in chat-rendered HTML
- LLM output passed through prompt-injection screening before tool dispatch
- No user-controlled URL fetches without allowlist
- Rate limiting per tenant + per user
- CORS strictly scoped

#### Supply chain

- Dependabot / Renovate auto-PRs
- npm audit + license scanning (FOSSA / Snyk)
- SBOM generated per release (CycloneDX)
- Reproducible builds where possible
- Critical-path libraries pinned + reviewed

#### Operational

- Quarterly penetration testing (CREST-accredited)
- Annual third-party security audit
- 24/7 on-call with documented runbooks
- Incident response plan tested quarterly
- Customer notification SLA per Privacy Act NDB scheme (72h target, 30 day max)

### 11.3 Certifications target

| Certification | Target | Reason |
|---|---|---|
| Essential Eight Maturity 1 | Year 1 | ACSC standard, growing council expectation |
| Essential Eight Maturity 2 | Year 2 | Required by some state govt cyber policies |
| ISO 27001 | Year 2 | Many councils require for $50k+ contracts |
| SOC 2 Type II | Year 2 | Useful for any private-sector adjacency |
| IRAP — PROTECTED | Year 3 | Required for federal & some state workloads |

---

## 12. Compliance & Regulatory

See [`PRIVACY.md`](PRIVACY.md) for the externally-shareable privacy posture summary. The version below is the canonical engineering reference.

### 12.1 Privacy law

#### Federal

- **Privacy Act 1988 (Cth)** — Australian Privacy Principles (APPs 1–13). Particular attention to APP 1, 5, 6, 8, 11, 12, 13.
- **Notifiable Data Breaches scheme** — eligible breach notification within 30 days of awareness; OAIC + affected individuals.
- **Privacy (Credit Reporting) Code** — relevant for credit-related rates work.
- **Spam Act 2003** + **Do Not Call Register Act 2006** — for outbound SMS/email/voice.

#### State (varies by where council sits)

- **NSW Privacy and Personal Information Protection Act 1998** — applies to NSW councils, more stringent than federal in some respects
- **Health Records and Information Privacy Act 2002 (NSW)**
- **Information Privacy Act 2009 (QLD)**
- **Privacy and Data Protection Act 2014 (VIC)**
- **Personal Information Protection Act 2004 (TAS)**
- **Information Privacy Act 2014 (ACT)**
- **Information Act 2002 (NT)**
- **WA — no state privacy act** — WA councils default to the Privacy Act 1988

### 12.2 Local government statutes

Each state's Local Government Act prescribes the rates legal framework. Relevant for evidence pack drafting + statutory certificate generation:

| State | Statute | Notes |
|---|---|---|
| NSW | Local Government Act 1993 (s.514–610) + LG (General) Regulation 2021 | Section 603 cert |
| VIC | Local Government Act 2020 + LG Act 1989 (rates) | Section 229 cert |
| QLD | Local Government Regulation 2012 (Ch. 4) | Section 95 cert |
| WA | Local Government Act 1995 (s.6.32–6.81) | Section 6.16 differential, s.6.81 backdating |
| SA | Local Government Act 1999 (Ch. 10) | |
| TAS | Local Government Act 1993 (Part 9) | |
| ACT | Rates Act 2004 | Territory-level, no LGAs |
| NT | Local Government Act 2019 | |

Statutory certificate templates and citations must be state-correct. Maintained as data, not code.

### 12.3 Records management

- **State Records Act 1998 (NSW)** + equivalents in other states
- Public records cannot be transferred offshore without authorisation
- Disposal authorities (General Disposal Authorities — GDAs) prescribe retention periods
- Council-specific records management plans
- Integration: write back to council EDRMS for any document we generate

### 12.4 AI governance

- **NSW AI Assurance Framework** — applies to public sector AI use, requires risk assessment for medium+ impact systems
- **VIC Artificial Intelligence Strategy 2024**
- **ACT Generative AI Policy** + **WA AI in Government Guidance**
- **Federal Voluntary AI Safety Standard 2024** — DISR
- **Council-specific AI policies** — many councils now have policies; often default-restrictive

**Compliance posture for RatesAssist:**

- AI risk assessment per council deployment
- Human-in-the-loop for any consequential decision (no auto-reclassification, no auto-debit-charge)
- Transparency: every AI-generated artefact labelled
- Explainability: confidence scores + source citations on every anomaly + recommendation
- Override capability: officers always retain veto

### 12.5 Cyber security policies

- **ACSC Essential Eight** — target Maturity 2 within year 1
- **Information Security Manual (ISM)** — federal standard; relevant when pursuing IRAP
- **State cyber security policies:**
  - NSW Cyber Security Policy
  - VIC Information Security Policy
  - QLD Information Security Policy IS18
  - WA Government Cyber Security Policy

### 12.6 Procurement & vendor frameworks

- **Local Buy / VendorPanel** — common council procurement panels
- **DTA Digital Sourcing** — for federal alignment
- **NSW ICT and Digital Sourcing Standard**
- **Buy NSW / Buy QLD / SA Tenders / etc.** — state procurement portals
- **LGP (Local Government Procurement NSW)** + state equivalents — preferred-supplier panels
- **VendorPanel** — widespread procurement workflow tool

Strategic: pursue panel placements progressively as customer count justifies.

### 12.7 Statutory backdating (RatesRecovery-specific)

State laws limit how far back a council can recover under-charged rates. Approximate (verify per pilot):

| State | Limit | Source |
|---|---|---|
| WA | 5 years | Local Government Act 1995, s.6.81 |
| NSW | ~5 years | Limitation rules + LG Act |
| QLD | Subject to council policy | LG Regulation 2012 |
| VIC | 5 years | LG Act 1989 (transitional provisions) |

Always cite the specific provision in the evidence pack.

### 12.8 Insurance

- **Professional Indemnity** — minimum $5M cover, $10M target for $1M+ contracts
- **Cyber Liability** — minimum $5M, with breach response services
- **Public Liability** — standard $20M for any council site visits
- **Directors & Officers** — once entity has external investors or board
- **Tech E&O** — covers software-specific risks

### 12.9 Anti-discrimination + accessibility

- **Disability Discrimination Act 1992 (Cth)** — public-facing surfaces (RatesChat) must meet WCAG 2.2 AA
- **Section 27 AHRC notice** — accessibility commitment in DDA Action Plan
- **Australian Human Rights Commission Guidelines** — for AI decision systems

### 12.10 Consumer law (RatesChat)

- **Australian Consumer Law (Schedule 2 Competition and Consumer Act 2010)** — applies to any commercial dealings with citizens (e.g. payment processing for certificates)
- **ePayments Code (ASIC)** — for citizen payment flows

---

## 13. DevOps & Infrastructure

### 13.1 Environments

- **dev** — local + ephemeral preview deployments per PR
- **staging** — full multi-tenant simulation, fake council data
- **uat** — per-pilot-council UAT environment, scrubbed test data
- **prod** — production multi-tenant, AU region only

### 13.2 CI/CD

- GitHub Actions
- PR checks: typecheck, unit tests, integration tests, security scan, license check
- Auto-deploy `main` to staging
- Manual promote to prod with change ticket
- Database migrations: Drizzle Kit / Flyway; reversible required
- Feature flags: LaunchDarkly or Unleash self-hosted in AU

### 13.3 Observability

- **Metrics:** every tool call, latency p50/p95/p99, error rate, LLM cost per tenant
- **Logs:** structured JSON, shipped to AU log store, redacted of PII
- **Traces:** OpenTelemetry with W3C trace context across web → backend → MCP → external integrations
- **Dashboards:** per-tenant + global
- **Alerts:** SLO breach (chat p95 > 3s, recovery candidate gen failure > 5%)
- **Synthetic monitors:** critical-path uptime checks every 60s

### 13.4 SLAs (target offers)

| Tier | Uptime | RTO | RPO | Support |
|---|---|---|---|---|
| Standard | 99.5% | 4h | 1h | Business hours |
| Premium | 99.9% | 1h | 15min | 24/7 |
| Enterprise (large councils) | 99.95% | 30min | 5min | 24/7 + named CSM |

### 13.5 Backup & DR

- Postgres point-in-time recovery (35 days)
- S3 cross-region replication (Sydney → Melbourne when available)
- Daily logical backup exports per tenant
- Quarterly DR drill with documented runbook
- Per-tenant export-on-demand (*"give me everything"*)

### 13.6 Cost management

- Per-tenant cost attribution via tagging (LLM calls, storage, compute)
- Monthly cost report per council (transparency)
- Hard limits per tier to prevent runaway

---

## 14. Pricing & Go-to-Market

### 14.1 Pricing tiers (illustrative)

| Tier | Audience | Inclusions | Price |
|---|---|---|---|
| **Starter** | 1–5 officer council | RatesAssist core, 5 seats, standard SLA | $1,200/mo |
| **Growth** | 5–15 officer council | RatesAssist + RatesIntel, 15 seats | $3,500/mo |
| **Enterprise** | 15+ officer / metro | Everything, unlimited seats, premium SLA | $8,000–25,000/mo |
| **Recovery (add-on)** | Anomaly detection + evidence packs | 12% of recovered rates, capped 24 months | — |
| **Citizen (add-on)** | RatesChat public-facing | $25,000/yr + per-conversation usage above 50k/mo | — |

Setup / onboarding: $5–25k depending on integration depth.

### 14.2 GTM motion

#### Phase A — Mum's network (months 1–6)

- Pilot at one council (signed MoU, success-fee Recovery)
- Reference rollout to 2–4 of mum's portfolio
- Anchor customer logos for marketing

#### Phase B — LGA networks (months 6–18)

- WALGA, LGNSW, MAV, LGAQ — speaking opportunities, sponsorships
- TechOne user groups (TechOne Evolve conference, regional meetups)
- Targeted outbound to councils with mining tenement footprint

#### Phase C — Procurement panels (months 12–24)

- LGP (NSW), state equivalents
- VendorPanel listings
- Federal AusTender as relevant
- Panel placements compress 6–9 month sales cycles to 6 weeks

#### Phase D — Adjacent markets (months 18+)

- Water utilities (Gentrack, Hansen)
- Strata management (MRI Strata Master)
- Other states' mining shires
- NZ councils (78 entities, similar tech stack)

### 14.3 Sales artefacts

- 1-page pitch ([`PILOT-PITCH.md`](PILOT-PITCH.md))
- Demo environment with synthetic + (with permission) anonymised real data
- ROI calculator per council
- Reference call list (post-pilot)
- Security questionnaire pre-answers (CAIQ, SIG-Lite, council-specific templates)
- Privacy impact assessment template
- Standard MSA + DPA + statement of work templates

### 14.4 Customer success

- 30/60/90 day onboarding plan
- Dedicated CSM at Growth+ tiers
- Quarterly business reviews
- Office hours / officer training webinars
- Slack/Teams channel for active customers
- Annual user conference (year 2+)

---

## 15. Phased Roadmap

### Phase 0 — Validation (weeks 1–4)

**Goal:** Prove that the recovery thesis is real on one council's data, signed pilot in hand.

Deliverables:
- Mum-discovery completed, top 10 workflows ranked
- Pilot council selected
- Public DMIRS + Landgate data ingested for pilot LGA
- TechOne CSV export from pilot council
- Manual cross-reference shows $50–500k+ candidate recovery
- Pilot MoU signed with success-fee terms
- Mum onboarded to cap table

### Phase 1 — Recovery v1 (months 2–4)

**Goal:** Pilot council is using RatesRecovery against real data. First recovered rates land.

Deliverables:
- DMIRS + Landgate ingestion pipelines productionised
- Mining mismatch detection live
- Evidence pack generator producing council-grade artefacts
- Officer chat UI v1 (basic, not branded)
- Multi-tenant skeleton (single tenant active, expandable)
- Audit logging
- Microsoft Entra SSO
- Recovery tracker (track candidate → reclassified → collected)

### Phase 2 — Productivity v1 + portfolio rollout (months 4–8)

**Goal:** Mum's whole portfolio is on the platform. First non-mum council signed.

Deliverables:
- TechOne CiAnywhere REST integration live (read + safe writes with confirm)
- Full RatesAssist productivity tools (lookup, lifecycle, comms)
- Branded chat UI
- 3–5 councils live (mum's portfolio + 1–2 referrals)
- Nearmap integration optional add-on
- Standard onboarding playbook
- Privacy Impact Assessment template + completed PIAs for live councils
- Essential Eight Maturity 1 achieved

### Phase 3 — Reporting + scale (months 8–14)

**Goal:** 10+ councils. RatesIntel live. Cross-council benchmarking.

Deliverables:
- RatesIntel dashboards (officer, manager, executive)
- Anonymised cross-council benchmarking
- Forecasting models
- Civica Authority integration
- Two-state coverage (WA + one of NSW/QLD/VIC)
- ISO 27001 audit underway
- LGA panel placement (at least one)
- First sales hire

### Phase 4 — Citizen + breadth (months 14–24)

**Goal:** 25+ councils. RatesChat live. Multi-state coverage.

Deliverables:
- RatesChat public-facing product
- Ratepayer authentication (email + MyGovID where possible)
- WCAG 2.2 AA compliance
- ISO 27001 certified
- Essential Eight Maturity 2
- Five-state coverage
- Conference speaking circuit + thought leadership ("State of Council Rates" report)
- First product hire (engineer #2)
- First customer success hire

### Phase 5 — Adjacent markets (months 24+)

**Goal:** Beyond rates departments.

- Water authorities pilot
- Strata management pilot
- NZ council pilot
- Adjacent council departments (parking, planning, animal mgmt)
- Series A or profitable bootstrap path locked

---

## 16. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | TechOne restricts or cancels API access | Medium | High | Partner status pursuit; CSV fallback; dual-platform support (Civica) |
| R2 | Pilot council finds little recovery | Low–Medium | High | Pilot site selected for known-stale data; mum's prior knowledge de-risks; success-fee = no out-of-pocket for them |
| R3 | Privacy breach | Low | Catastrophic | Defence-in-depth, minimisation, audit, insurance, NDB process |
| R4 | Council procurement gridlock | Medium | Medium | Mum's relationships compress cycles; success-fee bypasses many thresholds; LGA panels long-term |
| R5 | LLM hallucination causes wrong reclassification advice | Medium | High | Tool-grounded only; structured outputs; deterministic scoring; mandatory officer review; audit trail |
| R6 | Anthropic pricing/availability change | Low | Medium | Abstract LLM layer; could swap models if needed (with re-validation) |
| R7 | Mum's bandwidth | Medium | High | Honest scope conversation; defined role; equity reflective; hire support staff early |
| R8 | Recovery contested by ratepayer / lost on appeal | Medium | Medium | Conservative confidence threshold; legal review of edge cases; success-fee only on collected, not flagged |
| R9 | Competitor enters | Medium (24mo) | Medium | Move fast; lock TechOne partner status; reference customers as moat; cross-council benchmarking is uncopyable without footprint |
| R10 | Data residency challenge by council | Medium | Medium | All AU hosting; Anthropic AU region usage where available; opt-in cross-border for any non-AU service |
| R11 | Liability for advised reclassification decisions | Medium | Medium | Contract: we provide candidates + evidence, council makes statutory decision; PI insurance; clear scope statements |
| R12 | Internal council politics block adoption | Medium | Medium | Multiple champions per council; pilot success drives momentum; CSM relationship building |
| R13 | Federal / state AI policy tightens | Medium | Medium | Stay ahead via assurance frameworks; offer human-in-loop everywhere; participate in policy consultation |

---

## 17. Team & Hiring Plan

### Founding team

- **Brodie** — CEO / Product. Goes deep on architecture, GTM, capital, and CTO duties for first 12 months.
- **Mum** — Co-founder / Head of Customer & Domain. Brings calibration, customer relationships, pilot site, regulatory fluency. Critical from day one.

### First 6 months (lean)

- Founders only
- Contract help: design (UI), legal (MSA + privacy), accountant (entity + R&D registration)

### Months 6–12

- **Senior Full-Stack Engineer #1** — TypeScript, AWS, integrations. Carries the build alongside Brodie.

### Months 12–18

- **Customer Success Manager #1** — onboarding + support for 5+ live councils
- **Sales / BD** — likely a council-experienced individual; LGA networks

### Months 18–24

- **Senior Engineer #2** (data / ML focus, anomaly detection sophistication)
- **Implementation Specialist** (handles council-specific config + EDRMS write-back)

### Year 3+

- Engineering team of 4–6
- CS team of 2–3
- Sales team of 2–3
- COO when the operations layer warrants it

### Hiring principles

- Hire slowly, fire never (vertical SaaS rewards consistency)
- Prefer council-domain or AU public-sector experience for non-engineering roles
- All staff AU-based (data residency posture demands it; council buyers will ask)
- Equity meaningful through Senior Engineer #1 and CSM #1

---

## 18. Open Questions

Items requiring decision or external input before they can be locked.

1. **Entity structure** — new PTY LTD vs AUREAN sub-brand. See [`ENTITY-OPTIONS.md`](ENTITY-OPTIONS.md).
2. **Brand name** — RatesAssist confirmed as working name; final brand check pending. See [`BRAND-CANDIDATES.md`](BRAND-CANDIDATES.md).
3. **Mum's compensation structure** — equity %, vesting, role definition, time commitment.
4. **Pilot council #1 selection** — pending mum's input on relationships + readiness.
5. **TechOne API access path** — partner programme application timing vs CSV-fallback start.
6. **Nearmap commercial terms** — eval window, council-pass-through pricing model.
7. **AU data residency for Anthropic** — verify availability + capability in writing before first prod traffic.
8. **Multi-tenant isolation default** — logical (cheaper) vs physical (premium-tier offer).
9. **Insurance binder** — broker selection, policy limits, premium budget.
10. **Bookkeeping / R&D** — accountant for AU R&D Tax Incentive registration and quarterly BAS.
11. **Funding shape** — bootstrap vs angel vs grant-only vs Series A path. Affects how aggressively phase 1–3 are funded.
12. **State-by-state legal counsel** — for statutory certificate templates, need a council-law specialist (likely Maddocks, Holding Redlich, or HWL Ebsworth).
13. **DPA + MSA templates** — author from scratch vs license existing govtech templates.
14. **Citizen authentication for RatesChat** — MyGovID viability, fallback options.
15. **Open-source posture** — release MCP server skeleton openly to drive adoption + recruiting? Decision in phase 2.

---

## Appendix A — Companion Documents

The full RatesAssist documentation set:

| Document | Purpose |
|---|---|
| [`README.md`](README.md) | Project entry point, quickstart |
| [`RatesAssist.md`](RatesAssist.md) | This document — master specification |
| [`SECURITY.md`](SECURITY.md) | External-facing security posture |
| [`PRIVACY.md`](PRIVACY.md) | External-facing privacy posture |
| [`PILOT-PITCH.md`](PILOT-PITCH.md) | One-page pitch for council CFO |
| [`PILOT-RUNBOOK.md`](PILOT-RUNBOOK.md) | Operational runbook for first pilot |
| [`ENTITY-OPTIONS.md`](ENTITY-OPTIONS.md) | Entity + cap table comparison |
| [`BRAND-CANDIDATES.md`](BRAND-CANDIDATES.md) | Brand name candidates + availability check |
| [`MUM-DISCOVERY.md`](MUM-DISCOVERY.md) | Discovery sheet for domain co-founder call |
| [`outreach/techone-partner.md`](outreach/techone-partner.md) | TechOne partner programme outreach draft |
| [`outreach/nearmap-eval.md`](outreach/nearmap-eval.md) | Nearmap evaluation outreach draft |

---

## Appendix B — Glossary

| Term | Meaning |
|---|---|
| **APP** | Australian Privacy Principle |
| **CiAnywhere** | TechnologyOne's cloud platform |
| **DMIRS** | WA Department of Mines, Industry Regulation and Safety |
| **EDRMS** | Electronic Document and Records Management System |
| **GeoVIEW.WA** | DMIRS public mining tenement viewer |
| **IRAP** | Information Security Registered Assessors Program (federal) |
| **k-anonymity** | Privacy property where each record is indistinguishable from at least k−1 others |
| **LGA** | Local Government Area |
| **LGP** | Local Government Procurement (NSW) |
| **MCP** | Model Context Protocol (Anthropic) |
| **MoU** | Memorandum of Understanding |
| **NDB** | Notifiable Data Breaches scheme |
| **PIA** | Privacy Impact Assessment |
| **SLIP** | Shared Land Information Platform (WA) |
| **SSO** | Single Sign-On |
| **WALGA / LGNSW / MAV / LGAQ** | State-level local government associations |

---

## Appendix C — Document Control

### Change history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-05-08 | Brodie | Foundational draft |

### Review cadence

This document is reviewed at the close of every roadmap phase. Material changes require co-founder sign-off.

### Distribution control

Confidential. Not for external distribution without written approval. External-facing summaries are maintained as separate documents (`PILOT-PITCH.md`, `SECURITY.md`, `PRIVACY.md`).

---

*RatesAssist — Vertical AI for Australian local government rates.*
*© RatesAssist (entity TBC). Confidential.*
