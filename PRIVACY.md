# RatesAssist — Privacy Posture

| | |
|---|---|
| **Document** | Privacy posture summary |
| **Audience** | Council privacy officers, legal counsel, OAIC where relevant |
| **Status** | Pre-pilot. Active development. |
| **Owner** | Brodie · `privacy@ratesassist.com.au` |
| **Version** | 0.2 |
| **Last updated** | 2026-05-31 |

---

## Summary

RatesAssist handles council rating data, which includes personal information of ratepayers. We design for the most stringent requirements across federal and state Australian privacy law, then apply additional protections specific to the AI / LLM context. This document is the public-facing summary; the canonical reference is in [`RatesAssist.md` Section 12](RatesAssist.md#12-compliance--regulatory).

---

## Legal basis

We process personal information in our role as a **service provider** to councils. The council remains the controller of the data; we are bound by data processing agreements that cover purpose limitation, security, sub-processing, audit rights, breach notification, and data return / deletion.

We comply with:

- **Privacy Act 1988 (Cth)** — Australian Privacy Principles (APPs 1–13)
- **Notifiable Data Breaches scheme**
- **State privacy laws** as applicable to each council customer (NSW PPIPA, QLD IPA, VIC PDPA, etc.)
- **Spam Act 2003** + **Do Not Call Register Act 2006** for any outbound communications

---

## What we collect

Strictly limited to what is necessary to deliver the service:

| Category | Examples | Source |
|---|---|---|
| Property records | Assessment number, address, valuation, rating classification | Council system of record |
| Owner records | Name, postal address, email, phone, ownership history | Council system of record |
| Transaction history | Levies, payments, adjustments, interest | Council system of record |
| Tenement records | Mining tenement IDs, holder, status, polygon | DMIRS (public) |
| Cadastral data | Parcel boundaries | Landgate / state registries (public) |
| Imagery | Aerial imagery of properties | Nearmap / Metromap (with council consent) |
| Council staff identity | Email, role, SSO subject | Council Microsoft Entra |
| Conversation history | Chat transcripts between officer and assistant | Internal — generated through use |

We do **not** collect:

- Banking credentials
- Credit card details (payment processing happens in council-approved gateways)
- Health information beyond what's already in the council's hardship records (and only when explicitly required to process the case)
- Personal information not relevant to rating

---

## Why we collect it

Data is collected and processed only for the following purposes, as specified in the council's data processing agreement:

1. **Lookup** — to answer officer queries
2. **Workflow** — to draft communications, generate certificates, propose corrections
3. **Anomaly detection** — to surface candidates for re-classification review
4. **Reporting** — to produce dashboards, briefings, and audit trails
5. **Service operation** — to provide login, audit logging, billing, support
6. **Cross-council benchmarking** — only with explicit council opt-in, only in anonymised aggregated form

We do **not** use this data:

- For training AI models
- For advertising
- For any purpose unrelated to the service the council has contracted for

---

## How we protect it

Controls are summarised here and specified in full — with per-control implementation status — in [`SECURITY.md`](SECURITY.md), which is the authoritative source. We use the same status labels and **never represent more than is true**: **in place** (deployed today), **partial** (gaps called out), **planned (Phase X)** (committed, not yet built), **aspirational** (no committed date).

| Control | Status |
|---|---|
| Encryption in transit (TLS 1.3) | **In place** |
| Hosting in Australia — web tier on Vercel Sydney (`syd1`) edge | **In place** for the public web tier |
| Production hosting on AWS Sydney (`ap-southeast-2`) — compute, RDS Postgres, S3, KMS | **Planned (Phase 6)** |
| Encryption at rest | **Partial** — provider-managed keys on Vercel storage today; AWS KMS with customer-managed keys is **planned (Phase 6)**. We do not currently operate KMS and do not represent that we do. |
| Field-level encryption of highly-sensitive fields (pensioner status, hardship grounds) | **Planned (Phase 3)** |
| Tenant isolation | **In place** — every tool call is tenant-scoped and RBAC-gated in application code; database row-level security arrives with the **Phase 6** Postgres model |
| Per-tenant credential vaulting (TechOne / Nearmap keys in AWS Secrets Manager) | **Planned (Phase 6)** with the AWS migration; no production third-party credentials are held in the pilot |
| Append-only audit log of mutating actions (tenant, actor, action, before/after, correlation ID), hash-chained for tamper-evidence | **In place**; durable 7-year Postgres retention is **planned (Phase 2)**. The demo adapter's in-memory log is intentionally bounded — not represented as durable. |
| Role-based access control (per-tool permissions) | **In place** in application code |
| SSO-backed identity, MFA enforcement, and step-up authentication | **Planned (Phase 4)** — there is **no application-level MFA today**; the pilot relies on hosting-provider MFA for administrative access |
| PII minimisation before LLM inference | **Partial** — pilot data is public DMIRS / SLIP / ABR; redaction logic for PROTECTED-class ratepayer data is **planned (Phase 3)** when first ingested |

See [`SECURITY.md`](SECURITY.md) for the authoritative, continuously-updated control status.

---

## How we share it

- **With Anthropic (Claude API)** — for AI inference. Anthropic's policy commits to not training on API content. Verify per request that AU region is used where available. Cross-border disclosure handled per APP 8.
- **With sub-processors** — strictly limited to AWS (hosting), the council's chosen SMS / email provider, and document processing services. List of sub-processors maintained at https://ratesassist.com.au/subprocessors and updated with 30 days' notice for changes.
- **With third parties** — never, except as required by law or with the council's explicit instruction.
- **For benchmarking** — only with explicit opt-in, only in anonymised k-anonymous aggregated form.

---

## Cross-border data flow

The Anthropic API may process data outside Australia. We disclose this clearly. Mitigations:

- Use AU-region Anthropic deployment where available
- Minimise PII before any data reaches the model
- Audit log captures exactly what data left the system
- Council can opt out of any specific tool / workflow if cross-border concerns are too restrictive
- For councils with absolute data residency requirements, we can offer reduced-AI workflows that perform key operations entirely in-country

---

## Retention

| Data | Retention | Reason |
|---|---|---|
| Property / owner records | Mirror of council system; deleted within 30 days of contract termination | Service operation |
| Transaction history | Same | Service operation |
| Audit log | 7 years from event | State Records Act compliance |
| Conversation history | 12 months by default; council-configurable | Officer review, training, complaints |
| Evidence packs | Retained while case is active; archived for 7 years post-resolution | Statutory + audit |
| User accounts | Deleted within 30 days of role removal | Standard practice |
| Backups | Maximum 35 days rolling | Operational recovery |

---

## Right of access, correction, complaint

Under the APPs:

- **APP 12 (access):** Individuals may request access to personal information held about them. Routed through the controller council (we are the processor); we support fulfilment within statutory timeframes.
- **APP 13 (correction):** Individuals may request correction. Same routing.
- **Complaint:** Individuals may complain to the council, to us at `privacy@ratesassist.com.au`, or to the OAIC.
- **Right to be forgotten:** Considered case-by-case as required by state Privacy Acts. Some council records are statutory and cannot be deleted.

---

## Privacy Impact Assessment

A standard PIA template is available, completed jointly with each council customer at onboarding. Topics covered:

- Data flows and processing purposes
- Risk identification and mitigation
- Compliance with state-specific laws
- Cross-border disclosure handling (Anthropic API)
- Council policy alignment
- Sub-processor disclosures
- Termination and data return procedures

---

## Notifiable Data Breaches

If a breach occurs:

1. We notify the affected council without undue delay — a **72-hour internal target** from discovery, well inside the NDB scheme's 30-day statutory maximum (consistent with the `INCIDENT-RESPONSE-RUNBOOK.md` SLA)
2. We assist the council in determining whether the breach is "eligible" under the NDB scheme
3. We support OAIC notification within the 30-day statutory window
4. We support council notification of affected individuals
5. We perform root-cause analysis and remediation
6. Public post-mortem on `https://ratesassist.com.au/security` for material incidents

---

## AI-specific privacy considerations

### Sensitive content protection

Personal information classified as "sensitive" or "highly sensitive" is excluded from the LLM context unless:

- The user role grants the necessary permission
- The specific workflow requires it
- An audit-log entry is created for the disclosure

### Hallucination prevention

The LLM is instructed to never assert facts about ratepayers it has not retrieved via a tool call. Officers and citizens see citations linking every claim to its source.

### Officer transparency

Where an AI-generated artefact is produced (evidence pack, draft letter, summary), it is labelled as such. Officers always retain veto.

### Citizen transparency

For RatesChat (citizen-facing), users are clearly informed they are interacting with an AI system. Hand-off to a human officer is always available on request.

---

## Privacy contact

**Privacy enquiries:** `privacy@ratesassist.com.au`
**Data subject requests:** `privacy@ratesassist.com.au`
**Council privacy officer requests:** same address; routed to founders directly
**OAIC:** https://www.oaic.gov.au

---

## Open items / pre-pilot caveats

- Sub-processor list is being formalised; current state matches the listing in this document
- DPA template is being authored; available on request
- PIA template is being authored; first PIA executed jointly with first pilot council
- Where a commitment is aspirational rather than active, we mark it explicitly here
