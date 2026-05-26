# Operator Action Items — RatesAssist Tom Price Shire pilot

> Single source of truth for items Claude **cannot close autonomously**.
> Everything in this file requires Brodie to act: a credential, a
> signature, a payment, a regulatory disclosure, or a decision only the
> human-in-the-loop can make. Sorted by **launch-criticality**.
>
> **Date generated:** 2026-05-26
> **Source iterations:** ship-ready iter1 + iter2 + iter3, /launch Phase 1
> **Target state:** pilot live, MoU signed, ship-readiness score ≥ 95

---

## 🔴 BLOCKS-PILOT — must close before MoU effective date

### OP-01 — Pin Railway to AU region OR migrate to Vercel `syd1`
**Source:** Compliance audit (🔴 BLOCKING #1), Risk Register R-02
**Why blocking:** Council ratepayer PII is currently hosted on Railway US-East. Under Australian Privacy Principle 8 (cross-border disclosure of personal information), the council cannot lawfully share rating-roll data with a service that processes it offshore without explicit consent in the collection notice. The MoU **cannot be signed** until this is resolved.
**Two options:**
1. **Railway AU pin** (10 min): `railway environment` → service settings → Region → `ap-southeast-2`. Redeploys automatically. Cheapest path.
2. **Vercel syd1 migration** (~1 hr, see prior session discussion): would also unblock GitHub-Actions-billing dependency (OP-04 below) since Vercel auto-deploys without CI.
**Who:** Brodie
**Decision needed:** which option

### OP-02 — Council MoU signature (Shire of Ashburton)
**Source:** /launch Phase 1, `launch/MOU-TOM-PRICE-SHIRE.md`
**Why blocking:** The 17-section MoU draft is signature-ready. Until it's executed, the pilot has no legal frame. The success-fee model (12% capped at $250k/candidate, paid quarterly in arrears over 24 months) requires both signatures to be enforceable.
**Pre-signature checklist:**
- [ ] OP-01 closed (Railway region pinned)
- [ ] OP-03 closed (sub-processors list updated)
- [ ] OP-08 closed (deceased-inference disclosure added to collection notice)
- [ ] Council legal officer review (allow 5-10 business days)
- [ ] Insurance review (cyber + E&O, $2M aggregate per the MoU)
**Who:** Brodie + Council Procurement
**Document path:** `launch/MOU-TOM-PRICE-SHIRE.md`

### OP-03 — Update `SUB-PROCESSORS.md` + PRIVACY-IMPACT-ASSESSMENT.md
**Source:** Compliance audit (🟠 #5), Sentry design (launch blocker #3)
**Why blocking:** APP 5 requires the council to disclose every sub-processor in its collection notice. Missing entries today:
- **Railway** (US, infrastructure) — OR Vercel syd1 if migrating
- **Esri Living Atlas** (US, Sentinel-2 imagery tiles)
- **EOX maps.eox.at** (EU/Austria, Sentinel-2 yearly composite fallback)
- **Carto CDN** (basemap tiles)
- **Sentry US** (operational telemetry — see OP-05)
- **Anthropic** (LLM, with redacted payloads per PIA §6.4)
**Who:** Brodie
**Document paths:** `/Users/Brodie/RatesAssist/SUB-PROCESSORS.md`, `/Users/Brodie/RatesAssist/PRIVACY-IMPACT-ASSESSMENT.md` §6

### OP-08 — Deceased-proprietor inference disclosure in council collection notice
**Source:** Compliance audit (🔴 BLOCKING #4)
**Why blocking:** The `id.pensioner_deceased_continued_rebate` signal cross-references Water Corp eligibility data to flag rebates being claimed for deceased ratepayers. Under APP 3.3 this is **derivation of new sensitive information**. The council's APP 5 collection notice must say so explicitly. Without that text, the notice is non-compliant and the signal cannot be lawfully run.
**Required text** (suggested wording for the council to copy):
> *"In connection with rates concession audit activities, this council may cross-reference your concession status against Water Corporation eligibility records, including deceased-proprietor data sourced from public registries. This is undertaken under the statutory function exception (APP 6.2(b)) of the Privacy Act 1988 (Cth) to ensure correct rates assessment."*
**Who:** Brodie to send the text to the Council Privacy Officer; council adopts in their next privacy-notice review

---

## 🟠 REQUIRED BEFORE SCALE — close in first 30 days post-MoU

### OP-04 — GitHub Actions billing
**Source:** /ship-ready iter1 audit
**Why required:** CI has failed every commit since approximately one week pre-iter1 with `"The job was not started because recent account payments have failed or your spending limit needs to be increased"`. Railway auto-deploys regardless (no CI dependency), but the pre-merge gate is dark. Quality regressions could land unnoticed.
**Fix:** https://github.com/settings/billing → resolve payment + raise the Actions spend cap to $10/mo (covers ~50 PR runs).
**Who:** Brodie
**Bypass if doing OP-01 option 2:** Vercel auto-deploys make this lower priority (Vercel previews are the de-facto CI). Not entirely — the ship-check script catches things Vercel doesn't.

### OP-05 — Sentry US account signup + DSN
**Source:** Sentry design (`launch/OBSERVABILITY-DESIGN.md`)
**Why required:** The 3am operational layer. Without a DSN the `lib/sentry.ts` wiring is a no-op — exceptions, tenant-override-refused events, and imagery-degraded events go to /dev/null. Reliability-engineer P0 from the prior audit.
**Steps:**
1. https://sentry.io → sign up free tier (5k errors/mo + 10k perf events)
2. Create a Next.js project named `ratesassist-web`
3. Copy DSN → paste into Railway env as `SENTRY_DSN`
4. Configure 3 alert rules per `launch/OBSERVABILITY-DESIGN.md` §6
5. Move to paid AU (Sydney) region on council #2 contract (~$26/mo)
**Who:** Brodie
**Estimated time:** 15 min

### OP-06 — DPO sign-off on `assessmentNumber` redaction shape
**Source:** Sentry design (launch blocker #2)
**Why required:** Sentry's `beforeSend` redactor will strip full `assessmentNumber` values to last-4 only (`****1234`). This preserves audit cross-system correlation with pino logs but is a deliberate identifying-info residual. Council Privacy Officer needs to sign off on the redaction shape vs full strip.
**Recommendation in the design:** last-4 only. The case to be made: full strip kills cross-system join in a 3am triage; last-4 preserves debugability while reducing re-identification risk to near-zero (each tenant has ~50k assessments, last-4 collides ~5×).
**Who:** Brodie → Council Privacy Officer

### OP-07 — Tenant-isolation runbook section
**Source:** Sentry design (launch blocker #1)
**Why required:** Sentry Alert Rule 2 (`any P0 audit-grade event`) must page when `tool.tenant_override_refused` or `cross_tenant_refused` fires. A page without a runbook is just noise — operator on-call cannot triage without a documented response. Currently `/Users/Brodie/RatesAssist/INCIDENT-RESPONSE-RUNBOOK.md` does NOT have a tenant-isolation incident section.
**What to add:**
- Symptom: P0 audit-grade event fires in Sentry
- Diagnostic: pull the structured log line with the same `correlationId` from BetterStack (or stdout)
- Determine: was it a real attacker probe or a misconfigured legitimate caller?
- Response if real: rotate the actor's session, file CFR (Critical Findings Report), notify Council DPO within 72 hrs per OAIC NDB scheme
- Response if legitimate: open a postmortem; the route's tenant-derivation logic may be wrong
**Who:** Brodie (with senior-engineer assist) — this is mostly copy
**Estimated time:** 30 min

### OP-09 — Cyber + E&O insurance binding ($2M aggregate)
**Source:** MoU §13 indemnity cap; standard council vendor requirement
**Why required:** The MoU's indemnity clause caps RatesAssist's liability at "fees paid", but the council will typically require evidence of insurance before signing. AU specialist brokers: **BMS Group**, **Honan Insurance**, **Marsh AU**.
**Coverage target:**
- Cyber liability: $2M aggregate, $1M per claim
- Professional indemnity (E&O): $2M aggregate
- Public liability: $5M (standard for any AU vendor)
**Estimated cost:** $1,200-2,500/yr for a single-pilot fintech vertical
**Who:** Brodie
**Estimated time:** 2-3 weeks from quote request to bound policy

---

## 🟡 NICE-TO-HAVE — close in first 90 days

### OP-10 — Planet Labs Education & Research pilot application
**Source:** `outreach/planet-pilot.md`, `internal/IMAGERY-CADENCE-PLAN.md` Tier 2
**Why nice-to-have:** Daily 3 m imagery is the **competitive moat**. Sentinel-2 (~14-day cadence, 10 m) is already shipped — it's enough to win the pilot. Planet daily is the upsell for council #2.
**Steps:**
1. Send the cold email at `outreach/planet-pilot.md` to `apac-sales@planet.com`
2. Apply directly at https://www.planet.com/markets/education-and-research/
3. Negotiate 30-60 day free pilot over Shire of Ashburton AOI (105,000 km²)
4. Target commercial AUD $15-30k/LGA/yr for production
**Who:** Brodie
**When:** post-MoU-signed, weeks 4-8 of the pilot

### OP-11 — Postgres migration sequencing (when migrating from in-memory)
**Source:** `launch/AUDIT-CHAIN-POSTGRES-DESIGN.md`
**Why nice-to-have:** The audit-chain migration is **shipped to main** but the operator must apply it to the production database. Run order:
1. `migrations/0002_audit_chain_columns.sql` (nullable + indexes)
2. Run backfill verifier (built into the senior-engineer's implementation — call `audit-chain-backfill` admin endpoint)
3. `migrations/0003_audit_chain_validate.sql` (NOT NULL + validation)
4. Verify `/api/audit/verify-chain` returns `ok: true`
5. Keep `0004_rollback.sql` un-applied unless aborting
**Who:** Brodie (when Postgres-backed deploy is provisioned)

### OP-12 — Rotation cadence for non-`RA_AUTH_SECRET` secrets
**Source:** Secrets sweep (SEC-105)
**Why nice-to-have:** `scripts/rotate-secret.ts` only handles `RA_AUTH_SECRET`. Add a documented rotation cadence for `RA_SSO_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `ABN_LOOKUP_GUID`, `SENTINEL_HUB_CLIENT_SECRET` (when added), `PLANET_API_KEY` (when added).
**Suggested cadence:** 90 days for auth-grade, 180 days for read-only API keys.
**Who:** Brodie
**Document path:** add a section to `DEPLOY.md`

---

## Summary

- 🔴 **4 BLOCKS-PILOT** items: OP-01, OP-02, OP-03, OP-08. All require Brodie to act before MoU effective date.
- 🟠 **5 REQUIRED-BEFORE-SCALE** items: OP-04 through OP-07, OP-09. Close in the first 30 days of pilot.
- 🟡 **3 NICE-TO-HAVE** items: OP-10, OP-11, OP-12. First 90 days.

**Critical path to MoU signature:** OP-01 (Railway region) → OP-03 (sub-processors doc) → OP-08 (deceased disclosure) → OP-02 (MoU signature).

**Estimated calendar time from green-light to live pilot:** 2-4 weeks (driven by council legal review + insurance binding).
