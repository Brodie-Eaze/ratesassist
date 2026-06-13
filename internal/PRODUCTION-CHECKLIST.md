# RatesAssist — Production launch checklist

**Audience:** the operator (Brodie) running a real council pilot.
**Cadence:** walk through this entire document for every new council
deployment, no skipping. Print it, tick off the boxes, keep it in the
council folder.

This document complements `DEPLOY.md` (which is the technical walkthrough)
and `INCIDENT-RESPONSE-RUNBOOK.md` (which kicks in when things break).
This is the **before**: pre-flight, day-of, and first-24-hour windows.

---

## 1. Pre-flight (T-7 days)

### Secrets and config

- [ ] `npm run rotate-secret` run on a clean checkout. New
      `RA_AUTH_SECRET` pasted into Vercel **Production** scope only.
- [ ] `RA_AUTH_SECRET` is ≥ 32 hex chars (the rotate-secret script
      generates 128, so this is automatic — verify anyway).
- [ ] `ANTHROPIC_API_KEY` is a **live** key (sk-ant-api03-...), not the
      test key. Verified by hitting `/api/ready` and seeing
      `anthropic_key_present: true`.
- [ ] `ANTHROPIC_BASE_URL` is `https://api.anthropic.com.au` (or
      explicitly the council's preferred AU-region Bedrock endpoint).
      Non-AU values throw at module load in production.
- [ ] `RA_SSO_CLIENT_ID`, `RA_SSO_CLIENT_SECRET`, `RA_SSO_REDIRECT_URI`
      set. The redirect URI matches the WorkOS dashboard EXACTLY (no
      trailing slash, correct subdomain).
- [ ] `ABN_LOOKUP_GUID` set to the ATO-issued GUID for RatesAssist's
      registered application.
- [ ] `RA_NOTIFY_PROVIDER` set to a real provider (`twilio` or
      `sendgrid`). Leaving it `console` means no SMS or email goes out.
- [ ] `NODE_ENV=production` set across the Production environment.
- [ ] `RA_DEV_AUTOLOGIN_SESSION` is **unset** (not just empty, fully
      absent). Verify in the Vercel UI.

### AU data residency

- [ ] Vercel deploy is pinned to `syd1`. Confirm under Project → Settings
      → Functions → Region.
- [ ] Postgres (if `RA_USE_DB=true`) is provisioned in
      `ap-southeast-2` (Sydney) or `ap-southeast-4` (Melbourne).
- [ ] Log shipper is configured to write to an AU region. Datadog AU
      (`*.datadoghq.com.au`) or Logtail AU.
- [ ] Anthropic AU endpoint verified — the LLM client logs the resolved
      base URL at boot; check it's `api.anthropic.com.au`.

### Audit log

- [ ] Audit log is shipped to durable storage (S3 in `ap-southeast-2`
      via the log shipper, or written direct from the adapter once
      `RA_USE_DB=true`).
- [ ] At least one `rates_supervisor` account exists and can view
      `/audit` end-to-end. Verified by logging in and seeing entries
      after running a tool call.
- [ ] Tamper-evident chain verified by hitting
      `/api/audit/verify-chain` — returns `{ ok: true, valid: true }`.
- [ ] DR restore drill for the audit chain run within the last 90 days and
      PASSED (`npm run dr:audit-drill`). Latest drill artefact:
      `internal/DR-RESTORE-DRILL-2026-05-29.md`. This proves a backup of the
      compliance-critical audit store can be restored with the hash chain
      intact (RPO/RTO targets in that doc and in `internal/SLO-SLI.md`).

### Compliance and legal

- [ ] DPA signed with the council. Filed in the council folder.
- [ ] Sub-processors list in `SUB-PROCESSORS.md` matches what's actually
      in use (Anthropic, WorkOS, Vercel, Postgres provider, log shipper).
- [ ] Privacy Impact Assessment current — see `PRIVACY-IMPACT-ASSESSMENT.md`.
- [ ] Data Classification Matrix reviewed — see `DATA-CLASSIFICATION-MATRIX.md`.

---

## 2. Day-of launch (T-0)

### Smoke test (30 minutes before go-live)

Run from a fresh incognito window in a normal browser, then again from
mobile Safari to catch viewport regressions:

- [ ] `/` → middleware redirects to `/login`. No 500s.
- [ ] `/login` renders. The "Continue with Microsoft Entra" button is
      visible.
- [ ] Click the button → bounces to WorkOS → council SSO → back to
      `/api/auth/callback` → lands on `/`.
- [ ] `/api/health` returns 200.
- [ ] `/api/ready` returns 200 (all three checks green).
- [ ] `/properties` loads, returns parcels for the council tenant.
- [ ] `/chat` accepts a question, returns a response within 10s.
- [ ] `/audit` (as a supervisor) shows the activity from the smoke test.
- [ ] Cross-tenant probe: log in as TPS officer, try
      `GET /api/properties?tenantId=ASH` — expect 403.
- [ ] `/api/auth/logout` clears the cookie; `/` redirects back to `/login`.

### Observability green

- [ ] Log shipper showing live ingress. `request.start` lines visible.
- [ ] Sentry / Rollbar showing zero unhandled errors in the past 15 min.
- [ ] UptimeRobot probe green on `/api/health`.
- [ ] Status page (if any) shows "operational".

### Communication

- [ ] Council IT contact emailed: "go-live confirmed for <time>".
- [ ] Backup contact for the council confirmed available.
- [ ] On-call rotation for RatesAssist confirmed (see §4 below).

---

## 3. First 24 hours

### Watch windows

| Window         | Watcher        | Watching for                                     |
| -------------- | -------------- | ------------------------------------------------ |
| Hours 0-2      | Brodie         | First signups complete, no 5xx spikes, audit log writes. |
| Hours 2-8      | Brodie         | First officer-driven workflows. PII scrub working. Notify provider sends going through. |
| Hours 8-24     | Brodie / backup | Overnight stability. Cron jobs (if any) firing on schedule. |

### On-call

- [ ] Brodie's phone is on, set to "no DND" for the on-call number.
- [ ] Backup contact (TBD per council) primed and tested.
- [ ] Pager: route to Brodie via the council's preferred channel (SMS
      to the on-call number, or Slack DM).

### Audit log watch

- [ ] `/api/audit/log` polled every 15 minutes for the first 4 hours,
      then hourly. Verify entries are non-empty, IDs are monotonic, no
      `tenantId` cross-talk.
- [ ] If any `auth.sso.callback.exchange_failed` line appears more
      than 3 times in 10 minutes: **stop**, investigate, do not let it
      compound.

### Rollback triggers and procedure

Roll back IMMEDIATELY if any of these fire:

1. 500-rate on any route exceeds 5% over a 5-minute window.
2. Audit log writes fail for any 5-minute window.
3. Cross-tenant data leak suspected.
4. Notify provider sends going to the wrong recipients.
5. WorkOS connection compromised (see §6).

Rollback procedure:

1. Vercel dashboard → **Deployments** → previous green deploy → **Promote
   to Production**. Takes < 30 seconds.
2. Post to the council Slack / Teams channel: "Rolled back to previous
   release at <time>. Investigating."
3. Open an incident — see `INCIDENT-RESPONSE-RUNBOOK.md`.

---

## 4. On-call and escalation

| Tier              | Who              | When                            | Channel                         |
| ----------------- | ---------------- | ------------------------------- | ------------------------------- |
| Tier 1 (primary)  | Brodie           | 24/7 for the first 7 days       | SMS to on-call number           |
| Tier 1 (backup)   | TBD per council  | Brodie unavailable, P1 incident | SMS to on-call number           |
| Tier 2 (council)  | Council IT       | Council-side issues (SSO, network) | Council helpdesk            |
| Tier 2 (vendor)   | Anthropic / WorkOS / Vercel | Vendor outages                  | Their respective status pages   |

Hand-off note format: post to the on-call channel within 15 minutes of
the on-call window changing:

```
On-call hand-off — RatesAssist [council code]
From: <name>
To: <name>
Window: <YYYY-MM-DD HH:MM AET> → <YYYY-MM-DD HH:MM AET>
Open issues: <bulleted list, or "none">
Things to watch: <bulleted list, or "none">
```

---

## 5. Council kickoff template — IT contact email

Send this to the council's IT contact at T-7 days. Adjust placeholders.

```
Subject: RatesAssist — single sign-on setup ({{COUNCIL}})

Hi {{CONTACT}},

Ahead of {{GO_LIVE_DATE}}, here's what we need from your team to wire
up single sign-on. The end-state: your rates officers sign in to
RatesAssist with their existing Microsoft 365 / Entra credentials. No
new password.

We use WorkOS as the SSO front-door (WorkOS is free for our usage
tier). The handshake is standard OIDC; you'll configure ONE OAuth
application in your Entra tenant.

What we need:
  1. The display name you'd like on the sign-in screen (e.g. "Sign in
     with {{COUNCIL}}").
  2. Confirmation you can create an OAuth application in your Entra
     tenant. The redirect URI we register will be:
       https://{{PROD_DOMAIN}}/api/auth/callback
  3. If you want group-based role mapping (e.g. members of the
     "RatesAssist-Supervisors" group get the supervisor role on day
     one), the group object IDs from Entra.
  4. A 30-minute slot in the next week to do the live wire-up
     together. WorkOS guides us through the dashboard; you provide
     the Entra side.

What we provide on our side:
  - Pre-launch testing in a sandbox connection.
  - The redirect URI registered in WorkOS, matching {{PROD_DOMAIN}}.
  - A test account in your tenant if you need one.

Reply with availability for a 30-minute setup call and the answers
to (1)-(3). I'll have the WorkOS connection scaffolded by the time
we meet.

Thanks,
Brodie
RatesAssist
brodie@ratesassist.com.au
```

---

## 6. Security incident: WorkOS connection compromise

If you suspect the WorkOS client secret has leaked:

1. Open the WorkOS dashboard → API Keys → **Rotate** the API key.
2. Update `RA_SSO_CLIENT_SECRET` in Vercel Production with the new
   value.
3. Redeploy (push a no-op commit, or hit "Redeploy" in Vercel).
4. The old secret is invalidated by WorkOS immediately. In-flight
   OAuth handshakes fail (users retry; succeed with new secret).
5. Open an incident, see `INCIDENT-RESPONSE-RUNBOOK.md`.
6. Notify the council IT contact in writing — they may want to rotate
   on their side too.

**Time budget:** 15 minutes from detection to rotation completed.

---

## 7. Sign-off

Before declaring "production" for a council:

- [ ] All checkboxes above ticked.
- [ ] Council IT contact has signed off on the SSO setup in writing.
- [ ] First officer has signed in end-to-end and confirmed they can
      see their council's data.
- [ ] Audit-log chain verified.
- [ ] Brodie has personally walked the council's CFO or rates manager
      through the dashboard.
- [ ] This file (a copy with completed checkboxes) is filed in the
      council folder.

Sign-off:

| | |
| --- | --- |
| Council | _________________________ |
| Go-live date | _________________________ |
| Operator | Brodie |
| Operator signature | _________________________ |
| Council IT sign-off | _________________________ |
| Notes | _________________________ |
