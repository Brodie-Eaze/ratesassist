# RatesAssist — Privacy Impact Assessment (PIA)

| | |
|---|---|
| **Document** | Privacy Impact Assessment |
| **Audience** | Council privacy officers, OAIC, council ICT, procurement |
| **Status** | Pre-pilot. Living document. |
| **Owner** | Brodie · `privacy@ratesassist.com.au` |
| **Version** | 1.0 |
| **Last reviewed** | 2026-05-08 |
| **Review cycle** | Annual, or on material change to information flows, sub-processors, or jurisdictional scope |

---

## 1. Purpose of this assessment

This Privacy Impact Assessment (PIA) is provided under the Australian *Privacy Act 1988 (Cth)* and the Australian Privacy Principles (APPs). It is intended to satisfy the standard PIA expectations of Australian local government procurement, including but not limited to:

- The Office of the Australian Information Commissioner (OAIC) *Guide to undertaking privacy impact assessments*.
- The relevant state-level public-sector privacy regimes (notably the Western Australian *Information Privacy Bill* / current administrative practice; the NSW *Privacy and Personal Information Protection Act 1998*; the Victorian *Privacy and Data Protection Act 2014*; the Queensland *Information Privacy Act 2009*).
- Council-specific Information Privacy Policies adopted under the *Local Government Act 1995 (WA)* (and equivalents in other states).

It applies to the RatesAssist pilot. A new PIA will be issued for any subsequent material change.

---

## 2. Description of the system

RatesAssist is a council rates audit and recovery platform. It:

- Ingests **public** datasets relating to land tenure, mining tenements, business registration and grants — primarily DMIRS, Landgate / SLIP, the Australian Business Register (ABR), and Commonwealth and state grant feeds.
- Joins those datasets against **council-supplied** rates, ownership and contact records.
- Runs deterministic and machine-learning anomaly detection to surface **mismatch candidates** — properties where rateable interest, ownership, valuation or contact information appears to be out of date.
- Surfaces those candidates to a council clerk through an LLM-narrated chat interface, with **every** factual claim grounded in a tool call and citation.
- Generates an **evidence pack** for each candidate that the clerk reviews, approves, and, if appropriate, escalates to a council action (rate notice reissue, owner contact update, recovery, write-off review).

The model never originates facts about properties, owners or balances. It narrates results from a strictly allowlisted toolset.

The pilot scope is one Western Australian local government area, served by the founder as a single operator. Multi-tenant, multi-officer operation is a Phase 4+ concern.

---

## 3. Information flows

```
DMIRS (public)            ┐
Landgate / SLIP (public)  │   adapter   anomaly engine   evidence pack    council
ABR (public)              │ ───────────► (deterministic +  ───────────► clerk
Grants feeds (public)     │              ML scoring)      LLM narration   review &
Council rates extract     ┘                                                action
(supplied by council)
```

**Step by step:**

1. **Ingest.** Public datasets are pulled via published APIs and bulk endpoints. Council rates extracts are supplied by the council under a written data-handling agreement and ingested via SFTP or signed S3-equivalent upload.
2. **Adapter normalisation.** Each source is normalised into the RatesAssist domain model (Council, Property, Owner, Tenement, Transaction, AuditLog).
3. **Match & score.** Deterministic rules and supervised ML score each candidate. No personal information leaves the AU-region service boundary at this stage.
4. **Narration.** The clerk asks questions. The Claude API receives a redacted payload — see §6 for the cross-border disclosure.
5. **Evidence pack.** The clerk reviews the pack and either approves an action, requests more information, or rejects the candidate.
6. **Council action.** Any outbound action (a notice, a contact-update letter, a recovery referral) is **always** taken by the council under their own statutory authority. RatesAssist is a decision-support system; it is not an actor.
7. **Audit.** Every read and write is captured for retention per the *State Records Act 2000 (WA)* and council-specific record-keeping plans.

---

## 4. Personal information collected

We map every collected field against APP 3 (collection of solicited personal information).

| Field | Class (per `DATA-CLASSIFICATION-MATRIX.md`) | Source | Lawful basis (primary purpose) |
|---|---|---|---|
| Owner full name | OFFICIAL:Sensitive | Council rates extract | Rates assessment, *Local Government Act 1995 (WA)* s.6.41 et seq. |
| Owner postal address | OFFICIAL:Sensitive | Council rates extract / Landgate | Service of rate notices |
| Owner email | OFFICIAL:Sensitive | Council rates extract | Statutory communication |
| Owner phone | OFFICIAL:Sensitive | Council rates extract | Statutory communication |
| Property address | OFFICIAL | Landgate / SLIP / council | Identification of rateable land |
| Lot/plan, certificate of title | OFFICIAL | Landgate / SLIP | Identification of rateable land |
| Rateable value | OFFICIAL | Council / Landgate VG | Rates assessment |
| Outstanding balance | OFFICIAL:Sensitive | Council rates extract | Recovery decision support |
| Pensioner / hardship status | PROTECTED | Council rates extract (where supplied) | Concession administration |
| Mining tenement holder details | PUBLIC / OFFICIAL | DMIRS public register | Statutory register, public |
| ABN / ACN, business name | PUBLIC | ABR | Public register |
| LLM chat transcripts | OFFICIAL:Sensitive | Internal | Operational monitoring |
| Audit log entries | OFFICIAL:Sensitive | Internal | Records compliance |

We do **not** collect:

- Tax File Numbers, Medicare numbers, drivers licence numbers, passport numbers.
- Bank account numbers (in the pilot — collection is deferred until Phase 3 with tokenisation).
- Health information, racial or ethnic origin, religious or political affiliation, sexual orientation, biometric or genetic information, or any other "sensitive information" as defined in s.6 of the *Privacy Act 1988 (Cth)* — except pensioner / hardship status where supplied as part of the council extract.

---

## 5. Lawful basis

- **APP 3 (Collection of solicited personal information).** Personal information is collected for the **primary purpose** of supporting a council's lawful exercise of its rates assessment, levying, recovery and concession-administration functions under the *Local Government Act 1995 (WA)* (and its state equivalents). This is reasonably necessary for the council's functions.
- **APP 5 (Notification of collection).** Council ratepayers are notified of collection through the council's own privacy collection notice, updated to include "third-party decision-support providers, including RatesAssist". Sample wording is provided to councils during onboarding.
- **APP 6 (Use or disclosure).** Information is used only for the primary purpose. Secondary uses (e.g. analytics, model improvement) are out of scope and prohibited contractually. We do not use council-supplied data to train any model.
- **APP 8 (Cross-border disclosure).** See §6.
- **APP 11 (Security).** See `SECURITY.md` and `DATA-CLASSIFICATION-MATRIX.md`.
- **APP 12 / 13 (Access and correction).** Requests are routed to the council as the data controller; RatesAssist will assist within 5 business days of council direction.

---

## 6. Disclosure to third parties

The complete current list of third parties that may process personal information is maintained in `SUB-PROCESSORS.md`. Privacy-material disclosures:

- **Anthropic, PBC (United States).** LLM inference. We send a payload that includes the council clerk's natural-language prompt, the tool-call results retrieved within the conversation, and the role-redacted personal information necessary to answer the prompt. Anthropic does not train on API content per their published policy. The current Anthropic data residency offering may route inference to the United States; this is the **single most material privacy disclosure** in this PIA. It is treated under APP 8 as a cross-border disclosure. We disclose this to councils during scoping. Mitigations:
  - Tool-grounded only — the model never originates facts.
  - Field-level redaction before payload assembly (Phase 3 hardening; pilot uses public-data-only prompts where feasible).
  - Pinned AU-region inference will be adopted as soon as Anthropic offers it under a contract acceptable to council procurement.
- **Vercel, Inc. (United States; Sydney edge region for execution).** Hosting. Edge functions execute in `syd1`. Traffic is TLS-terminated at the edge. Static assets are served from a global CDN.
- **Cloudflare (US/global).** CDN and WAF for non-PROTECTED traffic only.
- **GitHub (United States).** Source-code hosting. No production personal data is stored in source control.

We do **not** disclose council-supplied personal information to advertising networks, data brokers, or any party not listed in `SUB-PROCESSORS.md`.

---

## 7. Retention

See `DATA-RETENTION-POLICY.md` for the canonical, per-class retention schedule. In summary:

- Council-supplied operational data is retained for the term of engagement plus 30 days.
- Audit logs are retained for 7 years to satisfy the *State Records Act 2000 (WA)* and council record-keeping plans (planned implementation Phase 2).
- LLM chat transcripts are retained for 90 days operationally.

---

## 8. Risks identified

Each risk is rated as **inherent** (before controls) and **residual** (after controls). Likelihood × Impact, scale 1–5.

| ID | Risk | Inherent | Controls | Residual |
|---|---|---|---|---|
| P-01 | Cross-border disclosure to Anthropic results in foreign-government compelled access to council data. | 3 × 4 = 12 | APP 8 disclosure, tool-grounded narration, redaction pipeline (Phase 3), short prompt windows. | 2 × 3 = 6 |
| P-02 | LLM hallucinates personal information (e.g. fabricates an owner). | 4 × 4 = 16 | Tool-grounded only, citation required, deterministic scoring, council clerk human-in-the-loop. | 1 × 4 = 4 |
| P-03 | Mismatch candidate is acted on without clerk review (auto-action). | 4 × 5 = 20 | RatesAssist takes no outbound council action; the clerk acts under council authority. | 1 × 4 = 4 |
| P-04 | Pensioner / hardship status leaks beyond authorised role. | 3 × 5 = 15 | PROTECTED classification, field-level encryption (planned Phase 3), role-based redaction (planned Phase 4). | 2 × 4 = 8 |
| P-05 | Council ratepayer not notified of new processor (RatesAssist) on the council's privacy collection notice. | 4 × 3 = 12 | Onboarding checklist provides sample notice wording; signed by council. | 2 × 2 = 4 |
| P-06 | Audit log fails to support a regulator's reconstruction request. | 3 × 5 = 15 | Phase 2 immutable Postgres audit log with 7-year retention; documented in `SECURITY.md`. | 2 × 3 = 6 |
| P-07 | Sub-processor changed without council awareness. | 3 × 3 = 9 | `SUB-PROCESSORS.md` is canonical; 30 days' notice on change; councils may request the current list at any time. | 2 × 2 = 4 |
| P-08 | Inadequate breach response misses NDB Scheme 30-day clock. | 3 × 5 = 15 | `INCIDENT-RESPONSE-RUNBOOK.md` with 72-hour internal target; OAIC notification template. | 2 × 4 = 8 |
| P-09 | Right-to-correction request for a ratepayer not actioned. | 2 × 4 = 8 | Council is the data controller; RatesAssist routes to council and assists within 5 business days. | 1 × 3 = 3 |
| P-10 | Re-identification of a "public" tenement holder via join with council records. | 3 × 3 = 9 | Joined data inherits the higher classification of its inputs (see `DATA-CLASSIFICATION-MATRIX.md`). | 2 × 3 = 6 |

---

## 9. Residual risk acceptance

The residual risk profile above is consistent with a council-decision-support system handling OFFICIAL and (limited) PROTECTED-class data, with cross-border LLM inference disclosed and human-in-the-loop on every council-facing action.

The two highest residual items are P-01 (cross-border disclosure) and P-04 / P-08 (PROTECTED data handling and breach response). Both are tracked to specific delivery phases in `PRODUCTION-PLAN.md`.

We accept the residual risk for the **pilot scope only**. Any expansion (additional councils, multi-tenant operation, or addition of bank account / TFN / health data) requires a new PIA before go-live.

---

## 10. Review cadence

- **Annual review** by the privacy owner.
- **Trigger reviews** on: new sub-processor; new data class; new jurisdiction; material change to information flows; any reportable incident under the NDB Scheme; change to Anthropic's data-residency posture.

---

## 11. Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Privacy owner (RatesAssist) | Brodie | 2026-05-08 | _On file_ |
| Council privacy officer | _Per pilot council_ | _Per pilot council_ | _Per pilot council_ |
| External privacy reviewer | _Pending pre-pilot legal review_ | _TBD_ | _TBD_ |

This PIA must be signed by the council privacy officer before any council-supplied personal information is loaded into RatesAssist.

---

*Last reviewed: 2026-05-08 · Next review: 2027-05-08 · Review cycle: annual.*
