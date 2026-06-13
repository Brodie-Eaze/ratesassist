# Incident Runbooks — Scale / Day-2

Date: 2026-06-04. Companion to the general `INCIDENT-RESPONSE-RUNBOOK.md` (root) — this one covers the
officer-scale failure modes + the break-glass switches that already exist in code. Each links its detecting
alarm (`{name_prefix}-…`, SNS → `alarm_email`) and the dashboard `{name_prefix}-golden-signals`.

> Golden rule: the **deterministic product keeps serving even when the AI or a dependency is down** — pull the
> narrow switch, don't take the platform down.

## 1. DB connection exhaustion
- **Alarm:** `rds-connections-high` (+ rising p99, 5xx).
- **Likely cause:** scale-out storm (tasks × `RA_DB_POOL_MAX` > instance max_connections), or proxy disabled.
- **Act:** confirm **RDS Proxy** is enabled (`enable_rds_proxy=true` — it multiplexes; this is the designed fix);
  if not yet enabled, lower `RA_DB_POOL_MAX` (task env) to cut tasks×pool; scale the RDS instance class if sustained.
- **Why it's bounded:** `statement_timeout=15s` + `idle_in_transaction_session_timeout=10s` already cap runaway holds.

## 2. RDS failover (Multi-AZ)
- **Symptom:** brief connection blips, a spike of errors for ~30–60s.
- **Act:** usually self-heals — the pg pool reconnects. Watch `rds-connections-high` + 5xx recover. If the app
  wedges, force a new ECS deployment (rolling) to refresh pools. Multi-AZ is on by default (`db_multi_az`).

## 3. ECS task crashloop / deploy stall
- **Alarm:** `ecs-task-floor` (RunningTaskCount < floor) + `alb-unhealthy-hosts`.
- **Act:** the service has `deployment_circuit_breaker { rollback = true }` — a bad image **auto-rolls back**.
  Check task logs in the log group; if a config/secret is the cause, fix the secret + redeploy. Don't disable the
  circuit breaker.

## 4. Anthropic outage / cost spike
- **Symptom:** chat latency/errors up; reads unaffected.
- **Built-in:** `runChat` catches transport failures and **degrades to the deterministic mock** (`modelUsed.reason="live_failed"`);
  reads never touch the LLM.
- **Break-glass:** trip the chat kill switch that `isChatKilled()` reads (apps/web/lib) — pulls the AI entirely
  while the rest of RatesAssist serves. Or force mock via `MOCK_LLM=mock`. Re-enable when the provider recovers.

## 5. Rate-limit storm / overload
- **Alarm:** `alb-p99-latency` + `alb-5xx` climbing; autoscaling (CPU + request-count policies) should add tasks.
- **Built-in:** `apps/web/lib/rate-limit.ts` returns **429 backpressure** (per-IP; per-tenant + global helpers
  available); 429s are expected load-shedding, not failures.
- **Act:** confirm autoscaling is scaling out (dashboard saturation panel); if a single tenant/IP is abusive, the
  per-tenant/global limiter (`rateLimitComposite`/`globalRateLimit`) can be wired into the hot route (reviewed change).

## 6. RLS misconfig at boot (serving role can bypass RLS)
- **Symptom:** the app **refuses to boot** (fail-closed) with a `REFUSING TO SERVE` error.
- **Built-in:** `assertNonBypassRlsRole()` (packages/db) blocks serving if the role is superuser/BYPASSRLS — this
  is correct, protective behaviour. Fix: connect as the NOBYPASSRLS `app_user` (`infra/sql/provision-app-role.sql`).
- **Break-glass (last resort, logged loudly):** `RA_ALLOW_BYPASSRLS_DB=1` to boot anyway — only with a deliberate,
  documented reason; RLS may be INERT. Similarly `RA_ALLOW_EPHEMERAL_DB=1` only for an intentionally-stateless demo.
