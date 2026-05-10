# Security Follow-ups

Open items deferred from Phase 1B security review (2026-05-08).

## SEC-002 — MCP child-process tool-call concurrency cap (Medium)

**File:** apps/web/lib/mcp-client.ts

**Issue:** The 5s per-call timeout abandons the JSON-RPC waiter but does not
cancel work inside the child process. MCP stdio protocol has no cancellation
frame. A user driving expensive tools (e.g. `find_mining_mismatches` over a
large synthetic dataset) can pile up work in the child even though each call
times out, eventually starving legitimate calls or OOMing the host.

**Plan:**
1. Add a per-process concurrency cap (e.g. 4 in-flight tool calls). Excess
   calls return `rate_limited` immediately rather than queue.
2. On timeout, if backlog exceeds the cap, recycle the child via
   `transport.close()` so the child's work is killed.
3. Document that adapter handlers must be CPU-bounded; future Phase 2+
   adapters must run under cgroup memory/CPU limits when deployed.

**Severity:** Medium. Pre-pilot risk is low (single-tenant, no real users yet).
Must be patched before Phase 2 multi-tenant rollout.

## SEC-005 — Next.js 14.2.35 known DoS CVEs (Medium, deferred)

**File:** apps/web/package.json

**Issue:** `npm audit` flags 1 high + 6 moderate vulnerabilities in Next.js
14.2.35 transitive deps. The advisories are DoS-class:
- Image Optimizer DoS
- RSC deserialization DoS
- Request-smuggling rewrites
- Image cache exhaustion
- Server Components DoS
- postcss XSS via CSS Stringify (transitive)

**Why deferred:** Pre-pilot, single-tenant demo with no public traffic. DoS
risk is not material until the system is reachable from the internet by
unauthenticated users. The fix (Next.js 16) is a major-major bump that
changes peer-dep requirements (React 19) and was previously rolled back due
to integration risk.

**Plan:** Upgrade as part of Phase 6 (Production Hardening) per
PRODUCTION-PLAN.md, alongside React 19 migration and CSP/HSTS rollout.
Target: before any public-internet exposure.

---

## 2026-05-08 audit — SEC-001 through SEC-024 (tracked)

The 2026-05-08 AU public-sector compliance audit raised the following items.
All are tracked here; full text and remediation plans are in the audit report
and in PRODUCTION-PLAN.md. Status legend: **open**, **in progress**,
**resolved**, **deferred (phase X)**.

- **SEC-001** — SECURITY.md claimed immutable audit log; not implemented. Status: **resolved** (downgraded in SECURITY.md to Phase 2 commitment).
- **SEC-003** — SECURITY.md claimed AWS KMS encryption at rest; current pilot is provider-managed only. Status: **resolved** (downgraded; KMS deferred to Phase 6).
- **SEC-004** — SECURITY.md claimed application-level MFA; no MFA exists in code. Status: **resolved** (downgraded; MFA deferred to Phase 4 with SSO).
- **SEC-006** — SECURITY.md claimed VPC + AWS WAF; pilot runs on Vercel without VPC. Status: **resolved** (downgraded; deferred to Phase 6).
- **SEC-007** — SECURITY.md claimed field-level encryption; not implemented. Status: **resolved** (downgraded; deferred to Phase 3).
- **SEC-008** — SECURITY.md claimed bank account tokenisation; not collected in pilot. Status: **resolved** (downgraded; Phase 3 prerequisite if collection ever begins).
- **SEC-009** — SECURITY.md claimed quarterly CREST pen test in place. Status: **resolved** (downgraded; first engagement scheduled before pilot go-live).
- **SEC-010** — SECURITY.md claimed annual third-party security audit. Status: **resolved** (downgraded to Year 1 plan).
- **SEC-011** — SECURITY.md claimed 24/7 on-call. Status: **resolved** (replaced with `ON-CALL.md` solo-founder reality + Phase 4/6 plan).
- **SEC-012** — SECURITY.md claimed image scanning, SBOM, license scanning. Status: **resolved** (downgraded; serverless pilot does not produce images; Phase 6).
- **SEC-013** — SECURITY.md claimed step-up auth and RBAC. Status: **resolved** (downgraded; Phase 4).
- **SEC-014** — SECURITY.md claimed JIT provisioning. Status: **resolved** (downgraded; Phase 4).
- **SEC-015** — SECURITY.md claimed CSP headers in place. Status: **resolved** (downgraded; Phase 6, tracked under SEC-005).
- **SEC-016** — SECURITY.md claimed rate limiting per tenant. Status: **resolved** (downgraded; Phase 2).
- **SEC-017** — SECURITY.md claimed prompt-injection screening pass on LLM output. Status: **resolved** (downgraded; partial today via tool allowlist; explicit screening Phase 2).
- **SEC-018** — Missing PIA. Status: **resolved** (created `PRIVACY-IMPACT-ASSESSMENT.md`).
- **SEC-019** — Missing sub-processor list. Status: **resolved** (created `SUB-PROCESSORS.md`).
- **SEC-020** — Missing data retention policy. Status: **resolved** (created `DATA-RETENTION-POLICY.md`).
- **SEC-021** — Missing incident response runbook. Status: **resolved** (created `INCIDENT-RESPONSE-RUNBOOK.md`).
- **SEC-022** — Missing data classification matrix. Status: **resolved** (created `DATA-CLASSIFICATION-MATRIX.md`; complements Track C `DATA-CLASSIFICATION.md`).
- **SEC-023** — Missing SLA. Status: **resolved** (created `SLA.md` with pilot + production targets).
- **SEC-024** — Missing CHANGELOG. Status: **resolved** (created `CHANGELOG.md` populated from git tags).

### Cross-cutting open items

- **SEC-CC-01** — Anthropic AU-region inference: pin AU endpoints under a contract acceptable to council procurement. Status: **open**, dependent on Anthropic offering. Flagged in PIA as the most material privacy item.
- **SEC-CC-02** — External privacy counsel must review the PIA, NDB notification templates, and council-side collection notice wording before pilot go-live. Status: **open**, blocking pilot go-live.
- **SEC-CC-03** — Backup contact briefing must be documented and signed before pilot go-live (`ON-CALL.md` §3). Status: **open**, blocking pilot go-live.
