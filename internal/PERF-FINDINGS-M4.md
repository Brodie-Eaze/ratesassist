# Perf Remediation — Findings (M4)

Date: 2026-06-04 · Officer scale (5k/15k). Audit of the hot read paths + write hot spots.

**Outcome: no safe *mechanical* fix to force this pass — the mechanical levers are already pulled.** The remaining
levers are architectural and **evidence-gated** (decide with the M3 load-test numbers, per the loop discipline:
fix safe mechanical things now, log risky/architectural ones for review).

## ✅ Already good (verified)
- **Index coverage** — every tenant table has its `tenant_id` index (`properties`, `owners`, `transactions`
  (tenant+property), `signal_hits` (tenant+property), `mismatch_candidates`, `audit_log`), plus the audit chain
  composites (`audit_log_tenant_chain_idx`, `audit_log_tenant_occurred_idx`, `tenant_row_hash_unique`) and the
  uniques (`properties_tenant_assessment`, `owners_tenant_ext_id`). No missing index on a hot filter column.
- **Audit append is PER-TENANT, not a global lock** — `packages/db/src/audit.ts:181`
  `pg_advisory_xact_lock(hashtext(tenant_id)::bigint)`. Different councils append concurrently; only same-tenant
  appends serialize (required for the hash chain). This is the correct scale shape — confirms the M2b note.
- **Recovery sweep already de-duped** — PERF-001: `/api/data` + `/api/recovery` run ONE `findMismatches(ctx)`
  feeding both payload + `recoveryStatsFor` (previously ran twice).
- **Request safety rails present** — `statement_timeout=15s` + `idle_in_transaction_session_timeout=10s` +
  bounded pool (`RA_DB_POOL_MAX`); body cap; per-route rate limits.

## ⚠ Architectural / evidence-gated (LOGGED for review — NOT safe to force unattended)
1. **In-memory full-dataset eval context.** `buildContextFromDb()` (`apps/web/lib/clients.ts`) loads ALL rows
   per tenant (`tx.select().from(owners/properties/propertyOwners)` — no LIMIT) into a process-wide cached
   context, then `findMismatches` runs in memory. Fine for fixtures + small councils; for a 50k-property council
   this is memory + cold-build heavy. **It is built once per process (cached), so it is NOT a per-request N+1** —
   but it is the real scale ceiling. Adding a LIMIT would BREAK correctness (the sweep needs the full set).
   *Fix is architectural — pick with load-test evidence:* (a) cache the COMPUTED result per M2b (cache the non-PII
   `stats`), (b) push mismatch detection into SQL, or (c) stream/paginate the build. Don't do unattended.
2. **`/api/data` bundle may over-fetch.** Its own header notes it returns `properties/owners/tenements` arrays
   "alongside" mismatches+stats, while "the recovery page only needs mismatches+stats." Trimming would cut payload
   + serialization cost under load — BUT multiple pages consume `/api/data` (certificates, map, aerial), so it
   needs a consumer audit first. Review item, not a blind cut.
3. **`buildContextFromDb` per-tenant loop is sequential** (`for (const t of tenantRows) { await withTenant... }`).
   Could be `Promise.all`-parallelised, but it's bootstrap-only (once per process) + low value + concurrency change
   has subtle ordering risk → log, don't force.

## Recommendation
Run `load-test/officer-load.js` (Q-ra-loadtest). If reads are the p99 tail → implement M2b option-1 caching of the
non-PII recovery `stats` (item 1a) — the single highest-leverage, lowest-risk fix, and it neutralises items 1 + 2.
Everything mechanical is already done; resist speculative index/limit churn.
