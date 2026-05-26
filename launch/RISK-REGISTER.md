# Risk Register — RatesAssist Tom Price Pilot

| | |
|---|---|
| **Document** | Pilot Risk Register |
| **Audience** | Council CFO, Manager Rates, Privacy Officer, ICT; RatesAssist operator |
| **Status** | Living document — reviewed weekly during the Term |
| **Owner** | Brodie · `brodie@amalafinance.com.au` |
| **Version** | 1.0 |
| **Last reviewed** | 2026-05-26 |
| **Review cadence** | Weekly during pilot; monthly after pilot conversion |

---

## How to read this register

Each risk is assessed on a Likelihood × Impact scale of 1–5, producing an **Inherent** score (before controls) and a **Residual** score (after controls).

- **Status** values: `UNMITIGATED` (no controls in place — blocks something), `MITIGATING` (controls in build), `MITIGATED` (controls in place, residual accepted), `CLOSED` (no longer applicable).
- **Blocker** values: `BLOCKS-PILOT` means this must move out of UNMITIGATED before the Effective Date; `LOW IMPACT` means it can run during the pilot.
- **Owner** is the single accountable party. Joint ownership is not used.

The register tracks the **top 10** risks for the Term. Risks outside this list are tracked in `PRODUCTION-PLAN.md` and the Privacy Impact Assessment.

---

## Top 10 risks

### R-01 — Cross-tenant data leak

| | |
|---|---|
| **Description** | A bug in tenant scoping causes a Council officer to see candidates, evidence packs or audit log entries belonging to a different council tenant. |
| **Inherent** | 4 × 5 = **20** |
| **Controls in place** | Tenant-scoping iteration 3 closed (May 2026): every database query is `WHERE tenant_id = $1`; row-level security policies on every table; integration tests assert cross-tenant denial; audit log records every read with `tenant_id`. |
| **Outstanding** | External penetration test not yet conducted. |
| **Residual** | 1 × 4 = **4** (LOW) |
| **Status** | **MITIGATED** — external pen-test scheduled for Phase 6 |
| **Blocker** | LOW IMPACT for the single-tenant pilot |
| **Owner** | Brodie |

### R-02 — Railway hosting in US region

| | |
|---|---|
| **Description** | Railway's default deployment region is United States. If Council-supplied data is loaded while the deployment is still pinned to a US region, RatesAssist is in immediate breach of the MoU §5.2 data-residency obligation. |
| **Inherent** | 5 × 5 = **25** |
| **Controls in place** | None at time of writing. The current production deploy is on a US region. |
| **Mitigation plan** | Pin Railway to an Australian region (`asia-southeast1` is not acceptable; only AU-specific regions qualify) **before** the Effective Date. Confirm via Railway region metadata in the deploy log. Provide written confirmation to the Council Privacy Officer. If Railway does not offer an AU region acceptable to the Council, migrate to AWS `ap-southeast-2` per `PRODUCTION-PLAN.md` Phase 6 ahead of schedule. |
| **Residual** | 1 × 5 = **5** (LOW once pinned) |
| **Status** | **UNMITIGATED** |
| **Blocker** | **BLOCKS-PILOT** — no Council data loaded until resolved |
| **Owner** | Brodie |

### R-03 — GitHub Actions billing

| | |
|---|---|
| **Description** | GitHub Actions billing limit hit, blocking CI runs. |
| **Inherent** | 3 × 2 = **6** |
| **Controls in place** | Railway autodeploys on `main` push without requiring GitHub Actions; deployments do not depend on CI passing in the pilot. |
| **Outstanding** | CI hygiene degrades if developers cannot see pre-merge test results. |
| **Residual** | 2 × 2 = **4** (LOW) |
| **Status** | **UNMITIGATED** |
| **Blocker** | LOW IMPACT — pilot can run, but resolve before Phase 4 multi-developer work |
| **Owner** | Brodie |

### R-04 — Council IT refuses to issue SSO accounts

| | |
|---|---|
| **Description** | Council ICT declines or delays provisioning the two SSO accounts required under MoU §7(b), preventing officers from accessing the platform through their own identities. |
| **Inherent** | 3 × 4 = **12** |
| **Controls in place** | The `RA_DEMO_AUTOLOGIN` development autologin escape hatch allows RatesAssist to operate the platform on behalf of the Council during week 1 of the Term. This is disclosed in MoU §7(c) and in the PIA. |
| **Outstanding** | The autologin escape hatch carries its own compliance flag (an authentication-bypass mechanism in production). It is acceptable for the disclosed week-1 window only. |
| **Mitigation plan** | Engage Council ICT before the Effective Date. Provide a written request template specifying group membership, role mapping, and target identity provider (Microsoft Entra). Track issuance status in the weekly status report. Disable `RA_DEMO_AUTOLOGIN` in production by end of week 1 regardless of SSO status; if SSO not provisioned by then, the platform is run by RatesAssist alone against the Council snapshot, with results delivered by email until SSO lands. |
| **Residual** | 2 × 3 = **6** (LOW-MEDIUM) |
| **Status** | **MITIGATING** |
| **Blocker** | LOW IMPACT — pilot runs with degraded officer participation if SSO is delayed |
| **Owner** | Brodie (with Council ICT) |

### R-05 — Pensioner-inference signal challenged

| | |
|---|---|
| **Description** | The Council Privacy Officer, the Office of the Australian Information Commissioner, or a ratepayer challenges the use of inferred pensioner / hardship status as a candidate-suppression signal, on the basis that inference of "sensitive information" without explicit consent breaches APP 3.3. |
| **Inherent** | 3 × 4 = **12** |
| **Controls in place** | Pensioner / hardship status is collected only where the Council supplies it on the rating-roll snapshot (i.e. the Council has already lawfully collected it under its concession-administration function). The platform does not infer pensioner status from indirect signals. Use is documented under APP 6.2(b) — secondary use for a directly related purpose (concession administration and recovery suppression) is permitted under the lawful function of the Council. The PIA records this position at §5. |
| **Outstanding** | Legal opinion confirming the APP 6.2(b) statutory-function carve-out is documented in a defensible form. |
| **Mitigation plan** | Obtain a brief written legal opinion on APP 6.2(b) application before the Effective Date. Gate pensioner-suppression logic behind a tenant flag so it can be disabled instantly on Council direction. |
| **Residual** | 1 × 3 = **3** (LOW) |
| **Status** | **MITIGATED** |
| **Blocker** | LOW IMPACT |
| **Owner** | Brodie |

### R-06 — TechOne rejects partner integration request

| | |
|---|---|
| **Description** | TechOne (the Council's incumbent rating system vendor) declines or delays a partner-integration request, preventing API-based ingestion of the rating roll. |
| **Inherent** | 4 × 3 = **12** |
| **Controls in place** | The pilot is designed to run end-to-end using a **CSV export workflow** — the Council exports the rating roll monthly and uploads it via SFTP or a signed S3-equivalent upload. No TechOne API access is required to prove value during the Term. |
| **Outstanding** | API integration is on the post-pilot roadmap for operational convenience only. |
| **Residual** | 1 × 2 = **2** (LOW) |
| **Status** | **MITIGATED** |
| **Blocker** | LOW IMPACT |
| **Owner** | Brodie |

### R-07 — Imagery costs spike (Planet pilot ends)

| | |
|---|---|
| **Description** | The current Planet Labs pilot programme providing higher-resolution imagery expires or transitions to commercial pricing during the Term, increasing per-property imagery cost and erasing margin on small recoveries. |
| **Inherent** | 3 × 3 = **9** |
| **Controls in place** | The platform ships with **Sentinel-2 14-day cadence** as the primary aerial change-detection feed. Sentinel-2 is free under the Copernicus open-data programme. Planet is treated as a paid uplift signal, not the baseline. Fallback is wired and tested in production. |
| **Outstanding** | None. The fallback is the default. |
| **Residual** | 1 × 2 = **2** (LOW) |
| **Status** | **MITIGATED** |
| **Blocker** | LOW IMPACT |
| **Owner** | Brodie |

### R-08 — Mum's bandwidth

| | |
|---|---|
| **Description** | The pilot operating model relies on a single senior rates expert (the founder's mother) for manual quality-assurance review of edge-case candidates, statutory-cap edge cases, and historical rate-table interpretation. Her bandwidth is finite and not contractually committed. |
| **Inherent** | 4 × 4 = **16** |
| **Controls in place** | None — this is a structural single-point-of-failure. |
| **Mitigation plan** | The structural fix is recruitment of a second senior rates expert post-pilot. For the Term, schedule her review windows weekly and triage candidates by confidence score; anything with confidence ≥ 0.85 bypasses manual QA, anything below is queued. Maintain a written escalation protocol so her time is not interrupted ad-hoc. |
| **Residual** | 3 × 4 = **12** (MEDIUM-HIGH) |
| **Status** | **UNMITIGATED** |
| **Blocker** | LOW IMPACT — pilot runs but quality bar depends on her availability |
| **Owner** | Brodie |

### R-09 — First-recovery delay > 90 days

| | |
|---|---|
| **Description** | The first council-confirmed recovery does not land within the 60-day Term, failing acceptance criterion §3.3 and the headline pilot narrative. |
| **Inherent** | 3 × 5 = **15** |
| **Controls in place** | The acceptance criteria explicitly recognise that recoveries can move slowly through Council finance workflows. The value gate of the Term is **signed evidence packs**, not money in the bank. RatesAssist will deliver 60-day **signed evidence packs** that the Council can pursue at its own pace, demonstrating that the pipeline is real even if cash conversion lags. |
| **Outstanding** | The MoU §4 fee model is structured to be paid quarterly over 24 months precisely because recovery cash flow is slow. |
| **Mitigation plan** | Stage candidates by velocity: prioritise straightforward owner-contact-update and tenement-misclassification candidates in week 1–2 (fast to confirm and bill); deeper subdivision / valuation re-issue candidates in weeks 3–8. Track confirmation lag weekly and escalate stalled candidates to Manager Rates. |
| **Residual** | 2 × 4 = **8** (MEDIUM) |
| **Status** | **MITIGATING** |
| **Blocker** | LOW IMPACT |
| **Owner** | Brodie |

### R-10 — Council Privacy Officer rejects deceased-proprietor signal

| | |
|---|---|
| **Description** | The Council Privacy Officer determines that the deceased-proprietor recovery signal — which flags properties where the registered owner is deceased per probate / Births Deaths and Marriages registries — is inappropriate to use as a collection trigger, on dignity, hardship-vulnerability or APP grounds. |
| **Inherent** | 3 × 3 = **9** |
| **Controls in place** | The deceased-proprietor signal is gated behind an **explicit role** (`role.deceased_signal_enabled`) and an **opt-in tenant flag** (`tenant.signals.deceased_proprietor.enabled`). It is off by default. The Council Privacy Officer must affirmatively enable it before any candidate using this signal is surfaced to a Council officer. Suppression rules layer over the top — hardship-flagged properties never trigger this signal regardless of role. |
| **Outstanding** | Documentation of the Council Privacy Officer's decision (enabled or not) in the pilot status report. |
| **Residual** | 1 × 2 = **2** (LOW) |
| **Status** | **MITIGATED** |
| **Blocker** | LOW IMPACT |
| **Owner** | Brodie (with Council Privacy Officer) |

---

## Summary

| Status | Count |
|---|---|
| UNMITIGATED — BLOCKS-PILOT | 1 (R-02) |
| UNMITIGATED — LOW IMPACT | 2 (R-03, R-08) |
| MITIGATING | 2 (R-04, R-09) |
| MITIGATED | 5 (R-01, R-05, R-06, R-07, R-10) |

**Single blocker before the Effective Date: R-02 — Railway region pinning to Australia.** Resolution of R-02 is the precondition for loading Council-supplied data.

---

## Review log

| Date | Reviewer | Notes |
|---|---|---|
| 2026-05-26 | Brodie | Initial draft. R-02 outstanding as the sole pilot blocker. |

---

*Document owner: Brodie · `brodie@amalafinance.com.au` · Version 1.0 · Last reviewed 2026-05-26. Next review weekly during the Term.*
