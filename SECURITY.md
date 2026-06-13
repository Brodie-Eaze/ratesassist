# RatesAssist — Security Posture

| | |
|---|---|
| **Document** | Security posture summary |
| **Audience** | Council ICT, security, audit, procurement |
| **Status** | Pre-pilot. Active development. |
| **Owner** | Brodie · `security@ratesassist.com.au` |
| **Version** | 0.3 |
| **Last reviewed** | 2026-05-31 |
| **Review cycle** | Quarterly, or on material change |

---

## Summary

RatesAssist is built for the Australian public sector. Every architectural decision is taken with the assumption that an Auditor-General, a council CIO, and an OAIC investigator may each independently review the system.

This document is the public-facing summary. The canonical engineering reference is [`RatesAssist.md` Section 11](RatesAssist.md#11-security-architecture). Forward-looking commitments are tracked in [`PRODUCTION-PLAN.md`](PRODUCTION-PLAN.md) and [`internal/SECURITY-FOLLOWUPS.md`](internal/SECURITY-FOLLOWUPS.md).

### Implementation status legend

We use the following labels throughout this document, and never represent more than is true:

- **In place** — implemented in the deployed code today.
- **Partial** — partially implemented; specific gaps called out.
- **Planned (Phase X)** — committed for a specific delivery phase but not yet implemented.
- **Aspirational** — an intent we have not yet committed a delivery date for.

---

## Hosting & data residency

- **Region (current pilot):** Vercel — Sydney edge region (`syd1`) pinned. **Status: in place** for the public web tier. Edge functions execute in-region; static assets are served from the global CDN.
- **Region (production target):** AWS Sydney (`ap-southeast-2`). **Status: planned (Phase 6).** All RatesAssist application data, backups, and audit logs will reside in Australia.
- **Cross-border data flows:** The only cross-border flow today is to Anthropic's Claude API. We use AU-region endpoints where Anthropic offers them; otherwise inference may be served from the United States. This is disclosed in `PRIVACY-IMPACT-ASSESSMENT.md` (APP 8 cross-border transfer) and is currently the single most material privacy item for council review.
- **Data export on demand:** Each tenant can request a full data export. **Status: in place** (manual, founder-run; automated export tooling is planned for Phase 3).
- **Data deletion on offboarding:** All council data is purged within 30 days of contract termination, with secure deletion attestation. **Status: planned (Phase 3)** as a documented runbook; today's pilot has no production tenant data.

---

## Network controls

- **TLS 1.3 in transit:** **In place** (terminated at Vercel/Cloudflare edge).
- **VPC with private subnets for compute and data:** **Planned (Phase 6)** — the current Vercel-hosted pilot does not have a VPC. AWS migration introduces this control.
- **Public surfaces protected by AWS WAF + Cloudflare:** **Partial** — Cloudflare protects today; AWS WAF arrives with the Phase 6 AWS migration.
- **Per-tenant IP allowlist:** **Planned (Phase 4, premium tier).**
- **DDoS mitigation:** **In place** via Vercel + Cloudflare. AWS Shield Standard is added with the Phase 6 migration.

---

## Application security

- **Input validation on every API and tool call:** **In place** for current MCP tool surface (Zod schemas).
- **Output encoding to prevent injection:** **In place** at the React render boundary.
- **LLM output prompt-injection screening before tool dispatch:** **Partial** — tools are allowlisted and parameter-validated; an explicit injection-screening pass is **planned (Phase 2)**.
- **No user-controlled URL fetches without allowlist:** **In place.**
- **Rate limiting per tenant and per user:** **Planned (Phase 2)** — pre-pilot single-tenant deployment does not require it today.
- **CORS strictly scoped per origin:** **In place.**
- **Content Security Policy headers:** **Planned (Phase 6)** — tracked under SEC-005 alongside the Next.js / CSP / HSTS rollout.

---

## Identity & access

We distinguish **authentication** (proving who a user is — SSO / MFA, largely **planned**) from **authorization** (what an authenticated session may do — RBAC + per-tool permissions, **enforced in code today**).

- **Authorization — roles + per-tool permissions:** **In place.** Four hierarchical roles (`rates_officer` < `rates_supervisor` < `council_admin` < `platform_admin`) are enforced on **every** tool call through a compile-time-exhaustive policy table (`apps/web/lib/tool-tenant-scope.ts`). Each tool maps to a required permission (e.g. `read.tenant_data`, `write.draft_mutation`, `read.audit_log`); a session lacking the permission is denied. Tenant scope is applied in the same chokepoint, and unknown tools fail closed.
- **Authentication — session integrity:** **Partial.** Sessions are short-lived, TTL-bounded cookies signed with HMAC-SHA256 (`RA_AUTH_SECRET`). **In place.** Rolling refresh and device/IP binding are **planned (Phase 4)**.
- **Officer-side SSO (Microsoft Entra / WorkOS):** **Partial.** The WorkOS OIDC callback and session-mapping code is implemented, but **inactive** until a council provisions SSO secrets — a fresh production deploy returns `501` from `/api/auth/callback` by design. **Activation is planned (Phase 4);** see `SUB-PROCESSORS.md`.
- **MFA enforcement:** **Planned (Phase 4)** — delivered with SSO. **There is no application-level MFA in the codebase today.** The pilot relies on the founder's hosting-provider MFA (Vercel, GitHub) for administrative access.
- **FIDO2 / hardware-token preference:** **Aspirational.**
- **Citizen-side magic link / MyGovID:** **Planned (Phase 5).** Not in scope for the council-officer-only pilot.
- **Step-up authentication for high-risk operations:** **Partial.** Mutating tools use a two-phase preview-then-confirm commit-token protocol (server-issued, 5-minute TTL, single-use) — **in place**. MFA-backed step-up is **planned (Phase 4)**.
- **Just-in-time provisioning + automatic deprovisioning:** **Planned (Phase 4).**

---

## Data protection

- **Encryption in transit (TLS 1.3):** **In place.**
- **Encryption at rest:** **Partial.** Today, application data sits on Vercel's managed storage, which is encrypted at rest by the provider using provider-managed keys. **AWS KMS with customer-managed keys is planned (Phase 6)** as part of the AWS migration. We do not currently operate KMS, and we do not represent that we do.
- **Field-level encryption for highly-sensitive fields (pensioner status, hardship grounds):** **Planned (Phase 3).** See `DATA-CLASSIFICATION-MATRIX.md` for which fields require it.
- **Tokenisation of bank account numbers:** **Planned (Phase 3).** Bank account numbers are not collected in the pilot.
- **Backup encryption with AU-region replication:** **Planned (Phase 6).** Pilot backups are limited to git history and Vercel's platform-level snapshots.
- **Right to be forgotten workflow:** **Planned (Phase 3).** Manual founder-run process today; documented in `DATA-RETENTION-POLICY.md`.

---

## Audit log

Every mutating tool call writes a structured audit entry tagged with tenant, actor, action, before/after snapshot, correlation ID, IP, and User-Agent. The captured-fields schema is delivered.

- **Append-only storage:** **In place** — in-memory ring buffer for the demo adapter (capped at 10,000 entries with FIFO eviction); Postgres-backed `audit_log` table available via `RA_USE_DB=true` for production, with `UPDATE` and `DELETE` revoked at the SQL role level (see `packages/db/migrations/0001_init.sql`).
- **Tamper-evident hash-chain:** **In place (compute + verify)** — every entry links to its predecessor (`prevHash` → `rowHash` over occurrence order); `GET /api/audit/verify-chain` recomputes the chain and reports the first broken row. **Durable DB-side validation (a Postgres trigger that recomputes the hash-link and rejects a broken row at write time) and external Merkle anchoring that survives a database-admin or hardware compromise remain Planned (Phase 9).** A `BEFORE INSERT` trigger already ships (`0005_audit_chain_sentinel_lockdown.sql`) but enforces only genesis-sentinel lockdown, not full chain recomputation — see the immutability caveat below.
- **Captured fields (user, role, tenant, IP, User-Agent, timestamp, action, target type/id, before/after JSON, correlation ID):** **In place.** Documented in `packages/db/AUDIT.md`.
- **7-year retention:** **Planned (Phase 2 Postgres rollout)** to satisfy state records requirements; see `DATA-RETENTION-POLICY.md`. The in-memory ring buffer in the demo adapter is intentionally bounded — do not represent it as durable.
- **Read API:** `GET /api/audit/log` (supervisor and above; `read.audit_log` permission). Cross-tenant reads are limited to `platform_admin`.
- **Tenant-level export on demand and on offboarding:** **Planned (Phase 3).**

We will not represent the audit log as Merkle-anchored, immutable across hardware compromise, or 7-year-retained until those properties are actually delivered. The in-memory variant satisfies the demo + functional-test requirement; the Postgres variant satisfies the production capture-and-retention requirement once `RA_USE_DB=true` is wired end-to-end (Phase 2 finalisation). See [`PRODUCTION-PLAN.md`](PRODUCTION-PLAN.md) and [`DATA-CLASSIFICATION-MATRIX.md`](DATA-CLASSIFICATION-MATRIX.md).

---

## AI / LLM data flow

We use Anthropic Claude as the language model layer. Specific protections:

- **Tool-grounded only:** the model cannot assert facts about a property, owner, or balance unless those facts were retrieved via a tool in the current conversation. **In place.**
- **Citation required:** every factual claim returned to the user has a tool-call ID linking it to the source. **In place** for retrieval tools.
- **PII minimisation:** sensitive fields are redacted before any data reaches the model unless the user role explicitly grants access. **Partial** — current pilot data is public DMIRS / SLIP / ABR data; PII redaction logic is **planned (Phase 3)** when first PROTECTED-class data is ingested.
- **Anomaly detection is deterministic:** scoring uses rule + ML pipelines, not LLM generation. The model only narrates and presents. **In place.**
- **Audit log captures exactly what data was sent to the model:** **Partial today** (request logged); structured prompt-payload capture is **planned (Phase 2)**.
- **No training on customer data.** Anthropic's Claude API does not train on API content per their published policy. We do not extend any other inference service rights to customer data. **In place.**

---

## Supply chain

- **Dependabot dependency monitoring:** **In place** on the GitHub repository.
- **Image / container scanning (Trivy, Snyk):** **Aspirational.** The pilot is serverless on Vercel; no container images are produced. Containerised AWS deployment in Phase 6 introduces scanning.
- **License scanning:** **Planned (Phase 6).**
- **SBOM in CycloneDX format per release:** **Planned (Phase 6).**
- **Critical-path libraries pinned and reviewed:** **In place** (lockfile committed; manual review of major bumps).
- **Reproducible builds:** **Aspirational.**

---

## Operational security

- **Penetration testing (CREST-accredited):** **Planned** — first engagement scheduled before pilot go-live. Cadence will be quarterly post-launch.
- **Annual third-party security audit:** **Planned (Year 1).**
- **24/7 on-call with documented runbooks:** **Partial.** See `ON-CALL.md` — the pilot is solo-founder on-call (best-effort, AWST 9am–9pm) with documented escalation. 24/7 cover is **planned (Phase 6)**.
- **Incident response plan tested quarterly:** **Partial.** Plan documented in `INCIDENT-RESPONSE-RUNBOOK.md`. Tabletop exercises **planned quarterly from pilot go-live**.
- **Customer notification SLA per Privacy Act NDB scheme:** **In place** as policy — 72-hour internal target, 30-day statutory maximum. See `INCIDENT-RESPONSE-RUNBOOK.md`.

---

## Certifications path

We do not currently hold any of the certifications below. The table is a roadmap, not a claim.

| Certification | Target | Reason |
|---|---|---|
| Essential Eight Maturity 1 | Year 1 | ACSC standard |
| Essential Eight Maturity 2 | Year 2 | Required by some state cyber policies |
| ISO 27001 | Year 2 | Council contracting threshold |
| SOC 2 Type II | Year 2 | Cross-vertical applicability |
| IRAP — PROTECTED | Year 3 | Required for federal & some state workloads |

---

## Frameworks aligned with

We use these as design references. Alignment is not certification.

- **ACSC Information Security Manual (ISM)**
- **ACSC Essential Eight** (actively maturing toward Maturity 1)
- **NSW Cyber Security Policy**
- **VIC Information Security Policy**
- **QLD Information Security Policy IS18**
- **WA Government Cyber Security Policy**
- **NIST Cybersecurity Framework**

---

## Vendor risk for council customers

If your council requires standardised vendor risk assessments, we can provide:

- A completed Privacy Impact Assessment — see `PRIVACY-IMPACT-ASSESSMENT.md`.
- A current sub-processor list — see `SUB-PROCESSORS.md`.
- A data classification matrix — see `DATA-CLASSIFICATION-MATRIX.md`.
- A data retention policy — see `DATA-RETENTION-POLICY.md`.
- An incident response runbook — see `INCIDENT-RESPONSE-RUNBOOK.md`.
- Pre-completed CAIQ v4 and SIG-Lite questionnaires on request.
- Council-specific questionnaires on request.

---

## Security disclosures

If you have identified a vulnerability, please email **`security@ratesassist.com.au`**. We acknowledge receipt within 1 business day and aim to triage within 5 business days.

We commit to:

- Acknowledging your report
- Working with you to understand and remediate
- Crediting your disclosure publicly (with permission)
- Not pursuing legal action against good-faith researchers

---

## Open items / pre-pilot caveats

Honest disclosure of where we are pre-certification:

- Formal certifications are targeted but not yet achieved.
- Penetration testing programme begins on first paying contract.
- Many controls described above are **planned**, not implemented; they are labelled inline.
- **Durable 7-year audit retention**, KMS-with-customer-managed-keys, and application-level MFA are the three controls most often pre-checked by procurement and are explicitly **not yet in place**. They are scheduled for Phase 2 (durable Postgres audit retention — the append-only, hash-chained capture is already in place), Phase 4 (MFA / SSO), and Phase 6 (KMS / VPC / AWS migration).
- The single most material privacy disclosure today is cross-border LLM inference (Anthropic). It is documented in `PRIVACY-IMPACT-ASSESSMENT.md` and disclosed to every council in pilot scoping.

We will not represent more than is true. Where a control is aspirational rather than active, this document marks it explicitly.

---

*Last reviewed: 2026-05-31 · Next review: 2026-08-31 · Review cycle: quarterly.*
