# RatesAssist — Observability

| | |
|---|---|
| **Document** | Observability posture |
| **Audience** | Engineering, on-call, council ICT auditors |
| **Status** | Pre-pilot. Active. |
| **Owner** | Brodie · `engineering@ratesassist.com.au` |
| **Version** | 0.1 |
| **Last reviewed** | 2026-05-15 |
| **Review cycle** | On material change to logging or alerting; otherwise quarterly |

---

## Summary

Every request and every tool call in RatesAssist emits a structured JSON
log line. Logs are the primary observability signal today — Prometheus /
Datadog metrics are tracked for Phase 6 (see *Roadmap* below). We assume
an Auditor-General can ask "what happened to assessment X on date Y" and
we can answer from the logs in under five minutes, with seven years of
retention for audit events.

This document is the engineering-side companion to [`SECURITY.md`](../SECURITY.md)
(redaction policy, threat model) and the [`INCIDENT-RESPONSE-RUNBOOK.md`](../INCIDENT-RESPONSE-RUNBOOK.md)
(what on-call does when an alert fires).

---

## What we log

The logger (`apps/web/lib/logger.ts`) emits one JSON object per line with
these conventional fields:

- `time` — ISO timestamp (machine-readable).
- `auTime` — same instant rendered in `Australia/Sydney` for humans.
- `level` — `trace` | `debug` | `info` | `warn` | `error` | `fatal`.
- `service` — `ratesassist-web` or `ratesassist-adapter-demo`.
- `env` — `development` | `test` | `production`.
- `scope` — route path or MCP tool id (`/api/tools/find_property`, etc.).
- `msg` — short human-readable summary.
- `error` — structured error payload on `warn` and above (`type`,
  `message`, `stack`, `code`, `cause`).
- `correlationId` — propagated via `AsyncLocalStorage` (see
  `apps/web/lib/correlation.ts`).

Each tool call and each mutating route emits an additional **audit row**
through the tamper-evident chain (see `RatesAssist.md` §11 and
`packages/db`). Audit rows are written to durable storage and are not
purged by the log retention policy.

## What we do NOT log

Redaction is enforced at the pino boundary (`apps/web/lib/logger.ts`).
The following keys are replaced with `[REDACTED]` before the log line is
emitted:

- `password`, `token`, `apiKey` (anywhere in the payload).
- `email`, `phone`, `abn` (PII keys at the top level or one level deep).
- `headers.authorization`, `headers.cookie` (and request/req variants).

Property addresses and assessment numbers are NOT PII under APP 6 in the
ordinary case (they identify the property, not a natural person). They
are logged. The redaction rules above are deliberately conservative —
see [`PRIVACY.md`](../PRIVACY.md) and [`DATA-CLASSIFICATION-MATRIX.md`](../DATA-CLASSIFICATION-MATRIX.md)
for the full classification.

---

## Log destinations

Logs are emitted as JSON to stdout. A sidecar log-shipping agent tails
stdout (or, with `RA_PINO_TRANSPORT=<path>`, a file) and forwards to one
of the destinations below. All destinations support Australian-region
ingestion and storage so APP 8 cross-border-transfer disclosure is not
triggered by the observability pipeline itself.

| Destination | Region | Posture | Config |
|---|---|---|---|
| **BetterStack (Logtail)** | AU (`eu-au`) | Recommended pre-pilot | `RA_LOG_SHIP=true`, run `logtail-agent` with the AU endpoint. |
| **Sumo Logic** | `Sydney` (`au.collection`) | Recommended for councils on Sumo | Install Sumo Installed Collector pinned to `https://syd-collection.sumologic.com`. |
| **AWS CloudWatch Logs** | `ap-southeast-2` | Phase 6 default | EC2 / ECS task role + CloudWatch Agent; log group `/ratesassist/web/<env>`. |
| **Datadog** | `ap1.datadoghq.com` | Optional for tenants on Datadog | `DD_SITE=ap1.datadoghq.com` + Datadog Agent. |

### Configuration snippets

**BetterStack (recommended pre-pilot)** — set on the host or container:

```sh
RA_LOG_SHIP=true
LOG_LEVEL=info
LOGTAIL_TOKEN=<source token>
LOGTAIL_ENDPOINT=https://in.logtail.com   # AU region
```

**CloudWatch (Phase 6 AWS migration)** — IAM role attached to the task
includes `logs:CreateLogStream` and `logs:PutLogEvents` against the
log group `/ratesassist/web/prod`. The CloudWatch Agent tails the
container stdout.

**Datadog** — `DD_AGENT_HOST` set, `DD_API_KEY` injected via secrets
manager, log-collection enabled, `RA_PINO_TRANSPORT=json` so pino emits
the JSON shape the Datadog parser expects.

---

## Retention

Two retention regimes apply.

| Class | Retention | Statutory basis |
|---|---|---|
| **Operational logs** (request lines, debug traces) | 90 days hot, 1 year cold | Internal — minimum needed to investigate incidents and tune signal quality. |
| **Audit events** (tool calls, signature events, mutating route invocations) | **7 years** | WA Local Government Act 1995 record-keeping obligations + WA State Records Act 2000 retention schedules + AU equivalent obligations in NSW/QLD where pilots later land. |

The 7-year audit retention is enforced at the audit-chain storage layer
(see `packages/db`) — not at the log destination — so an aggressive
log-purge on the operational side cannot accidentally erase the audit
record. See [`DATA-RETENTION-POLICY.md`](../DATA-RETENTION-POLICY.md) for the full policy.

---

## Alerting

Pre-pilot, the on-call is a single founder (see [`ON-CALL.md`](../ON-CALL.md)).
Alerts are wired through PagerDuty's free tier with email + SMS fall-through.

| Alert | Trigger | Severity | Response |
|---|---|---|---|
| **Readiness 503 sustained** | `/api/ready` returns 503 for >2 min | P1 | Page on-call. Runbook: [`INCIDENT-RESPONSE-RUNBOOK.md`](../INCIDENT-RESPONSE-RUNBOOK.md) §"MCP down". |
| **Tool call ok:false spike** | `>5%` of `/api/tools/*` responses log `ok:false` over 5 min | P2 | Page on-call. Investigate the failing tool first. |
| **Audit chain verify fail** | `/api/audit/verify-chain` returns mismatch | P1 | Stop writes, snapshot, escalate. This is the tamper-evident chain breaking. |
| **Auth unauthorized spike** | `>20` `auth.unauthorized` events in 5 min from a single IP | P2 | Investigate brute force; rate-limit the IP at the edge. |
| **Error rate >1%** | `level:error OR level:fatal` exceeds 1% of all log lines | P3 | Triaged at next business-day standup unless paired with a user-visible failure. |

Escalation: P1 alerts page the on-call immediately. If unacknowledged in
15 minutes, PagerDuty escalates to the backup channel (currently
email-to-Brodie). Phase 4 wires a second on-call in (see [`ON-CALL.md`](../ON-CALL.md)).

---

## Recommended log queries

The same query syntax works across BetterStack, Sumo, and CloudWatch
Insights (with the obvious source-specific prefix changes). The queries
below are written in CloudWatch Logs Insights syntax.

**Any tool call returning ok:false in the last hour**

```
fields @timestamp, scope, msg, error.type, error.message
| filter scope like /\/api\/tools/
| filter ok = "false"
| sort @timestamp desc
| limit 100
```

**Audit chain verification failures**

```
fields @timestamp, msg, error.type, error.message
| filter scope = "audit.verify-chain"
| filter level in ["error", "fatal"]
| sort @timestamp desc
```

**Auth-unauthorized spike from a single IP**

```
fields @timestamp, ipAddress, userId, msg
| filter msg like /auth.unauthorized/
| stats count() by ipAddress, bin(5m)
| sort count desc
| limit 20
```

**Readiness probe failing**

```
fields @timestamp, msg, checks
| filter scope = "/api/ready"
| filter status = 503
| sort @timestamp desc
```

**Slow tool calls (p95 > 500 ms)**

```
fields @timestamp, scope, durationMs
| filter scope like /\/api\/tools/
| stats percentile(durationMs, 95) as p95 by scope
| sort p95 desc
```

---

## Metrics roadmap

We emit structured logs today, not metrics. Counters and histograms are
derived at the log-destination side (BetterStack / Sumo dashboards). The
roadmap to first-class metrics:

- **Phase 6** — Prometheus exposition on `/api/metrics` (RED metrics per
  route, signal-firing rate by signal id, audit-chain write latency,
  MCP tool latency).
- **Phase 6** — OpenTelemetry SDK on the request path; traces shipped to
  the same destination as logs via OTLP.
- **Phase 7** — SLO + error budget tracking for the public council API.

Until Phase 6 lands, dashboards live in the log destination of choice
and the queries above are the contract.

---

## Local development

In dev (`NODE_ENV != production`), logs render through `pino-pretty` if
the optional dep is installed; otherwise they emit JSON. `LOG_LEVEL`
defaults to `debug` in dev and `info` in production. Set
`RA_PINO_TRANSPORT=json` to force the production shape in dev for
collector parser testing.

---

*Last reviewed: 2026-05-15 · Owner: Brodie · `engineering@ratesassist.com.au`.*
