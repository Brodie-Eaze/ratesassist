# RatesAssist — Security Posture

| | |
|---|---|
| **Document** | Security posture summary |
| **Audience** | Council ICT, security, audit, procurement |
| **Status** | Pre-pilot. Active development. |
| **Owner** | Brodie · `security@ratesassist.com.au` |
| **Version** | 0.1 |
| **Last updated** | 2026-05-08 |

---

## Summary

RatesAssist is built for the Australian public sector. Every architectural decision is taken with the assumption that a NSW Auditor-General, a council CIO, and an OAIC investigator may each independently review the system. This document is the public-facing summary of our security posture; the canonical engineering reference is in [`RatesAssist.md` Section 11](RatesAssist.md#11-security-architecture).

---

## Hosting & data residency

- **Region:** AWS Sydney (`ap-southeast-2`). All RatesAssist application data, backups, and audit logs reside in Australia.
- **No offshore data transfers** for council operational data, except as explicitly necessary for AI inference (see "AI / LLM data flow" below) and only with council-level authorisation.
- **Anthropic Claude API:** AU region used where available. Verified per request.
- **Data export on demand:** Each tenant can request a full data export at any time.
- **Data deletion on offboarding:** All council data is purged within 30 days of contract termination, with secure deletion attestation.

---

## Network controls

- TLS 1.3 in transit, end-to-end
- VPC with private subnets for compute and data
- Public surfaces protected by AWS WAF + Cloudflare
- Per-tenant IP allowlist available on request (premium tier)
- DDoS mitigation via Cloudflare + AWS Shield Standard

---

## Application security

- Input validation on every API and tool call
- Output encoding to prevent injection
- LLM output passes through prompt-injection screening before any tool dispatch
- No user-controlled URL fetches without allowlist
- Rate limiting per tenant and per user
- CORS strictly scoped per origin
- Content Security Policy headers on all web responses

---

## Identity & access

- **Officer side:** Microsoft Entra SSO mandatory; MFA enforced; FIDO2 preferred
- **Citizen side:** email magic link or MyGovID where supported
- **Sessions:** short-lived JWT with rolling refresh; session bindings to device + IP
- **Roles:** `viewer`, `officer`, `senior_officer`, `coordinator`, `manager`, `admin`
- **Permissions:** granular per tool (e.g. `tool.send_sms`, `tool.write_owner`)
- **Step-up authentication** required for high-risk operations (batch communications, owner record edits, certificate generation)
- **Just-in-time provisioning** + automatic deprovisioning on SSO removal

---

## Data protection

- **Encryption at rest:** AWS KMS with customer-managed keys available for premium tier
- **Encryption in transit:** TLS 1.3 throughout
- **Field-level encryption** for highly-sensitive fields (pensioner status, hardship grounds)
- **Tokenisation** of bank account numbers
- **Backup encryption** with AU-region replication
- **Right to be forgotten** workflow respecting state Privacy Act variations

---

## Audit log

Every read and write generates an immutable audit event capturing:

- User identity, role, tenant
- IP address and device
- Timestamp + monotonic sequence number
- Action (tool name, parameters, result hash)
- Linked conversation ID

The audit log is:

- Append-only
- Tamper-evident (Merkle-tree anchoring)
- Retained for 7 years to satisfy state records requirements
- Exportable per tenant on demand and on offboarding

---

## AI / LLM data flow

We use Anthropic Claude as the language model layer. Specific protections:

- **Tool-grounded only:** the model cannot assert facts about a property, owner, or balance unless those facts were retrieved via a tool in the current conversation.
- **Citation required:** every factual claim returned to the user has a tool-call ID linking it to the source.
- **PII minimisation:** sensitive fields are redacted before any data reaches the model unless the user role explicitly grants access.
- **Anomaly detection is deterministic:** scoring uses rule + ML pipelines, not LLM generation. The model only narrates and presents.
- **Audit log captures exactly what data was sent to the model**, so retrospective review is possible.
- **No training on customer data.** Anthropic's Claude API does not train on API content per their published policy. We do not extend any other inference service rights to customer data.

---

## Supply chain

- Dependabot / Renovate continuous dependency monitoring
- Image scanning (Trivy, Snyk) on every container build
- License scanning (FOSSA / Snyk)
- SBOM generated per release in CycloneDX format
- Critical-path libraries pinned and reviewed
- Reproducible builds where possible

---

## Operational security

- Quarterly penetration testing (CREST-accredited tester)
- Annual third-party security audit
- 24/7 on-call with documented runbooks
- Incident response plan tested quarterly
- Customer notification SLA per Privacy Act NDB scheme: 72 hours target, 30-day statutory maximum

---

## Certifications path

| Certification | Target | Reason |
|---|---|---|
| Essential Eight Maturity 1 | Year 1 | ACSC standard |
| Essential Eight Maturity 2 | Year 2 | Required by some state cyber policies |
| ISO 27001 | Year 2 | Council contracting threshold |
| SOC 2 Type II | Year 2 | Cross-vertical applicability |
| IRAP — PROTECTED | Year 3 | Required for federal & some state workloads |

---

## Frameworks aligned with

- **ACSC Information Security Manual (ISM)** — design choices align with current ISM controls
- **ACSC Essential Eight** — actively maturing toward Maturity 2
- **NSW Cyber Security Policy**
- **VIC Information Security Policy**
- **QLD Information Security Policy IS18**
- **WA Government Cyber Security Policy**
- **NIST Cybersecurity Framework** — used as design reference

---

## Vendor risk for council customers

If your council requires standardised vendor risk assessments, we can provide pre-completed:

- CAIQ v4 (Cloud Security Alliance)
- SIG-Lite (Standard Information Gathering)
- Council-specific questionnaires on request
- Privacy Impact Assessment template + completed PIA per tenant

---

## Security disclosures

If you have identified a vulnerability or security concern, please email **`security@ratesassist.com.au`**. We acknowledge receipt within 1 business day and aim to triage within 5 business days.

We commit to:

- Acknowledging your report
- Working with you to understand and remediate
- Crediting your disclosure publicly (with permission)
- Not pursuing legal action against good-faith researchers

---

## Open items / pre-pilot caveats

Honest disclosure of where we are pre-certification:

- Formal certifications are targeted but not yet achieved
- Penetration testing programme begins on first paying contract
- Some controls described above are "implemented" at architectural level, "to be productionised" at code level by phase 1 close
- We will not represent more than is true. Where a control is aspirational rather than active, we mark it explicitly in this document.
