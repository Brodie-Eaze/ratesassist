# RatesAssist — Data Classification Matrix

| | |
|---|---|
| **Document** | Data classification matrix (policy lens) |
| **Audience** | Council ICT, privacy officers, audit |
| **Status** | Pre-pilot. Living document. |
| **Owner** | Brodie · `security@ratesassist.com.au` |
| **Version** | 1.0 |
| **Last reviewed** | 2026-05-08 |
| **Review cycle** | Quarterly |

---

## 1. Purpose

This document is the **policy view** of how RatesAssist classifies data and what handling each class requires. The **schema and encryption mechanics** view — which fields are encrypted by which key, which columns carry which classification tags in code — lives in `DATA-CLASSIFICATION.md`. The two documents are deliberately complementary; this one drives policy, that one drives implementation.

Classification follows the Australian Government Protective Security Policy Framework (PSPF) and the ACSC *Information Security Manual* (ISM).

---

## 2. Classification model

We use four classes:

| Class | Definition | Indicative impact if compromised |
|---|---|---|
| **PUBLIC** | Information lawfully available to the public; no harm from disclosure. | None |
| **OFFICIAL** | Routine business information; minor harm if compromised. | Minor: minor inconvenience to a council or ratepayer |
| **OFFICIAL:Sensitive** | Information requiring limited dissemination; meaningful harm if disclosed. | Moderate: damage to council reputation; identity exposure of a ratepayer |
| **PROTECTED** | Information whose compromise is likely to cause damage to an individual, council or the state. | Significant: financial harm; safety harm; loss of trust in local government |

We do not currently process SECRET or TOP SECRET data. If we ever do, that is out of scope for this document and a separate classification baseline will be required.

---

## 3. Per-entity classification matrix

The matrix below assigns the **highest** classification at which each field may be processed. A joined record inherits the highest classification of its inputs.

### 3.1 Council

| Field | Class | Notes |
|---|---|---|
| Council code, name, ABN | PUBLIC | Public register |
| Tenant config (feature flags, limits) | OFFICIAL | Operational |
| Council billing details | OFFICIAL:Sensitive | Limited to founder + council finance |
| Council admin contact | OFFICIAL | Routine |

### 3.2 Property

| Field | Class | Notes |
|---|---|---|
| Property address | OFFICIAL | Public address; sensitive only when joined to owner |
| Lot/plan, certificate of title | OFFICIAL | Landgate / SLIP — public register |
| Rateable value | OFFICIAL | Council valuation; public on rate notice |
| Land use code, zoning | OFFICIAL | Statutory |
| Geocode (lat/long) | OFFICIAL | Derived from public cadastre |

### 3.3 Owner

| Field | Class | Notes |
|---|---|---|
| Full name | OFFICIAL:Sensitive | Personal information under *Privacy Act 1988 (Cth)* s.6 |
| Postal address | OFFICIAL:Sensitive | Personal information |
| Email address | OFFICIAL:Sensitive | Personal information |
| Phone number | OFFICIAL:Sensitive | Personal information |
| Outstanding balance | OFFICIAL:Sensitive | Financial information about an individual |
| Pensioner / hardship status | PROTECTED | Sensitive information; small population means re-identification risk is high |
| Date of birth | PROTECTED | Not collected in pilot; class set for completeness |
| Bank account number | PROTECTED | Not collected in pilot; would require tokenisation before adoption |
| Tax File Number | Out of scope | Never collected. Would trigger a TFN Rule assessment if ever proposed. |

### 3.4 Tenement (mining)

| Field | Class | Notes |
|---|---|---|
| Tenement ID, status, holder name (corporate) | PUBLIC | DMIRS public register |
| Tenement holder address (corporate) | PUBLIC | DMIRS public register |
| Tenement holder (natural person) | OFFICIAL | Public register, but treated with care once joined to council records |
| Geometry (polygon) | PUBLIC | DMIRS public register |

### 3.5 Transaction

| Field | Class | Notes |
|---|---|---|
| Transaction ID, type, amount, date | OFFICIAL | Council financial record |
| Linked owner ID | OFFICIAL:Sensitive | Joins owner — inherits owner classification |
| Linked property ID | OFFICIAL | |
| Concession code (e.g. pensioner) | PROTECTED | Indicates pensioner / hardship status |

### 3.6 AuditLog

| Field | Class | Notes |
|---|---|---|
| User identity, role, tenant | OFFICIAL:Sensitive | Identifies a council officer |
| IP address, device fingerprint | OFFICIAL:Sensitive | Personal information of the officer |
| Timestamp, monotonic sequence | OFFICIAL | |
| Action (tool name + parameters) | OFFICIAL:Sensitive | May embed PII references |
| Result hash | OFFICIAL | |
| Conversation ID | OFFICIAL | |

### 3.7 LLM artefacts

| Field | Class | Notes |
|---|---|---|
| Prompt payload sent to Anthropic | OFFICIAL:Sensitive (max) | Pilot avoids PROTECTED data in prompt payloads pending Phase 3 redaction |
| Tool-call result captured in audit log | OFFICIAL:Sensitive | Inherits the underlying record's class, capped at OFFICIAL:Sensitive |
| Assistant reply | OFFICIAL:Sensitive | |

---

## 4. Handling requirements per class

| Requirement | PUBLIC | OFFICIAL | OFFICIAL:Sensitive | PROTECTED |
|---|---|---|---|---|
| Encryption in transit (TLS 1.3) | Required | Required | Required | Required |
| Encryption at rest | Provider-managed | Provider-managed (KMS planned Phase 6) | Provider-managed (KMS planned Phase 6); customer-managed keys planned Phase 6 | Customer-managed keys (Phase 6 prerequisite) + field-level encryption (Phase 3) |
| Cross-border processing | Allowed | Allowed only via disclosed sub-processors | Allowed only via disclosed sub-processors with APP 8 disclosure | Not allowed without explicit council written approval per occurrence |
| Cloudflare edge processing | Allowed | Allowed | Allowed | **Not allowed** through Cloudflare edge |
| Access logging | Optional | Required | Required | Required + per-record reason captured (Phase 3) |
| Role required to read | Any authenticated | `viewer`+ | `officer`+ | `senior_officer`+ with step-up auth (Phase 4) |
| Retention | Per source | 7 years (audit) / per `DATA-RETENTION-POLICY.md` | 7 years / per policy | 7 years / per policy + minimised collection |
| Backup storage | Same class as source | OFFICIAL | OFFICIAL:Sensitive (encrypted) | PROTECTED (encrypted, customer-managed keys, Phase 6) |
| Local development copies | Allowed | Allowed (encrypted disk) | Discouraged; encrypted-disk only; 7-day max | **Prohibited** |
| Breach impact threshold | None | Internal log only | Triggers NDB assessment if eligible | NDB assessment + escalated council and regulator notification |
| Display in LLM narration | Allowed | Allowed | Role-redacted by default | Role-redacted by default; explicit allowlist required |

---

## 5. Inheritance rules

- A **join** between two records produces output that inherits the **higher** classification of its inputs.
- A **derived** field (e.g. an anomaly score combining several inputs) inherits the highest input class.
- An **aggregate** that does not permit re-identification of a small population may be downgraded by one class with privacy-officer sign-off; otherwise it inherits the highest input class.

---

## 6. Implementation status

| Control | Status | Phase |
|---|---|---|
| Classification tags on every domain entity in code | Partial | Phase 2 (alongside Postgres rollout) |
| Field-level encryption for PROTECTED fields | Planned | Phase 3 |
| Customer-managed KMS keys | Planned | Phase 6 |
| Role-based redaction in LLM payload | Planned | Phase 3 / Phase 4 (paired with RBAC) |
| Per-record access-reason capture | Planned | Phase 3 |
| Cloudflare PROTECTED-traffic exclusion | Architectural; reinforced at Phase 6 with VPC | Phase 6 |

See `SECURITY.md` for the canonical implementation status of these controls and `PRODUCTION-PLAN.md` for phase definitions.

---

## 7. Review

This document is reviewed quarterly, and on any change to the data model, sub-processor list, or applicable classification frameworks (PSPF / ISM updates).

---

*Last reviewed: 2026-05-08 · Next review: 2026-08-08 · Review cycle: quarterly.*
