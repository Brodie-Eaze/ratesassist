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
