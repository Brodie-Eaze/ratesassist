# RatesAssist — Data Retention Policy

| | |
|---|---|
| **Document** | Data retention policy |
| **Audience** | Council records officers, privacy officers, ICT, audit |
| **Status** | Pre-pilot. Living document. |
| **Owner** | Brodie · `privacy@ratesassist.com.au` |
| **Version** | 1.0 |
| **Last reviewed** | 2026-05-08 |
| **Review cycle** | Annual, or on change to applicable records legislation |

---

## 1. Purpose

This policy defines how long RatesAssist retains each class of data, on what legal basis, and how that data is securely disposed of when its retention period expires. It supports each council customer's obligations under:

- The *State Records Act 2000 (WA)* (and equivalents in other states — e.g. *State Records Act 1998 (NSW)*, *Public Records Act 1973 (Vic)*, *Public Records Act 2002 (Qld)*).
- General Disposal Authority for Local Government in WA (and equivalent state schedules).
- The *Privacy Act 1988 (Cth)* APP 11.2 obligation to destroy or de-identify personal information that is no longer needed for the purpose for which it was collected.
- The *Notifiable Data Breaches (NDB) Scheme* under Part IIIC of the *Privacy Act 1988 (Cth)*.

---

## 2. Definitions

- **Council operational data** — rates extracts, owner records, mismatch candidates, evidence packs, and any other information supplied by or derived from a council.
- **Audit log entry** — a structured event capturing user identity, action, parameters, timestamp and result hash for any read or write against council operational data.
- **LLM chat transcript** — the captured prompt, tool-call sequence, and assistant reply for a clerk's session.
- **Backup** — a point-in-time copy of council operational data held for disaster recovery.
- **Active owner data** — owner contact records that the council is still using to contact ratepayers.

---

## 3. Per-class retention schedule

| Data class | Retention period | Legal / operational basis |
|---|---|---|
| Audit logs | **7 years** from event date | *State Records Act 2000 (WA)* and council record-keeping plans; ACSC ISM minimum for security event records |
| Mismatch candidates and evidence packs | **7 years** from creation | Council record-keeping plans; supports later audit of council decisions |
| Owner contact records (active) | **Indefinite** while council remains the data controller and the owner remains active on the council's roll | Primary purpose under *Local Government Act 1995 (WA)* |
| Owner contact records (archived after owner becomes inactive) | **7 years** post-archive | State records minimums |
| LLM chat transcripts (operational) | **90 days** | Operational debugging and incident reconstruction; minimum necessary under APP 11.2 |
| LLM chat transcripts (training corpus) | **1 year, opt-in only — opt-out by default** | Used solely with explicit council opt-in for our own evaluation harness; never disclosed to Anthropic for training |
| Backups (point-in-time recovery) | **35 days** rolling PITR | Disaster recovery |
| Backups (monthly snapshots) | **12 months** | Disaster recovery and longer-term restoration |
| Sub-processor change records | **7 years** | Audit and council notification history |
| Incident response artefacts | **7 years** | NDB Scheme record-keeping; supports post-incident review |
| Source code, configuration, infrastructure-as-code | Indefinite while the project is active | Operational |
| Marketing / sales contacts (council staff who enquired) | Until requested deletion or 3 years of inactivity | APP 5 / APP 11 |

Where a council's own retention schedule mandates a **longer** period for a class of data, the council's schedule prevails for that council's data.

---

## 4. Deletion process

### 4.1 Routine deletion

Routine deletion runs against retention thresholds:

1. A scheduled job (planned Phase 2) identifies records whose retention period has expired.
2. Records are deleted from primary storage (logical delete with tombstone) and removed from indices.
3. Tombstones are physically purged on the next backup cycle.
4. The deletion event is itself written to the audit log (deletion audit entries are exempt from routine deletion).

Until the Phase 2 implementation, routine deletion is performed manually by the founder against the schedule above, and recorded in `internal/SECURITY-FOLLOWUPS.md`.

### 4.2 Council request — return or deletion on offboarding

On offboarding, within 30 days, RatesAssist will either:

- **Return** all council operational data in a documented export format; or
- **Securely delete** all council operational data (and certify the deletion in writing).

Audit log entries pertaining to that council are retained for the legal minimum (7 years) and then deleted — they are not returned, because they may include actions by other parties.

### 4.3 Ratepayer request — right to be forgotten / correction

The council remains the data controller. Where a ratepayer exercises a right of access, correction or erasure under APP 12 / 13 (or equivalent state law):

1. The request is routed via the council privacy officer.
2. RatesAssist actions the request within **5 business days of council direction**.
3. Where erasure conflicts with retention obligations (e.g. an in-flight rates dispute), RatesAssist documents the conflict and defers to the council's lawful direction.

### 4.4 Verification

Before any deletion, RatesAssist verifies:

- The request originator is the council privacy officer or their delegate (verified out-of-band).
- The scope of the request (which records, which date range, which council).
- That no statutory hold applies (e.g. an active OAIC investigation, an active SAT or other tribunal matter).

A signed deletion attestation is issued to the council on completion.

---

## 5. Secure disposal

- **Live storage:** logical delete + index removal + physical purge on next backup cycle.
- **Backups:** expire automatically per §3; encrypted backups are not separately wiped — key destruction is sufficient where customer-managed keys are used (planned Phase 6).
- **Local development copies:** prohibited for any data class above OFFICIAL. Where any local copy of OFFICIAL data exists for debugging, it is held on encrypted storage and deleted within 7 days.
- **Printouts and exports:** not generated routinely. Any export issued to a council must be deleted from RatesAssist's side within 30 days of confirmed receipt.

---

## 6. NDB Scheme integration

If a retention failure (e.g. data retained past its scheduled period and subsequently exposed) results in an eligible data breach, the *Notifiable Data Breaches Scheme* notification process in `INCIDENT-RESPONSE-RUNBOOK.md` is followed:

- 72-hour internal target for assessment.
- 30-day statutory maximum for OAIC notification.
- Council privacy officer is notified in parallel.

Failure to delete on schedule is a privacy event in its own right and is logged and reviewed at the next quarterly review even if it does not constitute an eligible data breach.

---

## 7. Exceptions and holds

A retention exception (legal hold, regulatory hold, in-flight tribunal matter) suspends routine deletion for the affected records. Holds are:

- Recorded in writing.
- Reviewed quarterly.
- Released in writing by the privacy owner once the underlying matter concludes.

---

## 8. Review

This policy is reviewed annually, and on any change to applicable records legislation, council record-keeping plans, or sub-processor arrangements that affect retention.

---

*Last reviewed: 2026-05-08 · Next review: 2027-05-08 · Review cycle: annual.*
