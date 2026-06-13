# Service Level Objectives — RatesAssist

Date: 2026-06-04 · Officer scale. These SLOs are enforced three ways: **pre-prod** by the k6 load-test
thresholds (`load-test/officer-load.js`), **in-prod** by the CloudWatch alarms (`infra/terraform/modules/observability`),
and **at the budget level** by the error budget below.

## SLOs
| Signal | Objective | Window |
|---|---|---|
| **Availability** | 99.9% successful responses | 30-day rolling |
| **Officer-read latency** | p99 < **1500 ms** (p95 < 800 ms) | 1-day rolling |
| **Chat latency** (LLM) | p99 < **10 s** (p95 < 6 s) | 1-day rolling |
| **Error rate** | target 5xx < **1%** | 1-day rolling |

**Error budget:** 99.9% availability = **~43 min/month** of allowed downtime. Burn it faster than ~2×/week →
freeze risky changes, prioritise reliability. (Reverse: budget healthy → ship.)

## SLO → alarm (in-prod detection)
| SLO | CloudWatch alarm (`{name_prefix}-…`) |
|---|---|
| Officer-read p99 | `alb-p99-latency` (TargetResponseTime p99 > 1.5s) |
| Error rate | `alb-5xx` (HTTPCode_Target_5XX_Count) |
| Availability | `ecs-task-floor` (RunningTaskCount < floor) + `alb-unhealthy-hosts` |
| Saturation (leading) | `rds-connections-high` (DatabaseConnections near max) + `ecs-cpu-high` |

All alarms publish to the SNS topic → `alarm_email`. Dashboard: **`{name_prefix}-golden-signals`** (latency,
errors, traffic, saturation).

## SLO → k6 threshold (pre-prod validation)
The load test fails the build if these don't hold — the SAME numbers as the prod SLOs, validated before launch:
- `http_req_duration{kind:read}`: `p95<800`, `p99<1500`
- `http_req_duration{kind:chat}`: `p95<6000`, `p99<10000`
- `http_req_failed`: `rate<0.01`

Run it (Q-ra-loadtest) at ≥3× the target (15k burst) and confirm the SLOs hold with headroom before first real council.
