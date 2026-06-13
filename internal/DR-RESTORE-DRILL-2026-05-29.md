# RatesAssist — DR Restore Drill (Audit Chain)

| | |
|---|---|
| **Document** | Disaster-recovery restore drill — tamper-evident audit chain |
| **Audience** | Founder (incident commander), council ICT auditors |
| **Status** | Drill PASSED. Living artefact. |
| **Owner** | Brodie · `engineering@ratesassist.com.au` |
| **Drill date** | 2026-05-29 |
| **Next drill due** | 2026-08-29 (quarterly) or after any change to the audit-chain schema / canonicaliser |

---

## 1. Why this drill exists

The `audit_log` hash chain is RatesAssist's **compliance-critical durable
store**: append-only, tamper-evident, retained for 7 years under the WA
*Local Government Act 1995* and *State Records Act 2000* (see
[`OBSERVABILITY.md`](OBSERVABILITY.md) §Retention and
[`DATA-RETENTION-POLICY.md`](../DATA-RETENTION-POLICY.md)).

A backup that has never been restored is not a backup. This drill proves the
end-to-end recovery path for the audit store and — critically — that the
**hash chain survives the restore byte-identical**: an independent verifier
re-walks the restored rows and confirms `ok:true` with no break. Without this
evidence, a council auditor cannot trust that a post-incident restore
preserved the integrity guarantee the chain exists to provide.

This drill closes the production-readiness gap "**3c — DR restore drilled**".
It is the recovery half of [`INCIDENT-RESPONSE-RUNBOOK.md`](../INCIDENT-RESPONSE-RUNBOOK.md)
§4.4 ("restore from a clean backup") and the verification half of
[`PRODUCTION-CHECKLIST.md`](PRODUCTION-CHECKLIST.md) §1 ("Tamper-evident chain
verified").

---

## 2. RPO / RTO targets

| Target | Value | Basis |
|---|---|---|
| **RPO** (max acceptable data loss) | **≤ 5 minutes** for the audit store. | Production Postgres runs continuous WAL archiving / point-in-time recovery on the managed provider (`ap-southeast-2`). The audit chain is the highest-value data; we accept at most the last few seconds of writes in a worst-case region event. |
| **RTO** (max time to restore service) | **≤ 60 minutes** for audit-store availability; **≤ 4 hours** for full verification of large chains. | Restore the latest snapshot/PITR, then run `verify-chain`. The verify step is O(rows) SHA-256; at pilot scale (≤ tens of thousands of rows/tenant) it completes in seconds, but we budget headroom for large tenants. |
| **Verification gate** | `verify-chain` MUST return `ok:true` (no `brokenAt`) on the restored store before the audit store is declared recovered. | A restore that loses chain integrity is a SEV1 in its own right — see runbook. |

These targets sit **inside** the SLA envelope in [`SLA.md`](../SLA.md) and are
formalised against the revenue-critical paths in
[`SLO-SLI.md`](SLO-SLI.md).

---

## 3. What was tested (2026-05-29)

The drill is implemented as a runnable, idempotent script and a CI-enforced
test. Both run against the **pglite** path (in-memory WASM Postgres) — the
same engine the audit-chain unit tests and the dev/CI bootstrap use — so the
drill is fully reproducible with **zero cloud credentials**. The verification
*logic* (`verifyChain` from `@ratesassist/audit-core`) is driver-agnostic and
byte-identical to the production Postgres path, so a pglite pass is a faithful
proof of the restore guarantee.

Procedure exercised (see `scripts/dr-audit-restore-drill.ts`):

1. **Seed** — bootstrap a fresh DB (migrations 0001..0005 via `ensureSchema`),
   insert a tenant, drive 50 audit writes mixing `withAudit` (before/after
   mutations) and `recordAuditEvent` (point events). Confirm the **live**
   chain verifies `ok:true` — the drill is invalid if the starting state is
   already broken.
2. **Backup** — dump every `audit_log` row in chain order, preserving `id`,
   `occurred_at`, `prev_hash` and `row_hash` exactly, to an in-memory snapshot
   **and** a timestamped JSON artefact under `reports/dr-drills/`.
3. **Simulate loss** — `TRUNCATE audit_log`. Assert the store is empty
   (catastrophic loss: dropped table / wiped volume / corrupted page).
4. **Restore** — re-`INSERT` every row from the snapshot, preserving all hash
   columns and the original timestamps verbatim. The restore deliberately does
   **not** re-derive hashes (that would mask corruption) — it replays the
   recorded bytes, mirroring `pg_restore` / a PITR snapshot load.
5. **Verify** — re-read the restored rows in chain order and run the same
   `verifyChain` the `/api/audit/verify-chain` route uses. PASS requires:
   `ok:true`, no `brokenAt`, restored row count equals pre-loss, and the chain
   head hash equals pre-loss byte-identical.
6. **Negative control** — tamper one restored row and confirm the verifier
   **still** catches it (break at the expected index), proving the restored
   chain is genuinely tamper-evident, not merely re-readable.

---

## 4. Verification output (2026-05-29 — PASS)

Command:

```
npm run dr:audit-drill        # default 50 rows; RA_DRILL_ROWS overrides
```

Result:

```
========================================================================
  DR RESTORE DRILL — tamper-evident audit chain
========================================================================
  pre-loss rows        : 50
  pre-loss chain head  : d06cdc5d30f2d75bdd7d36233e918cef671176311cede7129623dd22dec7e21a
  post-loss rows       : 0  (expected 0)
  restored rows        : 50
  post-restore rows    : 50
  post-restore head    : d06cdc5d30f2d75bdd7d36233e918cef671176311cede7129623dd22dec7e21a
  chain verify ok      : true  (brokenAt=null)
  tamper still caught  : true  (negative control)
========================================================================
  VERDICT: PASS — chain survived restore intact
========================================================================
```

Key facts proven:

- The store was genuinely emptied (`post-loss rows: 0`) before restore.
- All 50 rows came back (`restored = post-restore = pre-loss = 50`).
- The chain verifies after restore with **no break** (`ok:true`, `brokenAt=null`).
- The restored chain **head hash is byte-identical to pre-loss** — the
  recorded `prev_hash`/`row_hash` round-tripped exactly, so the integrity
  guarantee survived.
- A post-restore tamper is still detected (negative control at index 2).

The CI test (`apps/web/tests/dr-audit-restore-drill.test.ts`) runs the same
flow on every `npm run test` so this guarantee cannot silently regress.

---

## 5. How to re-run

### Local one-off (reproducible, no credentials)

```
npm run dr:audit-drill                 # 50 rows
RA_DRILL_ROWS=500 npm run dr:audit-drill   # larger chain
```

Exit code `0` = PASS, `1` = FAIL (CI-friendly). Each run writes a fresh
timestamped backup artefact under `reports/dr-drills/` (gitignored — the
dated result lives in this file).

### CI-enforced

`apps/web/tests/dr-audit-restore-drill.test.ts` is part of the standard
suite — it runs under `npm run test --workspace=apps/web`.

### Production restore (real Postgres) — procedure

The script proves the **logic**; the production runbook for a real region
event is:

1. **Contain** per [`INCIDENT-RESPONSE-RUNBOOK.md`](../INCIDENT-RESPONSE-RUNBOOK.md)
   §4.3 — freeze writes, snapshot the current (possibly corrupted) state for
   forensics **before** any destructive restore (§6 forensic preservation).
2. **Restore** the managed-Postgres snapshot / PITR to the target recovery
   point (RPO ≤ 5 min) into a fresh database in `ap-southeast-2`.
3. **Re-point** `DATABASE_URL` at the restored instance with `RA_USE_DB=true`.
4. **Verify** the chain for every active tenant by hitting
   `GET /api/audit/verify-chain` (platform_admin) — or run the verifier
   offline against the restored rows. **Do not declare recovery until every
   tenant returns `ok:true`.**
5. If any tenant returns `ok:false` with a genuine `brokenAt` (not an
   eviction-truncated window), treat it as a **SEV1 integrity incident** —
   the restore did not preserve the chain. Escalate per the runbook; do not
   resume writes on that tenant.

---

## 6. Files

| Artefact | Path |
|---|---|
| Runnable drill script | `scripts/dr-audit-restore-drill.ts` |
| npm entry | `npm run dr:audit-drill` (root `package.json`) |
| CI-enforced test | `apps/web/tests/dr-audit-restore-drill.test.ts` |
| Backup artefacts (per run, gitignored) | `reports/dr-drills/audit-backup-<timestamp>.json` |
| Verification logic (shared, driver-agnostic) | `packages/audit-core/src/index.ts` (`verifyChain`) |
| Chain writer | `packages/db/src/audit.ts` (`withAudit`, `recordAuditEvent`) |

---

*Drill performed 2026-05-29 by Brodie. Verdict: PASS. Next drill due
2026-08-29 (quarterly) or on any change to the audit-chain schema or the
`@ratesassist/audit-core` canonicaliser.*
