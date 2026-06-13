# Caching + Async Offload — Design (M2b)

**Status: DESIGN ONLY.** Nothing here is built yet. The discipline is **evidence-driven**: this names the
candidates and the safe shapes; we implement the specific piece the **M3 load test (`load-test/officer-load.js`)
proves is the bottleneck — not speculatively.** ElastiCache + SQS infra is NOT authored until a candidate is
chosen (then it's reversible IaC on a branch; the *apply* is queued).

Date: 2026-06-04 · Goal: officer scale (5k sustained / 15k burst).

---

## Hot paths (ranked by suspected cost)

| Path | Where | Cost | Lever |
|---|---|---|---|
| **`findMismatches(ctx)`** multi-signal recovery sweep | `@ratesassist/recovery-engine`, called by `/api/data` + `/api/recovery` | **Highest** — runs the full signal sweep per request. PERF-001 already de-duped it to ONE sweep feeding both payload + stats. | **Cache** (per-tenant, short TTL) |
| External register calls (DMIRS WFS, Landgate, ABN) | `lib/clients.ts`, `@ratesassist/spatial` (dmirs.ts) | High + variable (network to slip.wa.gov.au) | **Cache** (longer TTL — public reference data) |
| Evidence-pack PDF generation | `lib/evidencePdf.ts` / `buildEvidencePack`, `POST /api/evidence/[file]/pdf` | High, user-initiated, bursty | **Async offload** |
| Audit-chain append | `@ratesassist/audit-core` + `packages/db` (`recordAuditEvent`/`withAudit`) | Per mutation; integrity-critical | **Do NOT offload** — optimize in place |
| Tenant directory reads | `tenants` table | Low but per-request | Cache (long TTL) |

---

## Caching (ElastiCache / Redis)

**Pattern:** a thin `getOrCompute(key, ttl, fn)` wrapper in `lib/cache.ts` — Redis (ElastiCache, TLS) in prod,
no-op/in-memory in dev. Behind `RA_CACHE=on`. Fail-OPEN: a cache miss or Redis outage falls through to the live
compute (never an error).

**Keys are TENANT-SCOPED, always.** `ra:<env>:<tenant>:<resource>:<version>`. A cache key without the tenant id
is a cross-tenant leak — same severity as an RLS bypass. The cache layer asserts a non-empty tenantId.

**⚠ PII is the central decision for `findMismatches`.** Its output contains ratepayer addresses + arrears. Two
safe options, in preference order:
1. **Cache only the non-PII `stats` aggregate** (`recoveryStatsFor`) + any expensive non-PII intermediates;
   recompute the PII candidate list live. Smaller blast radius, no PII at rest in Redis.
2. If the full list must be cached: **short TTL (30–60s)**, TLS in transit, encryption at rest on the cluster
   (CMK), tenant-scoped keys, and it counts as a sub-processor surface → **privacy review + DPA coverage**.
   → Recommend **option 1** unless the load test shows the live recompute is the tail-latency driver.

| Candidate | TTL | Invalidation |
|---|---|---|
| recovery `stats` aggregate (non-PII) | 30–60s | TTL; explicit bust on import/mutation (the two-phase commit endpoints) |
| DMIRS/Landgate/ABN register responses | 6–24h | TTL (public data); manual bust on demand |
| tenant directory | 5–15m | bust on council add/update (`/api/tenants`) |

Invalidation hooks live at the **mutation sites** (the `import-*` + `request-conversion` commit paths) — they
already gate writes through commit tokens, so bust the tenant's cache keys there.

---

## Async offload (queue)

**Candidate: evidence-pack PDF generation.** Today it runs synchronously on `POST /api/evidence/[file]/pdf`.
Under burst that adds tail latency + holds a request worker. Shape:
1. Request enqueues a job (tenant, assessment, operator) → returns `202 + jobId`.
2. A worker generates the pack and writes it to the existing evidence store.
3. Client polls `/api/evidence/[file]` (already the download surface) or gets notified (`/api/notify` exists).

**Queue tech:** **SQS** (managed, ap-southeast-2, durable — right for money/evidence work) over BullMQ-on-Redis
(reuses ElastiCache but less durable). Pick SQS unless we're already running Redis and volume is trivial.

**Do NOT make async — optimize in place instead:**
- **Audit-chain append.** Integrity requires synchronous, ordered, same-transaction append (the hash chain +
  the 0005 sentinel + 0008 truncate lockdown). The scale lever is **per-tenant chains** (append contention is
  per-tenant, not global) + the existing BIGSERIAL commit-ordering — NOT a queue. If append shows as a hot lock
  under load, the fix is index/lock scope, not eventual consistency. Flag, don't offload.

---

## Build order (decided by the load test, not now)

1. Run `load-test/officer-load.js` (Q-ra-loadtest) → read the p99 + saturation breakdown.
2. If **reads** are the tail → ship `lib/cache.ts` + cache the recovery `stats` aggregate first (option 1).
3. If **evidence-pack** requests drive tail spikes → ship the SQS offload.
4. If **register calls** dominate → cache DMIRS/Landgate responses.
5. Author the ElastiCache / SQS Terraform (reversible, on a branch) only for the chosen lever; the apply is queued.

This keeps us from buying + operating Redis/SQS we don't need, and from putting ratepayer PII at rest without
evidence it's required.
