# RatesAssist — SLO / SLI Definitions

| | |
|---|---|
| **Document** | Service-level objectives + indicators for revenue-critical paths |
| **Audience** | Founder (on-call), council ICT auditors |
| **Status** | Pre-pilot. Active. |
| **Owner** | Brodie · `engineering@ratesassist.com.au` |
| **Version** | 1.0 |
| **Last reviewed** | 2026-05-29 |
| **Review cycle** | Quarterly, and on any change to the SLA or the request-path instrumentation |

---

## 0. How this relates to the SLA

[`SLA.md`](../SLA.md) is the **external contract** with a council: the numbers
RatesAssist commits to, the definition of "down", exclusions, and service
credits. This document is the **internal engineering spec** that operationalises
the SLA — the precise SLIs we measure, the SLO targets we hold ourselves to
(equal to or **tighter than** the SLA so we never breach the contract by
hitting our own threshold first), and the error-budget policy that governs
how we respond.

**Reconciliation (no contradiction with the SLA):**

- The SLA's headline commitment is **chat availability** (pilot **99.0%**,
  production **99.5%**) and chat latency (pilot p95 < 8s / p99 < 20s;
  production p95 < 4s / p99 < 10s). This document keeps those exact numbers as
  the customer-facing SLO and adds **internal** SLOs for the supporting paths
  (`/api/properties`, the audit verify path, `/api/health`, `/api/ready`) that
  the SLA does not enumerate but which gate the chat experience.
- The SLA's **"down" definition** (unreachable / 5xx / no tool-grounded
  response within p99, sustained > 5 minutes, observed from an AU synthetic
  monitor) is the basis for the availability SLI below.
- The SLA's **exclusions** (Anthropic outage > 30s, DMIRS/Landgate/SLIP/ABR
  upstream, Vercel/AWS regional, Cloudflare, council-side network, force
  majeure, scheduled maintenance, beta features) apply identically here:
  error-budget burn from an excluded cause does **not** count against the
  SLO. Where an SLI can attribute the failure to a dependency we tag it
  (`error_type=upstream`) so excluded burn is filtered out.

The SLA stays the source of truth for the **promised** numbers. If the two
ever diverge, the SLA wins externally and this doc is corrected.

---

## 1. Scope — revenue-critical paths

| Path | Why revenue-critical | Tier |
|---|---|---|
| `POST /api/chat` | The product. A rates officer's primary surface; the SLA's headline metric. | **Tier 1** (SLA-bound) |
| `GET /api/properties` | The grounding data behind every answer and the property workspace. Chat is useless if properties don't load. | **Tier 1** |
| `GET /api/audit/verify-chain` | The compliance integrity proof. A council buys RatesAssist partly *because* the audit trail is tamper-evident; if verification is unavailable or reports a genuine break, trust is the product that's lost. | **Tier 1 (integrity)** |
| `GET /api/health` | Liveness. Load balancer / orchestrator routing decisions depend on it. | **Tier 2** (infra) |
| `GET /api/ready` | Readiness (MCP up, tools catalogued, Anthropic key present). Gates whether the instance receives traffic. | **Tier 2** (infra) |

---

## 2. SLO targets (30-day rolling window)

Availability SLI = `good requests / valid requests`, where a request is
**good** if it returns a non-5xx status (and, for chat, a tool-grounded
response) within the latency objective, and **valid** excludes the SLA §5
exclusions (upstream-attributed failures, scheduled maintenance, beta).

| Path | Availability SLO | Latency SLO (p99) | Notes |
|---|---|---|---|
| `POST /api/chat` | **99.0%** pilot · **99.5%** production | **< 20s** pilot · **< 10s** production | Matches SLA §2/§3 exactly. p95 tracked too (< 8s pilot / < 4s prod) but p99 is the SLO gate. |
| `GET /api/properties` | **99.5%** (internal) | **< 1.5s** | Tighter than chat — it is a DB read, not an LLM call. A properties outage is a chat outage. |
| `GET /api/audit/verify-chain` | **99.5%** availability of the *endpoint*; **100%** integrity (zero genuine `brokenAt` tolerated) | **< 5s** for ≤ 1,000 rows | Availability = the endpoint answers. Integrity is a separate, hard SLI: any genuine chain break is a SEV1 regardless of budget (see §4). |
| `GET /api/health` | **99.95%** | **< 250ms** | No external deps; effectively process-up. |
| `GET /api/ready` | **99.9%** | **< 2.5s** | Bounded by the 2s MCP-connect budget in the handler. |

Rationale for the 99.5% internal default: standard SaaS floor. The integrity
SLI for the audit chain is held to **100%** because a tamper-evident store
that tolerates "a little" tampering is not tamper-evident — there is no error
budget for genuine chain breaks.

---

## 3. SLIs — exact measurement source

All SLIs are derived **today** from the structured pino logs (see
[`OBSERVABILITY.md`](OBSERVABILITY.md)); first-class metrics land in Phase 6.
The log fields below are what each SLI computes over.

| SLI | Source signal (field / log line) | Where emitted |
|---|---|---|
| Chat availability | `scope:"api/chat"` lines: `msg:"chat.request.ok"` (good) vs `msg:"chat.request.threw"` (5xx) and the 4xx warn lines (`chat.rate_limited`, `chat.body_too_large`, `chat.invalid_json`, `chat.invalid_input`, `chat.no_session`). | `apps/web/app/api/chat/route.ts` |
| Chat latency p50/p95/p99 | `durationMs` on `chat.request.ok` / `chat.request.threw`. | `apps/web/app/api/chat/route.ts` |
| Properties availability/latency | Request-completion lines for `scope:"api/properties"` + the middleware `request.start` (denominator); status from the response envelope. | `apps/web/app/api/properties/route.ts`, `apps/web/middleware.ts` |
| Verify-chain availability | `scope:"api/audit/verify-chain"` lines: `audit.verify.ok` / `audit.verify.eviction_truncated` (good) vs `audit.verify.read_failed` / `audit.verify.db_not_wired` (5xx) vs `audit.verify.rate_limited` (429). | `apps/web/app/api/audit/verify-chain/route.ts` |
| **Chain integrity** | `msg:"audit.chain_break"` at `level:error` (+ Sentry `audit.chain_break`). Any occurrence = integrity SLI breach. | same route + Sentry capture |
| Health / ready availability | HTTP status on `scope:"api/ready"` (`ready.mcp.failed` etc. for degradation); health is fixed-200 unless the process is down (caught by the external probe). | `apps/web/app/api/ready/route.ts`, `apps/web/app/api/health/route.ts` |

The synthetic-monitor probe (UptimeRobot on `/api/health`, per
[`PRODUCTION-CHECKLIST.md`](PRODUCTION-CHECKLIST.md) §2) is the **external**
availability witness the SLA's "down" definition refers to; the log-derived
SLIs above are the internal, per-route decomposition.

---

## 4. Error-budget policy

Error budget = `(1 − SLO) × valid requests` over the rolling 30-day window.
At 99.5% that is **0.5%** of requests; at 99.0% (pilot chat) it is **1.0%**.

Burn-rate alerts (symptom-based; align with the alert table in
[`OBSERVABILITY.md`](OBSERVABILITY.md) §Alerting):

| Burn rate | Window | Action | Severity |
|---|---|---|---|
| **Fast** (≈14× — budget gone in ~2 days) | 1 hour sustained | **Page** on-call. | P1 |
| **Slow** (≈6× — budget gone in ~5 days) | 6 hours sustained | **Page** on-call. | P1/P2 |
| **Moderate** (≈3×) | 24 hours sustained | **Notify** (next-business-day triage). | P2/P3 |

Policy when budget is consumed:

1. **Budget exhausted (Tier 1 path):** freeze non-essential deploys to that
   path; the next change must be reliability work (root-cause + fix) or a
   rollback. Resume feature work only once burn is back under 1×.
2. **Excluded-cause burn** (Anthropic/upstream/maintenance/beta per SLA §5):
   does **not** consume budget. The on-call confirms attribution
   (`error_type=upstream` tags, vendor status page) and annotates the
   incident; the SLA's monthly service review still reports it.
3. **Integrity SLI (audit chain) has no budget.** A single genuine
   `audit.chain_break` (not an eviction-truncated window) is a **SEV1**: stop
   writes, snapshot, escalate per
   [`INCIDENT-RESPONSE-RUNBOOK.md`](../INCIDENT-RESPONSE-RUNBOOK.md), and run
   the DR restore/verify path
   ([`DR-RESTORE-DRILL-2026-05-29.md`](DR-RESTORE-DRILL-2026-05-29.md)).
4. Every P1/P2 gets a blameless post-incident review (runbook §7) with action
   items tracked in [`SECURITY-FOLLOWUPS.md`](SECURITY-FOLLOWUPS.md).

Every alert listed here maps to a runbook section — no page without a runbook,
consistent with the alert table in `OBSERVABILITY.md`.

---

## 5. The four golden signals — signal-source mapping

Required confirmation: the four golden signals are actually emitted in the
structured (pino) logs today. RatesAssist emits structured JSON logs + Sentry;
metrics are derived at the log destination until Phase 6 (`OBSERVABILITY.md`
§Metrics roadmap). Mapping:

| Golden signal | Emitted? | Source field(s) | Where | Gap / note |
|---|---|---|---|---|
| **Latency** | **Yes** | `durationMs` on completion lines: `chat.request.ok`/`.threw`, MCP `tool.call`, `db.bootstrap`. | `app/api/chat/route.ts`, `lib/mcp-client.ts`, `lib/db.ts` | p50/p95/p99 are computed at the log destination (CloudWatch/Sumo/Datadog) — see the "Slow tool calls (p95)" query in `OBSERVABILITY.md`. Per-route `durationMs` on read routes (e.g. `/api/properties`) is partial; **gap G1** below. |
| **Traffic** | **Yes** | `msg:"request.start"` (one JSON line per ingress: `method`, `path`, `correlationId`, `userId`, `tenantId`). | `apps/web/middleware.ts` | Every request gets a `request.start`. Requests/sec by route = `count() by path, bin(1m)`. This is the canonical traffic denominator for the SLIs in §3. |
| **Errors** | **Yes** | `level:"error"`/`"fatal"` lines with structured `error` payload (`type`, `message`, `stack`, `code`); per-route warn/error msgs (`chat.request.threw`, `audit.chain_break`, `audit.verify.read_failed`, `auth.unauthorized`). | route handlers + `lib/logger.ts` serializers | Error rate by route+status+type is queryable today (`OBSERVABILITY.md` §Recommended queries). The logger's `error` serializer indexes `error.type` as a first-class column. |
| **Saturation** | **Partial** | MCP path: `tool.call` `durationMs` + `code:"timeout"` (worker-pool/queue pressure proxy). Readiness: `ready.mcp.failed` (MCP child saturation). DB pool sizing is configured (`packages/db/src/client.ts`: max 20 prod / 5 dev, `statement_timeout=15s`, `idle_in_transaction_session_timeout=10s`) but pool utilisation is **not yet emitted**. | `lib/mcp-client.ts`, `app/api/ready/route.ts`, `packages/db/src/client.ts` | **Gap G2** below — no direct gauge for DB pool in-use / queue depth / CPU/mem. These come from the Postgres provider's metrics + the Vercel/AWS platform today; first-class emission is Phase 6. |

### Identified gaps (tracked for Phase 6)

- **G1 — per-route completion line on read routes.** `/api/chat` emits
  `chat.request.ok` with `durationMs`; read routes lean on the middleware
  `request.start` plus response status. A uniform `request.complete`
  (status + durationMs) line across all routes would make latency/error SLIs
  symmetric without per-handler bespoke logging. *Workaround today:* the SLI
  for `/api/properties` is computed from `request.start` (denominator) + the
  edge/platform access log status (numerator).
- **G2 — saturation gauges.** DB connection-pool utilisation, BullMQ-style
  queue depth (N/A today — no queue), and CPU/memory are read from the
  Postgres provider + Vercel/AWS platform dashboards, not emitted by the app.
  Phase 6 Prometheus exposition on `/api/metrics` (already on the
  `OBSERVABILITY.md` roadmap) closes this with explicit gauges.

Neither gap blocks the SLOs in §2: latency, traffic, errors, and the
integrity SLI are all measurable from today's signals. Saturation is
observable via platform metrics in the interim.

---

## 6. Review

- Re-validate the §3 source fields whenever a route's logging changes.
- Re-validate the §0 reconciliation whenever [`SLA.md`](../SLA.md) changes —
  the SLA numbers in §2 must continue to match exactly.
- Tighten the internal SLO targets when the production architecture
  (multi-replica, real Postgres, Phase 6 metrics) lands, in lock-step with the
  SLA's production-tier targets.

---

*Last reviewed: 2026-05-29 · Owner: Brodie. Reconciled with `SLA.md` v1.0.
Golden-signal mapping verified against the request path on 2026-05-29.*
