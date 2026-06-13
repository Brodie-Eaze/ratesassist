# RatesAssist — load test (k6)

Officer-scale load test for the goal bar: **5,000 concurrent sustained / 15,000 burst** (3× headroom),
with SLO thresholds the run is gated on. This is the **M3** artifact; **running it is the human-gated
step `Q-ra-loadtest`** (real traffic + token spend, against a deployed ALB after `terraform apply`).

## Prerequisites
```
brew install k6        # or https://k6.io/docs/get-started/installation/
```

## Run
```
# 1) sanity first — tiny load, validates wiring + thresholds:
BASE_URL=https://app.ratesassist.com.au PROFILE=smoke  k6 run load-test/officer-load.js

# 2) the officer-scale bar:
BASE_URL=https://app.ratesassist.com.au PROFILE=steady k6 run load-test/officer-load.js   # 5k sustained
BASE_URL=https://app.ratesassist.com.au PROFILE=burst  k6 run load-test/officer-load.js   # 5k -> 15k spike
```
**15k VUs is heavy for one generator** — use `k6 cloud` or several load generators for the burst profile.

## What it models
| Weight | Workflow | Endpoints |
|---|---|---|
| 85% | officer dashboard read loop | `/api/me`, `/api/data`, `/api/recovery`, `/api/properties`, `/api/signals`, `/api/activity` |
| 10% | liveness probes (unauth) | `/api/health`, `/api/ready` |
| 5%  | expensive chat (LLM) | `POST /api/chat` |

1–4 s think-time between actions (VUs model humans, not a raw flood).

## SLOs (the run PASSES only if all hold)
- reads: `p95 < 800ms`, `p99 < 1500ms`
- chat: `p95 < 6s`, `p99 < 10s`
- `http_req_failed` rate `< 1%` · `business_errors` rate `< 2%` · `checks` rate `> 99%`
- 429s under overload are **expected backpressure**, counted as handled (not failures).

## Auth (target must allow one)
- `AUTH_MODE=login` (default) — `POST /api/auth/login {tenantId, role}` → cookie. Needs a **non-prod perf env**
  (the dev stub login refuses under `NODE_ENV=production`).
- `AUTH_MODE=autologin` — deploy with `RA_DEMO_AUTOLOGIN=1`; middleware mints a session per request.
- `AUTH_MODE=cookie` — pass a pre-captured `SESSION_COOKIE`.

Tune: `TARGET_VUS` (5000), `BURST_VUS` (15000), `TENANT` (TPS), `ROLE` (rates_officer).

## After a run
Feed the p99 / error-rate / saturation numbers into **M4 (perf remediation)** and **M2b (caching/async design)** —
those are evidence-driven: fix what the load test proves is the bottleneck, don't speculate.
