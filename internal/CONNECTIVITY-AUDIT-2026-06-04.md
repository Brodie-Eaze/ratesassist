# RatesAssist — Full Connectivity Audit

**Date:** 2026-06-04
**Scope:** Every wiring layer of the platform — pages ↔ nav, frontend ↔ API, API ↔ packages, chat ↔ tools, integrations ↔ fallback, build health.
**Method:** Orchestrated agent fleet — 8 parallel layer-mappers → 1 adversarial skeptic per candidate gap (each told to *refute* against ground truth, default "not a gap" if uncertain) → synthesis. 33 agents, 24 candidate gaps, **9 refuted as false positives**, 15 confirmed.

---

## Verdict: the platform IS wired and connected

- **0 P0** — no phantom API calls, no broken imports, no crashing routes.
- **0 P1** — every Sidebar link resolves; no orphan packages; no hard-fail integrations.
- **Build fully green** — `typecheck` exit 0 (8 workspaces, strict), **968/0/1 tests**, **0 dangling imports**.
- All **15 confirmed gaps are P2** — "built backend, not yet surfaced in the UI" + config-hygiene drift. **Nothing breaks.**

The earlier worry ("there must be heaps missing") resolves cleanly: nothing is *missing or broken*. Some fully-built, tested, permissioned **backends simply have no UI entry point yet** — capability ahead of surface, not absence of capability.

---

## GREEN — what is correctly wired (verified)

**Pages ↔ Nav.** All 28 App Router pages resolve. Every Sidebar link (14) + public-layout link (8) + onboarding entry points to a real route. Authenticated pages fetch via `lib/useFetch` against real `/api/*` routes; public/trust pages render via `PublicLayout`/`TrustPageShell`. `/recovery/[assessment]` builds evidence packs + downloads via `/api/evidence/[file]` (.md/.html/.pdf) — all present.

**Frontend ↔ API.** 39 route files; **every** `/api/...` path the frontend calls resolves to a real `route.ts` — **zero phantom calls**. All dynamic-segment routes wired. Middleware correctly public-prefixes only health/ready/version/auth; everything else is session-gated + re-resolves session in-handler for tenant scoping.

**API ↔ Packages.** All 7 workspace packages imported and wired — **no orphans**. `contract` is the universal base (155 sites); `recovery-engine`/`spatial`/`identity`/`audit-core` feed both apps/web and adapter-demo; `db` wired into clients/db/privacy-erasure; `adapter-demo` consumed via subpath exports. Three live buses: MCP dispatcher (runTool → runMcpTool → adapter-demo over stdio), recovery-engine direct calls, lib/clients + lib/data fixtures.

**Chat ↔ Tools.** Real end-to-end: `Chat.tsx` → `/api/chat` → `runChat` (llm.ts) → `runTool` (tools.ts) → `runMcpTool` (mcp-client.ts) → adapter-demo handlers → engines. 32 catalogued tools, all registered (handlers/index.ts is a mapped type over every ToolName — a missing handler is a *compile error*). The live Anthropic loop only ever sees the 32 contract tools — cannot call anything off-catalogue.

**Integrations ↔ Fallback.** All four external families degrade gracefully on blank keys (shipped state): LLM → deterministic mock; Mapbox/MapTiler/Nearmap → free Esri/Carto basemaps; DMIRS WFS → caller-seeded features on probe failure; ABN → honest `source:"mock"`. No hard-fail.

---

## FIXED THIS PASS (4 genuine defects / misleading config)

All verified: typecheck 0, web 447/447, packages unaffected; live-smoke where applicable. **Uncommitted** for review.

| ID | Was | Fix | Verification |
|----|-----|-----|--------------|
| **CT-1** | Mock chat branch called `fetch_dmirs_tenements` — a name absent from the contract catalogue → `runTool` returned `"Unknown tool: …"`, which the mock then narrated as *"Fetching live DMIRS tenement data"* (an error dressed as success). In the **no-API-key demo path you run locally**. | `apps/web/lib/llm.ts` — call the real catalogued tool `list_recent_grants({sinceDays:30})` + honest narration *"Recent DMIRS mining tenement grants (last 30 days)"*. | **Live-proven**: `POST /api/chat {"message":"dmirs"}` now returns real `toolCalls:[{name:"list_recent_grants",…}]`, no "Unknown tool", no phantom name. |
| **INT-1** | `MOCK_LLM` documented + set to `auto` but **read by zero code** — an inert knob. The real gate was `ANTHROPIC_API_KEY` only. | `apps/web/lib/llm.ts` `isLive()` now honors `MOCK_LLM` (`mock`/`on`/`1` force the deterministic mock even with a key; `auto`/unset = key-based). `.env.example` comment corrected. | Typecheck 0; smoke still shows `modelUsed.reason:"no_key"` (auto path intact). |
| **INT-2** | `LANDGATE_SLIP_WMS` documented + set but **never read** — cadastre WMS URL hardcoded. | `apps/web/lib/basemaps.ts` now reads `NEXT_PUBLIC_LANDGATE_SLIP_WMS` (correct prefix — registry is client-consumed, matching the 3 sibling map keys) with the prior URL as zero-regression default. Env templates renamed. | Typecheck 0; `/map` + `/aerial` serve 200. |
| **INT-3** | `DMIRS_WFS_BASE` template drift (root `.env.example` pre-filled, `apps/web` blank) — cosmetic. | Root `.env.example` harmonized to blank + comment (code supplies `FALLBACK_DMIRS_WFS_BASE`). | Docs only; no runtime change. |

**Files touched:** `apps/web/lib/llm.ts`, `apps/web/lib/basemaps.ts`, `.env.example` (tracked) + `apps/web/.env.local` (gitignored, local override rename).

**Pre-existing nuance noted (not fixed — not a wiring defect):** the mock chat matcher (llm.ts:433) catches the substring `"tenement"`, so "fetch tenements"/"tenements in X" route to the *recovery-audit* branch before reaching the DMIRS branch (559). That's a deterministic demo-routing heuristic, out of scope for CT-1; flag if you want the demo phrasings disambiguated.

---

## DECISION LIST — 11 "built backend, no UI yet" (your call)

These are **not bugs.** Each is a real, tested, permissioned capability with no UI entry point. I did **not** auto-build them: several are net-new UI surfaces, two touch PII/RBAC, and a few are genuine product calls (what belongs in the pilot). Ranked by value. Say the word and I'll build the top ones with full care (tests + verify).

### High value
1. **DEAD-04 — surface the real audit log.** The page titled **"Activity & Audit Log"** (`activity/page.tsx`) fetches the *static* `/api/activity`, **not** the real hash-chained `/api/audit/log`. Your tamper-evident audit chain — a core trust differentiator — is currently invisible in the UI. **Recommend:** wire `/activity` to `/api/audit/log` (supervisor-gated, since it requires `read.audit_log`), or rename the page to just "Activity" to stop implying it shows the chain. *Medium.*
2. **DEAD-01/02/03 — expose the remaining council importers.** Three fully-built ingestion routes (`import-landgate-title-data`, `import-rate-schedule`, `import-wc-eligibility`) exist, but the onboarding wizard only POSTs the generic `/import`. **Recommend:** generalize the wizard's import step to select among import types. One task. *Medium.*
3. **DEAD-11 — lag-window recovery queue.** `/api/recovery/lag-window` surfaces DMIRS-ahead-of-Landgate lag candidates (a genuinely useful queue) but no panel calls it. **Recommend:** add a panel on `/recovery`. *Small.*

### Medium / optional (product calls)
4. **DEAD-08 — notify clerk.** `/api/notify` is built + correctly cross-tenant-guarded but unused. Wire a "Notify clerk" action on the recovery view, or delete the route + `lib/notifier.ts` facade if notifications aren't in the pilot. *Small.*
5. **DEAD-07 — CSV export (PII-bearing).** `/api/exports/csv` (ratepayer addresses + arrears) is built + tenant-scoped but has no button. **Privacy decision:** surface behind a role/flag when you decide export ships — I won't auto-expose a PII export. *Medium.*

### Low / hygiene
6. **DEAD-06 — privacy erasure console.** `/api/privacy/erasure` is privileged + tested; the data-subject path (the public `mailto:`) is intentional. Keep as ops/admin-only (document) pre-pilot, or build a DPO console later. *Low.*
7. **DEAD-09 — owner detail route.** `/api/owners/[ownerId]` is redundant (owner data already reaches the UI via `/api/data` + the `get_owner` chat tool). Either build an owner-detail page or delete the route + its tests/OpenAPI entry. *Small.*
8. **PKG-02 — adapter-demo barrel.** `src/index.ts` is unreachable via the package specifier and fully redundant (everything's on subpaths). Delete it, or add a `./index` export. *Trivial.*
9. **PKG-01 — spatial Landgate-restricted stub.** `createLandgateClient`/etc. throw "live transport not implemented" — a deliberate future placeholder, zero consumers. Mark `@internal` (keep) or delete until the roadmap reaches live Landgate-restricted access. *Small.*

---

## How to re-run this audit

The orchestration script is saved and re-runnable:
`~/.claude/projects/-Users-Brodie-FA-OS-/.../workflows/scripts/ratesassist-wiring-audit-wf_76506f9f-922.js`

Re-run after any large change to confirm wiring stays green.
