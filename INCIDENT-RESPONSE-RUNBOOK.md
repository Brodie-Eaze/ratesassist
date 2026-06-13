# RatesAssist — Incident Response Runbook

| | |
|---|---|
| **Document** | Incident response runbook |
| **Audience** | Founder (incident commander); council ICT and privacy officers as escalation contacts |
| **Status** | Pre-pilot. Living document. |
| **Owner** | Brodie · `security@ratesassist.com.au` |
| **Version** | 1.0 |
| **Last reviewed** | 2026-05-08 |
| **Review cycle** | Quarterly tabletop, annual full review |

---

## 1. Scope

This runbook covers any event that may compromise the **confidentiality**, **integrity**, or **availability** of RatesAssist or council-supplied data, including but not limited to:

- Unauthorised access to RatesAssist or any sub-processor's storage.
- Unauthorised disclosure of personal information.
- Loss or corruption of council operational data.
- Service outage longer than the SLA window in `SLA.md`.
- LLM behaviour that produces unauthorised disclosure or fabricated facts surfaced to a clerk.
- Compromise of the founder's administrative credentials.
- Sub-processor incident notified to RatesAssist.

---

## 2. Severity definitions

| Severity | Description | Examples | Initial response time |
|---|---|---|---|
| **P1 — Critical** | Confirmed unauthorised disclosure of personal information; total service outage; suspected breach affecting >100 records or any PROTECTED-class data. | Confirmed credential compromise + active exfil; database leak; ransomware; PROTECTED data leak. | Immediate (within 1 hour) |
| **P2 — High** | Suspected disclosure or significant outage; partial loss of data; sub-processor breach with potential exposure. | Anthropic incident with possible payload exposure; Vercel storage misconfiguration; OFFICIAL:Sensitive data sent to wrong council. | Within 4 hours |
| **P3 — Medium** | Localised functional incident; non-personal-information impact; near-miss with controls. | Outage of a single non-critical feature; failed audit-log write; degraded performance below SLA. | Within 1 business day |
| **P4 — Low** | Minor defect, documentation issue, or procedural observation. | Stale sub-processor entry; small UI bug; misspelt notification template. | Within 5 business days |

NDB Scheme assessment (see §5) is triggered for any P1 or P2 that involves personal information.

---

## 3. Roles

For the pilot, RatesAssist operates with a single founder. This is explicitly disclosed and the runbook is built around it.

| Role | Pilot occupant | Backup | Responsibilities |
|---|---|---|---|
| **Incident Commander (IC)** | Brodie | Primary escalation contact (see `ON-CALL.md`) | Owns the incident end-to-end; declares severity; calls cut-overs and notifications; chairs the post-incident review. |
| **Communications Lead** | Brodie | Primary escalation contact | Owns council, ratepayer and regulator messaging; sole point of public statement. |
| **Tech Lead** | Brodie | _Pending — Phase 4 hire_ | Diagnoses, contains and remediates; preserves forensic evidence. |
| **Privacy Lead** | Brodie | External privacy counsel (engaged before pilot go-live) | Assesses NDB-eligibility and runs OAIC notification. |
| **Council Liaison** | Per pilot council | Council privacy officer | Council-side counterpart; receives notifications under §6. |

A second on-call is **planned (Phase 4)**. Until then, the founder is sole on-call and the escalation contact in `ON-CALL.md` is the failover for unavailability (illness, travel) — not for technical depth.

---

## 4. Triage flow

```
detect ──► assess ──► declare ──► contain ──► eradicate ──► recover ──► review
   │          │           │          │            │              │           │
   │          │           │          │            │              │           └─ PIR (§7)
   │          │           │          │            │              └─ confirm SLA restored
   │          │           │          │            └─ patch / rotate creds / restore from backup
   │          │           │          └─ revoke tokens, isolate hosts, freeze writes
   │          │           └─ severity P1–P4 + start the NDB clock if applicable
   │          └─ scope, data classes, parties, sub-processors involved
   └─ alert, user report, sub-processor notification, log anomaly, audit finding
```

### 4.1 Detect

Sources include: Vercel/Cloudflare alerts, application logs, Anthropic / sub-processor notifications, council reports, ratepayer reports, security@ inbox, and self-discovery.

### 4.2 Assess and declare (within the response time in §2)

The IC documents in the incident channel:

- One-line description and timeline so far.
- Affected data classes (cross-reference `DATA-CLASSIFICATION-MATRIX.md`).
- Affected councils.
- Severity (with rationale).
- Whether the NDB clock is started.

### 4.3 Contain

Standard containment actions: revoke tokens, rotate credentials, isolate the affected component, freeze writes, take a forensic snapshot before any destructive action.

### 4.4 Eradicate, recover

Patch, rotate, restore from a clean backup (subject to §6 forensic preservation), confirm SLA restored, confirm controls hold under stress.

For the **tamper-evident audit chain** specifically, follow the drilled
restore-and-verify procedure in `internal/DR-RESTORE-DRILL-2026-05-29.md` §5:
restore the snapshot/PITR, then run `/api/audit/verify-chain` for **every**
active tenant and confirm `ok:true` before declaring the audit store
recovered. A genuine post-restore chain break is itself a SEV1 — do not resume
writes on that tenant. RPO/RTO targets and the verification gate are in that
doc and in `internal/SLO-SLI.md` §4.

### 4.5 Review

See §7.

---

## 5. NDB Scheme — 30-day notification process

Under Part IIIC of the *Privacy Act 1988 (Cth)*, an **eligible data breach** is unauthorised access, disclosure or loss of personal information that is likely to result in serious harm and that has not been remediated.

**Internal target: complete the assessment within 72 hours.**
**Statutory maximum: notify the OAIC and affected individuals within 30 days of becoming aware.**

### 5.1 Assessment (within 72 hours)

The Privacy Lead documents:

1. **What happened?** Specific facts; data classes; volumes; sub-processors.
2. **Whose information?** Council(s) affected; categories of individuals.
3. **Likelihood of serious harm?** Considering sensitivity, volume, identifiability, recipient, mitigations applied.
4. **Was it remediated before harm?** If yes, document the remediation and the basis for the conclusion. If no, the breach is eligible.

### 5.2 Notify (no later than 30 days from awareness)

If eligible:

1. **Council privacy officer** — within 24 hours of assessment.
2. **OAIC** — using the OAIC online notification form (template in §9.1).
3. **Affected individuals** — directly where practicable, otherwise via a public statement on the council's website (template in §9.2).
4. **Other regulators** — as required (e.g. state privacy commissioners; sectoral regulators).

### 5.3 Records

The full assessment, decision and notification are retained for 7 years per `DATA-RETENTION-POLICY.md` §3 (Incident response artefacts).

---

## 6. Forensics and preservation

- Take an **immediate forensic snapshot** of affected systems (logs, storage, configuration) before any destructive remediation.
- Use a separate, write-protected store (S3 Object Lock or platform equivalent — planned Phase 6; pilot uses time-stamped local archive with hash manifest).
- Maintain a **chain-of-custody log** for every artefact: who took it, when, hash, where it lives.
- Engage external forensic counsel for any P1 involving PROTECTED data or suspected criminal activity, **before** any remediation that could overwrite evidence.

---

## 7. Post-incident review (PIR)

A PIR is mandatory for every P1 and P2, and recommended for P3.

**Cadence:** within 10 business days of recovery.

**PIR template:**

1. **Incident summary** (one paragraph).
2. **Timeline** (detect → declare → contain → recover, with timestamps).
3. **Impact** (data classes, individuals, councils, downtime).
4. **Root cause** (the technical chain — five-whys to the underlying system condition).
5. **Contributing factors** (process, tooling, on-call, communication).
6. **What went well.**
7. **What did not.**
8. **Action items** (each with an owner and a due date; tracked in `internal/SECURITY-FOLLOWUPS.md`).
9. **Did the runbook hold?** (specific suggested edits to this document).
10. **Council debrief** — every affected council receives a written PIR.

PIRs are **blameless** within the team and **factual** towards regulators.

---

## 8. Communication channels

- **Internal incident channel:** dedicated Signal thread (founder + escalation contact).
- **Council notification:** primary email + phone confirmation; never SMS-only for P1/P2.
- **Public statement (if any):** issued only by the Communications Lead.
- **Status page:** planned Phase 4. Until then, council primary contacts are notified directly.

---

## 9. Communication templates

### 9.1 OAIC notification (P1/P2 eligible breach)

> **Subject:** Notifiable data breach — RatesAssist — [date]
>
> RatesAssist is providing this notification under Part IIIC of the *Privacy Act 1988 (Cth)*. We became aware of an eligible data breach on [date / time AWST]. The affected information is [classes / volumes]. Affected individuals are [categories]. The likely harm is [description]. The mitigations applied are [list]. The full assessment and timeline are attached. Our point of contact is [name / role / email / phone].

### 9.2 Affected-individual notice (via council)

> Dear [name], on [date] RatesAssist, a service used by [Council] for rates audit and recovery, identified an incident affecting your personal information. The affected information was [list]. We have taken the following steps: [list]. We recommend the following: [list]. If you have questions, please contact [Council privacy officer contact]. [Council] and RatesAssist have notified the Office of the Australian Information Commissioner.

### 9.3 Council early-warning (P1/P2 — within 4 hours of declaration)

> Dear [Council privacy officer], we are notifying [Council] of an active incident at RatesAssist declared at [time AWST] on [date], severity [P1/P2]. Initial scope is [scope]. Containment status is [status]. Our next update is at [time]. Our incident commander is [name / contact]. This notification is provided in advance of the formal NDB Scheme assessment, which will follow within 72 hours.

### 9.4 Regulator (sectoral, as applicable)

> Drafted in consultation with external privacy counsel before issue.

---

## 10. Escalation contacts

See `ON-CALL.md`. Council-side contacts are maintained per pilot in the council pilot agreement, not in this public document.

---

*Last reviewed: 2026-05-08 · Next review: 2026-08-08 · Review cycle: quarterly tabletop + annual full review.*
