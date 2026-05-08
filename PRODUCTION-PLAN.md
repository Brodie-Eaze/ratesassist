# RatesAssist — Production Build Plan

| | |
|---|---|
| **Document** | Production build plan — full-system delivery |
| **Status** | Active — replaces all prior "prototype" / "MVP" framing |
| **Owner** | Brodie |
| **Last updated** | 2026-05-08 |
| **Confidentiality** | Confidential |

---

## Strategic reset

The product is no longer a prototype. From this point forward every change is built to be deployed to a real council and operated under audit. No demos, no MVPs, no shortcuts that "we'll fix in v2".

The architecture is the one originally described: **a multi-tenant SaaS web application that integrates with each council's platform (TechOne, Civica, Open Office, etc.) through Model Context Protocol adapters, with a multi-signal detection engine, real spatial integrations, real auth, real audit, and real per-tenant isolation.**

The MCP layer is the integration backbone, not a side experiment. Each council platform = one MCP server adapter. The web app is the canonical MCP client.

This document supersedes all prior "what's next" framing. Where it conflicts with `RatesAssist.md` or `OVERNIGHT-REPORT.md`, this document wins.

---

## Architectural target

```
                    ┌────────────────────────────────────────┐
                    │   apps/web — RatesAssist UI            │
                    │   (officer chat, dashboards, evidence  │
                    │    pack viewer, citizen self-service)  │
                    └─────────────────┬──────────────────────┘
                                      │
                                      │  Anthropic Claude API
                                      │  + MCP client
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
      ┌───────────────┐       ┌──────────────┐         ┌──────────────┐
      │  packages/    │       │  packages/   │         │  packages/   │
      │  recovery-    │       │  spatial     │         │  identity    │
      │  engine       │       │  (DMIRS,     │         │  (ABN, ASIC) │
      │  (signals,    │       │   Landgate,  │         │              │
      │   scoring,    │       │   Nearmap)   │         │              │
      │   evidence)   │       │              │         │              │
      └───────────────┘       └──────────────┘         └──────────────┘

                                      │
                              ┌───────┴────────┐
                              │  MCP transport │
                              │  (per-tenant)  │
                              └───────┬────────┘
                                      │
                ┌─────────────────────┼─────────────────────┐
                │                     │                     │
                ▼                     ▼                     ▼
      ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
      │ packages/        │  │ packages/        │  │ packages/        │
      │ adapter-techone  │  │ adapter-civica   │  │ adapter-demo     │
      │                  │  │                  │  │ (synthetic data) │
      │ TechOne          │  │ Civica Authority │  │                  │
      │ CiAnywhere       │  │ REST API         │  │                  │
      └────────┬─────────┘  └────────┬─────────┘  └──────────────────┘
               │                     │
               │  per-council         │
               │  credentials         │
               ▼                     ▼
       Council A TechOne     Council B Civica
       instance              instance
```

Every adapter implements the same `RatesAdapter` contract (defined in `packages/contract`). Adding a new platform = writing a new adapter that satisfies the contract. The web app, the recovery engine, the entire UI — none of that changes when you add a new platform.

---

## Phases

Each phase has a hard acceptance test. Phase N+1 does not start until phase N's acceptance test passes.

### Phase 1 — Foundation rebuild ✅ in progress

**Goal:** Replace the prototype's flat structure with a production monorepo. Define the canonical MCP contract. Demo adapter migrated and verified.

**Sub-phases:**

#### 1A — Restructure + contract (this session)

- Restructure repository as `apps/` + `packages/` monorepo using npm workspaces
- Define `packages/contract` with `RatesAdapter` interface, Zod schemas for every tool, exhaustive TS types
- Migrate `src/` → `packages/adapter-demo` implementing the contract
- Move `web/lib/recovery.ts` → `packages/recovery-engine`
- Move `web/lib/spatial.ts` + `web/lib/dmirs.ts` → `packages/spatial`
- Move `web/lib/abn.ts` → `packages/identity`
- Wire `apps/web` to consume types from `packages/contract`
- Everything still runs end-to-end after restructure

**Acceptance test 1A:**
- `npm run typecheck` passes across the monorepo
- `npm run dev` from `apps/web` serves all 14 routes at HTTP 200
- `npm run build` from `packages/adapter-demo` produces a runnable MCP server
- The web app's `find_mining_mismatches` returns identical output to before the restructure

#### 1B — Web app as real MCP client (next session)

- Add `@modelcontextprotocol/sdk` client to `apps/web`
- Per-tenant adapter resolution: web app spawns/connects to the correct adapter for the user's tenant
- `apps/web/lib/tools.ts` becomes a thin dispatcher over the MCP client; no business logic
- Tool call audit log per request
- Adapter health check + reconnection
- Works against `packages/adapter-demo` for all current councils

**Acceptance test 1B:**
- Every tool call in the web app routes through MCP, no direct in-process function calls remain in `apps/web/lib/tools.ts`
- Killing the demo adapter process surfaces a clear error in the chat UI within 5 seconds
- Restarting the adapter is automatic; web app reconnects without page reload
- All existing functionality preserved

### Phase 2 — Production data + persistence

**Goal:** Replace in-memory data with real Postgres + Drizzle. Per-tenant row-level security.

- `packages/db` — Drizzle schema for every entity in `RatesAssist.md §9`
- Migrations via Drizzle Kit
- Per-tenant RLS policies
- Repository pattern (`packages/db` exports interfaces; the demo adapter and real adapters use them)
- Postgres on AWS Sydney (production) + local Postgres for dev
- Backup + point-in-time recovery configured
- Audit log table: append-only, partitioned per tenant, Merkle-tree anchored

**Acceptance test 2:**
- Cold-start the system; data is read from Postgres
- Per-tenant queries are RLS-enforced (verified by integration test)
- Audit log records every read and write with user/tenant/timestamp/result-hash
- Disaster recovery: restore from a 24h-old backup, no data loss for any committed transaction

### Phase 3 — Authentication + authorisation

**Goal:** Real council-grade auth. No more demo user.

- Microsoft Entra SSO via WorkOS for officer authentication
- Just-in-time provisioning + automatic deprovisioning
- Role-based access control (`viewer`, `officer`, `senior_officer`, `coordinator`, `manager`, `admin`)
- Step-up authentication for high-risk operations (batch communications, owner edits, certificate generation)
- Session management with short-lived JWT + rolling refresh
- MFA enforced; FIDO2 where available
- Citizen authentication (RatesChat) via email magic link or MyGovID

**Acceptance test 3:**
- Unauthenticated requests to any non-public endpoint return 401
- Step-up auth challenge fires on the high-risk operations
- Removing a user from the council's IdP deprovisions them within 1 hour
- All auth events flow into the audit log

### Phase 4 — TechOne adapter (production)

**Goal:** First real platform integration. Adapter runs in production against a real TechOne CiAnywhere instance (sandbox first, then real council).

- `packages/adapter-techone` — full implementation against CiAnywhere REST
- OAuth 2.0 client credentials flow with token refresh
- Per-tenant credential vaulting via AWS Secrets Manager
- Rate limit handling + back-off
- All `RatesAdapter` tools mapped to TechOne endpoints
- Read-first; writes gated behind explicit per-tool capability grants
- Adapter packaged for deployment (Docker container)

**Acceptance test 4:**
- Adapter passes the `RatesAdapter` contract test suite
- A council's TechOne sandbox returns real data through the adapter into the web app
- Token expiry triggers refresh transparently
- Read operations are idempotent; write operations follow preview-then-confirm pattern
- All tool calls audit-logged with TechOne request/response correlation

### Phase 5 — Civica adapter (production)

**Goal:** Second platform integration. Same contract, different adapter.

- `packages/adapter-civica` — full implementation against Civica Authority REST
- API key auth with rotation
- Same `RatesAdapter` contract — verified by sharing the same test suite
- File-based fallback (CSV / SFTP) for legacy councils

**Acceptance test 5:**
- Same web-app code paths work against Civica without modification
- Adapter passes the same contract test suite Phase 4 used
- One council on TechOne, one on Civica, one on demo — all coexist in production

### Phase 6 — Production hardening

**Goal:** Real security posture. Real observability. Real compliance evidence.

- Replace regex markdown renderer in evidence pack with `marked` + `DOMPurify` + CSP
- Upgrade Next.js to non-vulnerable line (16.x or whatever current LTS allows)
- Real test suite: vitest unit + Playwright e2e — coverage gates in CI
- Per-IP and per-tenant rate limiting on every API route
- CSRF protection on every state-changing endpoint
- CORS strictly scoped (no wildcards)
- Security headers: CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy
- Structured logging (pino) with PII redaction
- Datadog metrics + Sentry error tracking (AU region)
- Distributed tracing with OpenTelemetry
- Per-tenant cost attribution via tagging
- Quarterly penetration testing + annual third-party audit (engaged)

**Acceptance test 6:**
- `npm audit` clean (high+ severity)
- Test coverage ≥ 80% on `packages/recovery-engine`, `packages/contract`, all adapter contracts
- Penetration test report received with no critical findings
- Synthetic uptime monitor passes 99.5% over a 30-day window

### Phase 7 — Real spatial + Nearmap

**Goal:** Replace seeded spatial data with real DMIRS feature parsing. Wire Nearmap AI change feed.

- `packages/spatial` — full WFS GetFeature parsing for every state mining register (WA DMIRS, NSW MinView, QLD GS, VIC GeoVic)
- Real PostGIS spatial intersection: parcel × tenement, parcel × Nearmap change polygon, parcel × zoning
- Nearmap AI change feed ingestion + scoring
- Daily refresh schedule via worker queue
- Spatial signals fire on real-world events

**Acceptance test 7:**
- A real council's parcels are intersected with real DMIRS tenements; results match council manual audit on a sample of 50
- Nearmap change events for a known parcel produce the corresponding signal hit within 24 hours of the change occurring

### Phase 8 — ML calibration head

**Goal:** Replace the rule-based composite scoring weights with a learned probability calibration trained on accumulated officer/council outcomes.

- Outcome capture UI: officer marks each candidate as approve/reject/pending; council reports reclassification + collection
- Feature store: per-candidate signal vectors + outcome labels
- Training pipeline: gradient-boosted classifier (LightGBM or similar)
- Quarterly retraining harness with shadow deployment
- Composite score = rule-based bands (kept for transparency) + ML-calibrated probability (added as a separate field)
- A/B test framework for scoring changes

**Acceptance test 8:**
- ≥ 200 verdict-labelled candidates in the training set
- AUC ≥ 0.85 on a held-out test set
- ML probability is shown alongside (not in place of) the transparent rule-based composite
- Audit trail captures both scores and the model version that produced them

### Phase 9 — Public-sector compliance

**Goal:** Pass the procurement bar at any AU council.

- ISO 27001 audit underway
- SOC 2 Type II scoping
- IRAP PROTECTED gap assessment
- Essential Eight Maturity 2 evidence
- NSW AI Assurance Framework risk assessment per tenant
- Privacy Impact Assessment template + completed PIAs for every live tenant
- DPA + MSA + SOW templates
- Cyber liability insurance + PI insurance bound

**Acceptance test 9:**
- ISO 27001 certified
- A council procurement officer can pass their internal vendor risk assessment from documents alone

### Phase 10 — RatesIntel + RatesChat productionised

**Goal:** The other three product lines (RatesIntel reporting, RatesChat citizen-facing, RatesRecovery — already core) reach production parity.

- Cross-council benchmarking with verified k-anonymity
- Forecasting model (cash collection 30/60/90)
- Citizen self-service public surface with WCAG 2.2 AA compliance, MyGovID auth, public-facing CSP
- Per-council branding system

**Acceptance test 10:**
- A council CFO uses RatesIntel for board reporting without engineering involvement
- A ratepayer uses RatesChat without ever reaching a human officer for the top 5 enquiry types

---

## Rough timelines (founder time, no team yet)

| Phase | Wall-clock estimate | Dependency |
|---|---|---|
| 1A — Restructure + contract | This session | — |
| 1B — Web app as MCP client | 1 week | 1A |
| 2 — Postgres + persistence | 2 weeks | 1B |
| 3 — Authentication | 1–2 weeks | 2 |
| 4 — TechOne adapter | 3–4 weeks | 1B + TechOne API access |
| 5 — Civica adapter | 2–3 weeks | 4 (shares the contract test suite) |
| 6 — Production hardening | 3–4 weeks (parallelisable) | parallel with 4–5 |
| 7 — Real spatial + Nearmap | 3 weeks | 6 + Nearmap account |
| 8 — ML calibration | 4 weeks | ≥ 6 months operational data |
| 9 — Compliance certification | 6–9 months calendar (audit cycles) | parallel with 6–7 |
| 10 — Other products | 4 weeks each | 6 |

**Headline:** 5–6 months of focused engineering to reach a deployable, council-ready Phase 1–7 system. Compliance (Phase 9) extends the timeline calendar-wise but is parallelisable with engineering.

A real engineering team (one senior engineer + me) compresses the engineering arc to 3–4 months.

These timelines are honest. They assume:
- No catastrophic vendor blockers (TechOne grants partner access in reasonable time)
- Mum's first pilot council co-operates as planned
- Nothing changes architecturally mid-phase
- I work the engineering full-time across this period

---

## Non-engineering blockers (must resolve in parallel)

| Item | Owner | Phase blocked | Status |
|---|---|---|---|
| TechOne ISV partner status + sandbox API access | Brodie + TechOne | 4 | Outreach drafted (`outreach/techone-partner.md`); not sent |
| Nearmap commercial agreement (or eval) | Brodie + Nearmap | 7 | Outreach drafted; not sent |
| Pilot council #1 named + MoU drafted | Brodie + Mum | 4 (real data) | Awaiting mum-discovery call |
| AWS account + AU region setup | Brodie | 2 (production hosting) | Not started |
| WorkOS account (for SSO infrastructure) | Brodie | 3 | Not started |
| Anthropic API key + AU region confirmation | Brodie | All phases (live LLM) | Not configured |
| AU PTY LTD entity registered | Brodie | 4 (commercial deployment) | Decision pending (`ENTITY-OPTIONS.md`) |
| Insurance (PI + Cyber) bound | Brodie + broker | 4 (commercial deployment) | Not started |
| Legal counsel (council-law specialist) engaged | Brodie | 4 (statutory templates) | Not started |
| Mum's role + equity locked | Brodie | All phases (her contribution is irreplaceable) | Discovery sheet drafted, conversation pending |

I cannot unblock any of these from the engineering side. They are listed here so they don't slip while I'm heads-down on the build.

---

## What changes from this point forward

**No more:**
- "for the demo" code paths
- "MVP" / "overnight" / "for now" framing in code or comments
- Mock data sneaking into production paths
- Empty `.catch()` blocks
- Unauthenticated endpoints
- Magic numbers
- Test-skipping

**Always:**
- Real type safety at every boundary
- Real error handling with explicit user-visible failure modes
- Real audit logging on every read and write
- Real test coverage as new code lands (no retrofitting)
- Every architectural decision traceable to a written rationale
- Every pull request reviewed (when team grows; until then, every commit gets a clean local build)

---

## Phase 1A scope (this session — what I'm executing now)

1. Convert `/Users/Brodie/RatesAssist/` to an npm-workspaces monorepo
2. Define `packages/contract`:
   - `RatesAdapter` interface
   - Zod schemas for every tool's input + output
   - Exhaustive TypeScript types
   - JSDoc on every public symbol
3. Migrate `src/` → `packages/adapter-demo/` implementing the contract via the official MCP server SDK
4. Move detection engine: `web/lib/recovery.ts` → `packages/recovery-engine/`
5. Move spatial: `web/lib/spatial.ts`, `web/lib/dmirs.ts` → `packages/spatial/`
6. Move identity: `web/lib/abn.ts` → `packages/identity/`
7. Update `apps/web/` (was `web/`) to consume contract types from `packages/contract`
8. Verify acceptance test 1A passes
9. Commit with a tagged release point so we can roll back if needed

Phase 1B (web app as real MCP client) is **next session**. It requires careful design of the per-tenant adapter resolution and connection pooling — not work I'm willing to rush into the same session as the restructure.

---

## How this document is used

- This file is the canonical truth for what's being built and in what order.
- When a new conversation starts, read this first.
- When something feels like a shortcut, check this document — if the shortcut isn't sanctioned here, don't take it.
- When the plan changes, update this file in the same commit as the work.
- This file supersedes prior framing in `RatesAssist.md` Section 15 (Phased Roadmap) — that section was written before the strategic reset.

---

*Production build. Not a demo.*
