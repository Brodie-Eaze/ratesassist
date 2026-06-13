# RatesAssist — Operator Handoff & Go-Live Runbook

**What this is:** the contract for running RatesAssist toward production autonomously, and the exact list of
things **only you (Brodie)** can do. Pairs with `internal/PRODUCTION-CHECKLIST.md` (full pre-prod checklist)
and `internal/PILOT-RUNBOOK.md` (pilot ops). Target: **officer scale — 5k concurrent sustained / 15k burst**
(not 50k; see `goals`).

---

## The autonomy contract (read once)

The loop runs **every reversible thing to completion**, then **stops at the credential boundary and queues
the irreversible** for your `/approve`. It will never touch your AWS credentials, run `terraform apply`,
deploy, write a secret, move money, or contact a council/regulator.

| The loop does (reversible, autonomous) | You do (irreversible / credential-bearing) |
|---|---|
| Code, migrations (authored), IaC edits in `infra/terraform/` | Hold AWS credentials; run `terraform apply` |
| The k6 load-test harness (authored) | **Run** the load test against live infra (costs $ + tokens) |
| Perf fixes, caching, pooling config, rate limiting | Provision RDS / ElastiCache / RDS Proxy (the apply) |
| Observability config, runbooks, SLOs | Create the AWS account + billing |
| `/council`, `/ship-ready`, branches + shadow-PRs | Merge to `main`; deploy |
| Write the exact apply/deploy commands into the queue | Put secrets in Secrets Manager; own the domain/DNS |
| Everything to a green, verified, deployable state | The legal wall (DPAs, insurance, counsel) |

**Kill switch (your big red button):** `touch ~/.claude/.operate-pause` stops the loop immediately;
`rm ~/.claude/.operate-pause` resumes.

---

## Tier 0 — Let the loop run *(done / 5 min)*

- ✅ **Goal registered** — `~/HQ/ratesassist/goals/active.md` (+ mirror in `memory/goals/`). RatesAssist is
  #1 in the goal stack.
- ✅ **Project registered** — `~/RatesAssist` in `active-projects.yaml`.
- **Start the heartbeat** (pick one):
  - *While your Mac is awake (simplest):* run `/loop 3h /operate --scope ratesassist` (fires every 3h), or just
    say "run /operate on ratesassist" when you're at the desk.
  - *True 24/7 (laptop shut):* a remote scheduled agent (`/schedule`) — deliberately flip this on; it's the
    only path that runs with the machine off.
- **Budget:** default 400k tokens/pass. Raise/lower per pass with `--budget`.

> With Tier 0 done, the loop will START working M1–M6 (reversible) immediately and queue M7 for you. It does
> NOT need anything below to *begin* — but it CANNOT *finish* (deploy + prove scale) until you clear Tier 1.

---

## Tier 1 — Get a deployed app at a real URL *(YOU — the critical unblock)*

The loop will prepare all of this as reversible work (tfvars, backend config, the exact commands) and queue it.
Your hands on the credential-bearing steps:

1. **AWS account + deploy identity.** Create/confirm the AWS account. Set up a deploy identity (preferably a
   GitHub OIDC role — no long-lived keys) or `aws configure` a profile. *I never see these.*
2. **Terraform state backend.** Create an S3 bucket + KMS key + DynamoDB lock table in `ap-southeast-2` (the
   loop will queue the exact `aws s3api` / `aws kms` commands, or a bootstrap `infra/terraform/bootstrap/`).
3. **Fill `terraform.tfvars`.** Copy `infra/terraform/terraform.tfvars.example` → `terraform.tfvars`; set domain,
   hosted-zone id, instance sizes. (Gitignored — never committed.)
4. **Apply.** From `infra/terraform/`:
   ```
   terraform init -backend-config=...      # backend from step 2
   terraform plan                          # review — the loop will have posted an expected plan
   terraform apply                         # ← YOU run this. Stands up RDS + ECS + ALB + ACM.
   ```
5. **Domain + TLS.** Point `app.ratesassist.com.au` nameservers at the Route53 zone / approve the ACM DNS
   validation record.
6. **Secrets → Secrets Manager** (never `.env` in prod, never to me):
   - `ANTHROPIC_API_KEY` — **production tier, AU region** (data residency is a HARD requirement)
   - `RA_AUTH_SECRET` — 32+ char random (the app refuses to boot in prod without it)
   - DB connection creds
7. **Database tier (the RLS trap).** Provision the **NOBYPASSRLS** app role (the loop authors the migration in
   `packages/db/migrations/`). Set `DATABASE_URL=postgres://<that role>@<RDS-Proxy-endpoint>/<db>`. **RLS is
   silently INERT under a superuser / BYPASSRLS role** — this step is what makes tenant isolation real.
8. **Run migrations on RDS.** `packages/db/migrations/` applied against the live DB (queued command; you run it).

When 1–8 are done, the app is live. The switch from laptop-mode to prod is literally `DATABASE_URL=postgres://…`
(unset/`pglite://` = in-memory; `postgres://` = real Postgres — see `packages/db/src/client.ts`).

---

## Tier 2 — Prove officer scale *(loop does it, AFTER Tier 1 exists)*

Once there's a deployed env to hit: the loop runs the **M3 load test at 5k sustained / 15k burst** against the
real ALB, then the **M4 remediation loop** (N+1, indexes, pooling, caching, backpressure) until p99 is within
SLO with 3× headroom and zero data-integrity breaks. Then `/ship-ready` to ≥95. *Your part: approve the queued
load-test RUN (it generates real traffic + token spend) and watch the score climb.*

---

## Tier 3 — Onboard REAL councils + ratepayer PII *(YOU + lawyers — NOT needed for a synthetic load test)*

- DPAs (incl. **Anthropic AU**), cyber + E&O insurance bound, counsel sign-off on TOS/MSA, a signed pilot.
- The platform stays **pre-pilot (public/synthetic data only)** until this wall is cleared.

---

## The approval-queue flow (how queued work reaches you)

Each irreversible step the loop produces lands in `~/.claude/projects/-Users-Brodie/approval-queue/pending.md`
as a structured entry (what / why / evidence / risk / who-executes). Review them with **`/approve`**:
- `agent-on-approval` → I may run it after you approve, with a fresh safety re-check.
- `human-only` → you execute (everything credential-bearing: apply, deploy, secrets, money, legal).

---

## Quick reference

| Want | Do |
|---|---|
| Start the loop now | `/loop 3h /operate --scope ratesassist` |
| Run one pass at the desk | "run /operate on ratesassist" |
| Pause everything | `touch ~/.claude/.operate-pause` |
| Resume | `rm ~/.claude/.operate-pause` |
| See what's waiting on you | `/approve` |
| Re-run the wiring audit | the saved workflow script (see CONNECTIVITY-AUDIT-2026-06-04.md) |
| Boot the app locally | `cd ~/RatesAssist && npm run dev --workspace=apps/web` → http://localhost:3000 |
