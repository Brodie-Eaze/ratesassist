# Deploying RatesAssist

This document is the operator-facing deploy guide for the `apps/web`
Next.js app. It covers the Vercel deploy walkthrough, the env-var
contract, the production hardening steps, and honest cost estimates.

> Status: **production-ready pre-flight**. The auth surface has been
> upgraded from a stub to a real WorkOS OAuth callback. The deploy is
> ready for a live council pilot provided the pre-launch checklist below
> is satisfied. Read it end-to-end before pointing council traffic at any
> deploy.

---

## 1. Quick start (local dev)

```bash
git clone <repo> RatesAssist
cd RatesAssist
npm install
npm run build --workspace=@ratesassist/adapter-demo   # build the MCP adapter once
npm run dev:web                                       # http://localhost:3000
```

`npm run dev:web` uses the `mcp` transport by default. To exercise the
in-process transport locally:

```bash
RA_TOOL_TRANSPORT=inproc npm run dev:web
```

Smoke + ship-check:

```bash
npm run ship-check    # full gate (typecheck, tests, build, audit, wiring)
npm run smoke         # end-to-end against a built web app, 25 cases
npm run rotate-secret # generate a fresh RA_AUTH_SECRET (does not write files)
```

---

## 2. Deploy targets

| Target              | Transport | AU residency        | Spawn-friendly | Cost (entry) | Best for                          |
| ------------------- | --------- | ------------------- | -------------- | ------------ | --------------------------------- |
| Vercel (recommended)| `inproc`  | Sydney (`syd1`)     | No             | Free / Pro $20| Council pilots + demos           |
| Render web service  | `mcp`     | Singapore (no AU)*  | Yes            | $7/mo        | Phase 1B wire-faithful tests      |
| Railway             | `mcp`     | Singapore (no AU)*  | Yes            | ~$5/mo       | Same as Render, simpler UX        |
| Fly.io              | `mcp`     | Sydney (`syd`)      | Yes            | ~$3-5/mo     | AU residency + MCP wire           |
| Self-hosted (any)   | either    | Wherever you host   | Yes            | varies       | Council-managed infrastructure    |

\* Render and Railway lack a Sydney region today; data resides in Singapore.
For council pilots that require AU data residency, prefer Vercel `syd1`
or Fly.io `syd`.

### Picking a transport

`apps/web/lib/mcp-client.ts` selects a transport at boot:

1. `RA_TOOL_TRANSPORT=mcp|inproc` — explicit override (highest priority).
2. `VERCEL=1` — auto-select `inproc`.
3. Fallback — `mcp`.

`mcp` spawns `packages/adapter-demo/dist/server.js` per Node process. `inproc`
imports the dispatcher and calls it in-process. Same dispatcher, same
Zod validation. Use `inproc` on Vercel; either works elsewhere.

---

## 3. Vercel walkthrough — 10 steps

This is the canonical deploy path. Total wall-clock time: ~15 minutes
from a fresh Vercel account on a 100 Mbps link.

### Step 1 — Push the repo

Push the monorepo to a Git host Vercel supports (GitHub, GitLab, Bitbucket).
Vercel pulls on every push to the configured branch.

### Step 2 — Generate a production auth secret

```bash
npm run rotate-secret
```

Copy the printed `RA_AUTH_SECRET=<...>` value to your clipboard. You'll
paste it into the Vercel UI in step 5. **Do not commit this value to
git.** **Do not echo it into a shared `.env.local`.**

### Step 3 — Create the Vercel project

In Vercel: **Add New Project** → import the repo. Leave the framework
preset as detected (Next.js); the root `vercel.json` overrides the
build, install, and output paths.

### Step 4 — Configure the region

Vercel reads `regions: ["syd1"]` from `vercel.json` automatically. Verify
under **Project → Settings → Functions**. Sydney is the only AU region
Vercel offers and is required for council-data residency.

### Step 5 — Set environment variables

Project → Settings → Environment Variables. Add every variable below for
the **Production** environment. Repeat for **Preview** if you want PR
previews to authenticate the same way.

| Variable                  | Required | What it does                                          | How to obtain                                | Example value (redacted)                     |
| ------------------------- | -------- | ----------------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| `RA_AUTH_SECRET`          | **YES**  | HMAC key for session cookies. Refuse-to-start if absent. | `npm run rotate-secret`                       | `5e6f...` (128 hex chars)                    |
| `NODE_ENV`                | **YES**  | Locks ABN client to strict mode, gates dev fallbacks. | Hardcode `production`                         | `production`                                 |
| `ANTHROPIC_API_KEY`       | **YES**  | Live tool-loop chat. Falls back to deterministic mock when unset. | https://console.anthropic.com → API Keys      | `sk-ant-api03-...`                           |
| `ANTHROPIC_BASE_URL`      | recommended | AU region pin. Defaults to `https://api.anthropic.com.au`. Non-AU values throw in prod. | Anthropic AU console                          | `https://api.anthropic.com.au`               |
| `RA_SSO_CLIENT_ID`        | **YES** for SSO | WorkOS client id. Identifies the project to WorkOS. | https://dashboard.workos.com → API Keys       | `client_01H4F0...` (28 chars)                |
| `RA_SSO_CLIENT_SECRET`    | **YES** for SSO | WorkOS API key. Treat as a production secret.        | https://dashboard.workos.com → API Keys       | `sk_live_...` (variable length)              |
| `RA_SSO_REDIRECT_URI`     | **YES** for SSO | OAuth callback. Must match the WorkOS dashboard exactly. | Your production domain                         | `https://app.ratesassist.com.au/api/auth/callback` |
| `RA_SSO_PROVIDER`         | optional | IdP hint for WorkOS. Defaults to `MicrosoftOAuth`.   | n/a                                          | `MicrosoftOAuth`                             |
| `RA_PLATFORM_ADMIN_EMAILS`| optional | Emails that become `platform_admin` on sign-in.       | Your team roster                              | `brodie@ratesassist.com.au`                  |
| `ABN_LOOKUP_GUID`         | recommended | ATO ABR queries. Absent => deterministic mock for known ABNs. | https://abr.business.gov.au/Tools/WebServices | `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`       |
| `RA_NOTIFY_PROVIDER`      | recommended | Outbound SMS/email. `console` (default), `twilio`, `sendgrid`. | n/a                                          | `console`                                    |
| `RA_TOOL_TRANSPORT`       | locked   | Already in `vercel.json`. Do NOT override.            | n/a                                          | `inproc`                                     |
| `RA_USE_DB`               | future   | Flip to `true` to switch off in-memory state when Postgres is provisioned. | n/a                                          | `false`                                      |

Set the `Production`, `Preview`, and `Development` scopes appropriately:

- `RA_AUTH_SECRET` — **different value per scope.** Never share secrets
  between Production and Preview.
- `ANTHROPIC_API_KEY` — separate test/live keys per scope is fine.
- `RA_SSO_REDIRECT_URI` — per-scope: `https://*.vercel.app/api/auth/callback`
  for Preview won't work because WorkOS requires an exact match. Either
  configure a separate WorkOS connection for Preview or skip SSO outside
  of Production and rely on dev autologin (see §7).

### Step 6 — Configure WorkOS

In the WorkOS dashboard:

1. Create an **SSO Connection** for the council (or shared connection
   for the demo).
2. Connection type → **Microsoft OAuth** (default for council Entra ID).
3. Configure the redirect URI to **exactly** the `RA_SSO_REDIRECT_URI`
   value you set in step 5.
4. If using SCIM / JIT provisioning, configure the directory mapping.
5. Hand the IT contact at the council a one-pager (template at
   `internal/PRODUCTION-CHECKLIST.md` §5) with the metadata URL.

### Step 7 — Deploy

Click **Deploy**. The build runs `vercel.json`'s `buildCommand`:

```
npm run build --workspace=@ratesassist/contract --if-present
  && ... (each package in dependency order)
  && npm run build --workspace=apps/web
```

Expect 3-4 minutes for the first build. The build is deterministic and
the output is cached on subsequent deploys.

### Step 8 — Verify `/api/health`

```bash
curl https://<your-domain>/api/health
# Expected: {"ok":true,"ts":"2026-..."}
```

If you get a 5xx, check `vercel logs` (or the Logs tab in the dashboard)
for the boot error. The most common failure is `RA_AUTH_SECRET` missing
or shorter than 16 chars.

### Step 9 — Verify `/api/ready`

```bash
curl https://<your-domain>/api/ready
# Expected on green: {"ok":true,"checks":{"mcp":true,"mcp_tools":true,"anthropic_key_present":true},...}
# 503 on red — the body tells you which check failed.
```

A 503 here is non-blocking for the demo flow (the app still serves the
landing page), but the readiness probe should be green before pointing
council traffic at the deploy.

### Step 10 — Verify the SSO round-trip

Open the production URL in a fresh incognito window:

1. `/` → middleware redirects to `/login`.
2. Click **Continue with Microsoft Entra**.
3. Auth completes at WorkOS, which redirects to `/api/auth/callback?code=...`.
4. Callback exchanges, sets the cookie, redirects to `/`.
5. You should land on the authed dashboard with your council tenant.

If step 4 lands on `/login?error=callback_failed`, check `vercel logs`
for the `auth.sso.callback.exchange_failed` line — the upstream body
field carries WorkOS's diagnostic text.

---

## 4. Pre-launch checklist

Before pointing any non-demo council traffic at a deploy:

- [ ] **Auth secret rotated**: `npm run rotate-secret` run, value pasted
      into Vercel Production scope, NOT committed anywhere.
- [ ] **Anthropic key**: AU-region key (`ANTHROPIC_BASE_URL` resolves to
      `api.anthropic.com.au`).
- [ ] **WorkOS connection**: live connection in the WorkOS dashboard,
      `RA_SSO_*` set in Vercel, redirect URI matches exactly.
- [ ] **Notify provider**: `RA_NOTIFY_PROVIDER` set to `twilio` or
      `sendgrid` (not `console`) for council-facing deploys that send
      SMS or email. Leaving it `console` means no real notifications go
      out.
- [ ] **`/api/health`** returns 200.
- [ ] **`/api/ready`** returns 200 (not 503).
- [ ] **SSO round-trip** verified end-to-end (see step 10 above).
- [ ] **Audit log** opens at `/audit` for a `rates_supervisor` session;
      events show up after a `/api/properties` call.
- [ ] **Log shipping** wired (Datadog / Logtail / Better Stack / etc.).
      `auth.sso.callback.success` lines are visible in the shipper.
- [ ] **Error tracker** wired (Sentry / Rollbar / Honeybadger). 500s
      and unhandled rejections surface as alerts.
- [ ] **Uptime monitor** on `/api/health` (UptimeRobot, Better Uptime).

See `internal/PRODUCTION-CHECKLIST.md` for the full pre-flight, day-of,
and first-24-hour runbook.

---

## 5. Production hardening

### 5.1 Flipping to Postgres

The current demo adapter stores everything in memory. For a real council
pilot you'll want durable state. Provision a Postgres instance (Neon,
Supabase, or AWS RDS in `ap-southeast-2`), then:

1. Set `DATABASE_URL=postgres://...` in Vercel.
2. Set `RA_USE_DB=true` in Vercel.
3. Run the schema migration: `npm run db:migrate` from a dev box with
   `DATABASE_URL` exported.
4. Restart the Vercel deployment (push a no-op commit, or hit the
   **Redeploy** button).

The demo adapter detects `RA_USE_DB=true` at boot and switches to the
Postgres implementation. No code changes; same dispatcher, same Zod
validation, same audit guarantees.

### 5.2 Per-tenant Postgres RLS

Once `RA_USE_DB=true` is live, enable RLS on every tenant-scoped table:

```sql
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON properties
  USING (tenant_id = current_setting('app.tenant_id')::text);
```

The web app sets `SET app.tenant_id` per request based on the session
tenant. Cross-tenant reads require `platform_admin` (already enforced
at the route layer; RLS is the defence-in-depth layer below it).

### 5.3 Secret rotation cadence

- `RA_AUTH_SECRET` — rotate every 90 days, or immediately on any
  suspected leak. Use `npm run rotate-secret`. Plan a 5-10 minute
  maintenance window — every signed-in user is logged out.
- `RA_SSO_CLIENT_SECRET` — rotate via the WorkOS dashboard. The new
  secret is picked up on the next process restart.
- `ANTHROPIC_API_KEY` — rotate via the Anthropic console.

### 5.4 Region + residency

- The Vercel deploy is pinned to `syd1`. **Do not** change `regions` in
  `vercel.json` without a separate AU-residency review.
- `ANTHROPIC_BASE_URL` defaults to `https://api.anthropic.com.au`. The
  LLM client throws at module load if a non-AU base URL is configured
  in production (SEC-007).
- WorkOS data sovereignty: WorkOS is hosted in the US. The OAuth handshake
  bounces through WorkOS, but no council PII transits — the council's
  Entra tenant is the source of truth.

---

## 6. Cost estimates (honest, monthly, AUD)

For a single council pilot (one tenant, ~50 officer logins, ~10k chat
turns, ~50k API calls):

| Service              | Tier                  | Monthly cost     | Notes                                    |
| -------------------- | --------------------- | ---------------- | ---------------------------------------- |
| Vercel               | Hobby                 | $0               | Sufficient for pilot. 100 GB-hours.      |
| Vercel               | Pro                   | ~$30 (USD $20)   | Production-grade. Recommended.           |
| Anthropic Claude     | Pay-as-you-go         | ~$50-150         | 10k chat turns @ Sonnet 4.5. Varies.     |
| WorkOS               | Free tier (1M MAU)    | $0               | Free until you cross 1M monthly users.   |
| Postgres (Neon)      | Free → Pro            | $0 → $30         | Free tier covers pilot; upgrade at scale.|
| Logtail / Better Stack| 1 GB ingest          | $0 → $10         | Free for low-volume pilots.              |
| Sentry               | Developer             | $0 → $40         | Free for 5k errors/mo.                   |
| UptimeRobot          | Free                  | $0               | 50 monitors at 5min cadence.             |
| **Pilot total**      |                       | **$50-200**      | One council, one tenant.                 |

At three councils with Postgres, paid logging, and Sentry team, expect
$300-500 AUD/month.

---

## 7. Demo deploy (no secrets)

Minimum viable deploy for a council CFO walkthrough:

1. Vercel, with steps in §3 above.
2. **No** `ANTHROPIC_API_KEY` — `/api/chat` falls back to a deterministic
   mock that still exercises the MCP tool surface.
3. **No** `ABN_LOOKUP_GUID` — the ABN client returns honest mock results
   for the seeded test ABNs.
4. **No** `RA_SSO_*` — set `RA_DEV_AUTOLOGIN_SESSION=default` in Vercel
   to auto-mint a demo session on every request. Production-environment
   guards in `parseDevAutologin()` still apply — autologin is silently
   ignored if `NODE_ENV=production`, so for a no-auth demo set
   `NODE_ENV=development` in the Vercel scope. Switching this off for a
   real council deploy is then a single env-var change.
5. Synthetic dataset shipped in `packages/adapter-demo/src/data` is
   sufficient for every flow in the demo script.

Total cost: $0. Lead time: ~5 minutes from a fresh Vercel account.

---

## 8. Rollback

If something goes wrong post-deploy:

1. **Immediate** — Vercel dashboard → **Deployments** → previous green
   deploy → **Promote to Production**. Sub-second rollback.
2. **Disable SSO temporarily** — unset `RA_SSO_CLIENT_ID` in Vercel and
   redeploy. `/api/auth/callback` returns 501; users can't sign in but
   the app doesn't 500.
3. **Block all writes** — set `RA_BLOCK_WRITES=true` to lock mutations
   while you investigate. Reads continue.
4. **Full incident** — see `INCIDENT-RESPONSE-RUNBOOK.md`.

---

## 9. Other targets

### Render (faithful MCP wire)

Render web services run a long-lived Node process and can spawn child
processes, so the default `mcp` transport works.

1. **New** → **Web Service** → connect repo.
2. Build: `npm install && npm run build`
3. Start: `npm run start --workspace=apps/web`
4. Plan: Starter ($7/mo).
5. Region: Singapore (closest to AU).
6. Env vars: same matrix as Vercel **except** leave `RA_TOOL_TRANSPORT`
   unset (defaults to `mcp`).

### Fly.io (AU residency + MCP wire)

Best of both worlds — Sydney region AND child-process spawn. Requires a
Dockerfile (not yet committed). TBD when greenlit.

---

## 10. Troubleshooting

| Symptom                                  | Likely cause                          | Fix                                          |
| ---------------------------------------- | ------------------------------------- | -------------------------------------------- |
| Boot fails: `RA_AUTH_SECRET is required` | Missing in Production scope           | Set via `npm run rotate-secret` → Vercel UI  |
| `/api/ready` 503: `mcp:false`            | adapter-demo failed to import         | Rebuild; check `vercel logs` for stack trace |
| `/api/ready` 503: `anthropic_key_present:false` | Key not set or wrong shape    | Verify starts with `sk-ant-`                 |
| `/login?error=callback_failed`           | WorkOS exchange or state mismatch     | Check `auth.sso.callback.*` logs             |
| `/login?error=sso_not_configured`        | `RA_SSO_*` not set                    | Set the three required vars (see §3 step 5) |
| 403 on every POST                        | CSRF origin mismatch                  | Check `Origin` header is your domain         |
| Slow first request                       | Cold start                            | Vercel Pro keeps functions warm              |
