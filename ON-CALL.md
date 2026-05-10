# RatesAssist — On-call

| | |
|---|---|
| **Document** | On-call policy |
| **Audience** | Council ICT, audit, founder |
| **Status** | Pre-pilot. Living document. |
| **Owner** | Brodie · `oncall@ratesassist.com.au` |
| **Version** | 1.0 |
| **Last reviewed** | 2026-05-08 |
| **Review cycle** | Quarterly |

---

## 1. Reality of the pilot

RatesAssist is, at the date of this document, a **single-founder business**. There is no rotation. The founder is the sole on-call engineer for the duration of the pilot.

This is disclosed to every council during scoping. It is the most material operational caveat in the entire compliance suite, and we will not paper over it. The roadmap to a multi-person on-call rotation is in `PRODUCTION-PLAN.md` Phase 4 onwards.

---

## 2. Roster

| Role | Primary | Backup | Notes |
|---|---|---|---|
| **On-call engineer** | Brodie | _Backup contact_ — see §3 | Sole rotation |
| **Incident Commander** | Brodie | Backup contact | Per `INCIDENT-RESPONSE-RUNBOOK.md` |
| **Comms Lead** | Brodie | Backup contact | Per runbook |
| **Privacy Lead** | Brodie | External privacy counsel (engaged before pilot go-live) | Per runbook |

---

## 3. Backup contact

The backup contact is the founder's mother, Robyn, who has direct rates-domain expertise from a long career in WA local government rates and recovery. She is the **operational** failover when the founder is unreachable (illness, travel, force majeure). She is **not** a technical failover — she does not deploy code, rotate credentials, or run database queries. Her role is:

- Triage incoming P1/P2 council calls.
- Confirm receipt of council notifications and acknowledge timelines.
- Page the founder via every available channel.
- If the founder is genuinely unreachable, page external privacy counsel for any P1 with a started NDB clock.

The backup contact is briefed quarterly on this runbook and on each new pilot council's primary contacts.

Specific contact details for the backup contact and external counsel are held in the council pilot agreement, not in this public document.

---

## 4. Pager hours

| Window | Cover | Channel |
|---|---|---|
| **AWST 09:00–21:00, every day** | Best-effort live response by the founder | Phone, Signal, email |
| **Outside the above window** | Email-only until next morning, except for confirmed P1 alerts which page Signal + phone | Signal escalation, then phone |

24/7 cover is **planned (Phase 6)** alongside production hardening and any council requirement for it. We will not represent 24/7 cover before it exists.

---

## 5. SLA matrix

The full SLA, including availability, latency targets, maintenance windows and exclusions, is in `SLA.md`. The on-call response component summarised here is:

| Severity | Acknowledgement target | Channel |
|---|---|---|
| **P1** | 1 hour, any time | Phone |
| **P2** | 4 hours, within pager hours | Phone or Signal |
| **P3** | 1 business day | Email |
| **P4** | 5 business days | Email |

"Acknowledgement" means the founder has received the alert, opened an incident channel, and posted a first assessment. It does not mean the issue is fixed.

---

## 6. Contact methods

Council customers have three documented channels, in this order of preference for an active incident:

1. **Phone** — number provided in the pilot agreement. Goes to the founder; if unanswered for 5 minutes, the call rolls to the backup contact.
2. **Signal** — the founder's Signal handle is provided in the pilot agreement. Preferred for P1/P2 because it produces a persistent, end-to-end-encrypted thread.
3. **Email** — `oncall@ratesassist.com.au` (acknowledged within pager hours; for P3/P4).

A status page is **planned (Phase 4)**. Until then, council primary contacts are notified directly.

---

## 7. When the founder is unavailable

Planned unavailability (e.g. travel, leave) is communicated to all pilot council primary contacts at least 5 business days in advance, with the cover plan and the backup contact's availability explicitly stated. During such windows:

- The pager goes to the backup contact (operational triage only).
- For technical depth, an external on-call engineer may be engaged on a per-incident basis. Engagement is at the founder's cost.
- If the founder cannot be reached and a P1 incident is declared, external privacy counsel is paged for any NDB-clock decisions.

Unplanned unavailability (illness, force majeure) is handled by the same path; the council is notified as soon as practicable.

---

## 8. Review

This policy is reviewed quarterly. It is replaced when RatesAssist hires a second on-call engineer (Phase 4 trigger). At that point a rotation, an escalation chain and a paging tool replace the founder-as-pager arrangement above.

---

*Last reviewed: 2026-05-08 · Next review: 2026-08-08 · Review cycle: quarterly.*
