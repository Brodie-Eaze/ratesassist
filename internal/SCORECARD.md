# RatesAssist — Ship-Readiness Scorecard

**Date:** 2026-06-04 · **Target:** officer-scale production (5k sustained / 15k burst).
Refreshed after the autonomous M1–M6 build run. Supersedes the scale view of
`~/.claude/projects/-Users-Brodie/ship-ready-reports/2026-05-31-ratesassist-pilot.md`.

> This is a SCORECARD refresh, **not** a full `/ship-ready` agent-swarm run (that's the most expensive command —
> kick it off deliberately when you want the full adversarial pass). Numbers below are evidence-based.

## VERDICT: NOT YET SHIPPABLE — capped at **80/100** (unchanged ceiling)

The reversible engineering is strong and verified. **The ship score is CAPPED — and cannot exceed ~80 — until
three human-gated facts become true.** None are code:

1. **No deployed environment exists.** All infra is `terraform validate`-clean but **unapplied** — there is no
   running RDS/ECS/ALB. "It works" is proven in tests + validation, not in production.
2. **Officer scale is UNPROVEN.** The k6 harness + SLOs + RDS Proxy + autoscaling are authored, but the load test
   **has not been run** against a real ALB. We cannot claim "handles thousands concurrent" until it's measured.
3. **The legal wall is open.** DPAs (incl. Anthropic AU) + cyber/E&O insurance + counsel sign-off are required
   before any real council/ratepayer PII. (Synthetic-data load testing does not need this; real onboarding does.)

## Category scores (raw — what the reversible work earns)
| Category | Raw | Note |
|---|---|---|
| Security | 9.0/10 | RLS DB-enforced (FORCE, fail-closed) + NOBYPASSRLS `app_user` artifact + boot seatbelt; secrets in Secrets Manager; forced TLS; per-IP + per-tenant rate-limit. |
| Code quality | 9.5/10 | typecheck 0 (8 workspaces, strict); **980 tests pass / 1 skip**; 0 dangling imports. |
| System integrity | 9.0/10 | Connectivity audit: 0 P0 / 0 P1; every page/API/package wired. |
| Reliability | 7.5/10 | Multi-AZ RDS, circuit-breaker auto-rollback, RDS Proxy IaC, DR drill green — but **unproven live** (not applied). |
| Operational | 7.5/10 | Golden-signals dashboard + alarms (p99/RDS/task-floor), SLOs, 6 scale runbooks, break-glass switches — **authored, not live**. |
| Compliance | 7.0/10 | Tamper-evident audit chain, PII controls, honest privacy posture — **legal wall (DPAs/insurance) open**. |
| Performance | 6.5/10 | Mechanical levers in place (indexes, per-tenant audit lock, sweep dedup); **UNMEASURED** until the load test runs. |
| Scale-readiness | 6.0/10 | RDS Proxy + dual autoscaling + k6 harness + caching design — **all authored, none applied or run**. The hard cap. |
| Customer readiness | 2.0/10 | Pre-pilot; no signed council; legal wall. |

**Raw composite ≈ 80/100.** The capped final **stays 80** — the reversible work raised the floor of *quality* but
the *ship* ceiling is held by items 1–3 above. Honest read: the platform is **deploy-ready and validation-clean,
one `terraform apply` + one load-test run + the legal wall away from a defensible officer-scale launch.**

## What moves each needle (and who owns it)
- **Apply the infra** (Q-ra-apply, Q-ra-state, Q-ra-secrets, Q-ra-approle, Q-ra-dns) → unlocks Reliability/Operational/Scale to "live". **You** (AWS creds).
- **Run the load test** (Q-ra-loadtest, `load-test/officer-load.js`) → turns Performance + Scale-readiness from *authored* to *proven*; then implement the M2b cache if the p99 needs it. **You approve**, agent can run.
- **Clear the legal wall** (Q-ra-legal) → unlocks Compliance + Customer readiness for real councils. **You + lawyers.**
- **Optional:** run the full `/ship-ready` agent-swarm for the adversarial pass once a staging env is up.

All Q-ra-* items are in `~/.claude/projects/-Users-Brodie/approval-queue/pending.md` → `/approve`.
