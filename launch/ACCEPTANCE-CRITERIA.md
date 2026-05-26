# Pilot Acceptance Criteria — Tom Price / Shire of Ashburton

| | |
|---|---|
| **Document** | Pilot Acceptance Criteria |
| **Audience** | Shire of Ashburton CFO, Manager Rates, Privacy Officer; RatesAssist operator |
| **Status** | Draft — to be agreed in writing before pilot start |
| **Owner** | Brodie · `brodie@amalafinance.com.au` |
| **Version** | 1.0 |
| **Last reviewed** | 2026-05-26 |

---

## 1. Purpose

This document defines the **binary, quantitative tests** the Shire of Ashburton will apply to determine whether the 60-day RatesAssist pilot has succeeded.

Each criterion is either met or not met. There are no partial credits and no subjective evaluation. The pilot is judged a success if **every** criterion in §3 is met by the end of the Term, and is judged a failure if **any** criterion is not met.

The Council retains the right to extend the Term once in writing if a criterion is on track but not yet met at the end of week 8.

---

## 2. Measurement protocol

| Element | Detail |
|---|---|
| **Term** | 60 days from the Effective Date of the MoU |
| **Source of truth** | RatesAssist platform audit log + Council finance team confirmation records |
| **Measurement cadence** | Weekly status report; final assessment in the 60-day exit review |
| **Sign-off authority** | Manager Rates and CFO (Council); Brodie (RatesAssist) |
| **Dispute resolution** | Per §4.6 of the MoU, with escalation to the CEO if unresolved |

---

## 3. Success criteria

### 3.1 Recovery candidates surfaced — week 1

> **At least 50 distinct recovery candidates** are surfaced through the RatesAssist platform within the first **7 calendar days** of the Term.

- **Measurement:** count of unique property identifiers entered into the `recovery_candidates` table during the first 7 days, filtered to candidates with at least one fired signal and a generated evidence pack.
- **Why this matters:** establishes that the platform can mine value from the snapshot at the volume needed to occupy a senior rates officer's attention.

### 3.2 Council-confirmed legitimate recovery opportunities

> **At least 10 of the surfaced candidates** are confirmed by the Council finance team, in writing, as **legitimate recovery opportunities** worth pursuing.

- **Measurement:** count of candidates with status `confirmed` set by a Council officer of grade Senior Rates Officer or above within the Term.
- **Why this matters:** establishes platform precision. A platform that produces 50 candidates and zero confirms is a noise machine; a platform that converts 1-in-5 is operating at audit-grade.

### 3.3 First council-confirmed recovery

> **At least one (1) Recovery Candidate** results in an actual recovery — money received by the Council into its consolidated rates account — within the **60-day Term**.

- **Measurement:** the Council finance team records the first confirmed Recovered Rates amount in the quarterly Recovered Rates report under §4.4(a) of the MoU, attributable to a candidate surfaced through the platform.
- **Why this matters:** this is the value gate. Pipeline without conversion is theatre.

### 3.4 Zero data-handling incidents

> **Zero** notifiable data breaches, suspected unauthorised access events, or breaches of the MoU §5 (Data handling) obligations during the Term.

- **Measurement:** Council Privacy Officer records and RatesAssist incident-response runbook records, cross-referenced at exit review.
- **Why this matters:** a single breach voids the pilot regardless of recovery performance. This is non-negotiable.

### 3.5 Officer NPS ≥ 7/10 after week 4

> **Average Net Promoter Score of 7 or higher** (on a 0–10 scale) from the two designated Council officers, surveyed at the end of **week 4**.

- **Measurement:** standard NPS question ("On a scale of 0 to 10, how likely are you to recommend RatesAssist to a peer council?") administered by the RatesAssist operator and recorded with timestamp and officer name.
- **Why this matters:** technical success without operator buy-in does not convert to a long-term engagement. If the officers find the platform painful at week 4, no recovery number recovers the deal.

### 3.6 Statutory rate certificate generated

> **At least one (1) statutory rate certificate** is generated through the RatesAssist platform during the Term, accepted by the Council as fit for issue, and entered into the Council's rates correspondence record.

- **Measurement:** an audit-log entry of `rate_certificate.generated` status `accepted`, with a Council officer's signed acknowledgement of fit-for-issue.
- **Why this matters:** demonstrates the platform produces statutory-grade output, not just analytical reports.

---

## 4. Failure modes

The pilot is deemed a **failure** if any of the following is true at the 60-day exit review:

- Fewer than 50 candidates surfaced in week 1 **and** the cause is platform incapacity rather than data-availability delay.
- Fewer than 10 council-confirmed candidates over the Term.
- Zero recoveries over the Term **and** the Council finance team's recovery pipeline shows no recovery in flight attributable to the platform.
- Any data-handling incident notifiable under the Notifiable Data Breaches scheme.
- Officer NPS below 7/10 at week 4 and not improved by exit review.
- No statutory rate certificate generated and accepted by the end of the Term.

---

## 5. On success

On meeting every criterion in §3, the Parties will negotiate in good faith a 12-month commercial engagement on terms consistent with the MoU success-fee model.

## 6. On failure

On failing one or more criteria in §3, the Term terminates per MoU §10.1, RatesAssist deletes Council-supplied data per MoU §5.5, and either Party may publish a de-identified post-mortem.

---

## 7. Exit review

A joint exit review meeting will be held in the final week of the Term, attended by the Council CFO, Manager Rates, Privacy Officer, and RatesAssist. The exit review records each criterion's status, signs off the success / failure determination, and either initiates §5 or §6.

---

| Sign-off | Name | Date | Signature |
|---|---|---|---|
| Council CFO | _____________________ | _____________________ | _____________________ |
| Manager Rates | _____________________ | _____________________ | _____________________ |
| RatesAssist | Brodie | _____________________ | _____________________ |

---

*Document owner: Brodie · `brodie@amalafinance.com.au` · Version 1.0 · Last reviewed 2026-05-26.*
