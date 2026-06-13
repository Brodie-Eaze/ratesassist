# Right-To-Be-Forgotten (RTBF) / Right-To-Erasure Flow

**Status:** implemented + tested (Compliance ship-readiness criterion "RTBF flow implemented + tested").
**Regulatory basis:** *Privacy Act 1988 (Cth)* — APP 11.2 (take reasonable steps to destroy or de-identify personal information no longer needed); APP 12/13 (access & correction; erasure is the destroy-leg).
**Last updated:** 2026-05-29.

---

## 1. What it does

A council privacy officer (the DPO delegate) triggers destruction of a data
subject's personal information. The flow **crypto-shreds the owner's contact
PII to tombstones** while **preserving non-PII structural linkage** so the
rates roll stays referentially intact — we de-identify, we do not orphan.

Crypto-shred shape (byte-identical across both stores):

| Field            | Before                          | After       |
| ---------------- | ------------------------------- | ----------- |
| `name`           | "John & Sarah Wilkins"          | `"[erased]"` |
| `email`          | "j.wilkins@example.com"         | `null`      |
| `phone`          | "0408 121 884"                  | `null`      |
| `postalAddress`  | "12 Stadium Road, Tom Price…"   | `"[erased]"` |
| `previousOwners` | `[...]`                         | `[]`        |
| `ownerId`        | "O-WA-010"                      | **preserved** |
| `ownerSince`     | "2018-09-04"                    | **preserved** |
| property `ownerIds` linkage | …                    | **preserved** |

`ownerId`, `ownerSince`, ABN and the property→owner linkage survive so
assessments, balances and recovery state remain attributable to a
de-identified subject.

---

## 2. Entry points

- **API:** `POST /api/privacy/erasure`
  - Body: `{ ownerId: string, legalBasis?: string, legalHold?: boolean }`
  - `ownerId` — state-scoped data-subject id, e.g. `"O-WA-001"`.
  - `legalBasis` — free-text basis / privacy-officer ticket ref, recorded on
    the audit row (**never** any erased value).
  - `legalHold` — when `true`, defer (409) and document the conflict rather
    than destroy.
  - Responses: `200 { ok, erased, alreadyErased, tenantsAffected, shared, ownerId }`;
    `401` unauthorized · `403` forbidden · `404` not_found · `409` conflict (hold) ·
    `400` invalid_input · `500` internal_error.
- **Service:** `apps/web/lib/privacy-erasure.ts` → `eraseOwnerData(input)`.
  Owns authorisation, idempotency, dual-store erasure, retention carve-outs
  and the tamper-evident audit row.
- **Route:** `apps/web/app/api/privacy/erasure/route.ts` — a thin guard
  (auth, body validation, attribution capture) over the service.

### How a DPO triggers it

1. A ratepayer lodges an erasure request; the council privacy officer
   validates identity and that no statutory bar applies (see §5).
2. The officer (signed in as `council_admin`, or platform staff as
   `platform_admin`) issues `POST /api/privacy/erasure` with the `ownerId`
   and a `legalBasis` ticket reference.
3. The service erases both stores, writes the audit row, and returns which
   tenants were affected. Per `DATA-RETENTION-POLICY.md` §4.3 this is actioned
   within 5 business days.

---

## 3. Two PII stores, both erased

1. **In-memory `DataStore`** (read by `get_owner`, `search_by_owner`, and the
   recovery `EvaluationContext`). Erased via
   `@ratesassist/adapter-demo/inproc` → `eraseOwnerInproc`, which also appends
   an `erase_owner_pii` row to the in-memory hash chain.
2. **Postgres `owners` table** — **one row per tenant** a shared owner appears
   in. Erased under `withAudit` (DB-wired only) so the destruction itself
   extends the per-tenant, append-only, tamper-evident hash chain.

After erasure the service invalidates the `EvaluationContext` cache so reads
reflect the destruction immediately.

---

## 4. Permission model + the shared-owner decision (load-bearing)

Owner identifiers are **state-scoped** (`O-WA-001`), **not tenant-scoped**. A
single data subject can therefore appear across multiple councils, and in the
DB that materialises as **one `owners` row per tenant**, each holding its own
copy of the contact PII.

The right to be forgotten is a right of the **person**, not of one council, so
a full erasure must reach every tenant the subject appears in. Reaching across
tenant boundaries is a cross-tenant action. Hence:

| Subject footprint | Who may erase | Scope of erasure |
| --- | --- | --- |
| **Shared** (appears in >1 council) | **`platform_admin` only** | every tenant in the footprint |
| **Single council** | that council's **`council_admin`** (or `platform_admin`) | that one tenant only |
| Empty footprint (not visible) | non-admins get `not_found` (no enumeration oracle); `platform_admin` may still act on DB rows | — |

Gate: the `write.user_management` permission, held by `council_admin` and
`platform_admin`. A draft-only `rates_officer` is refused with `403 forbidden`.

**A `council_admin` may NEVER erase a shared owner.** Doing so would either
leak another council's contact data into the action or over-erase a record
another council remains the data controller for. The service refuses with
`forbidden` and an explicit reason. A `council_admin` is likewise refused if
the single-council owner belongs to a council other than their session tenant.

This mirrors the F-008 shared-owner contact-redaction precedent in
`app/api/owners/[ownerId]/route.ts` and the Phase-1B per-tenant-contact note
(`internal/PHASE-1B-DATA-MODEL.md`).

---

## 5. Retention carve-outs

Per `DATA-RETENTION-POLICY.md` §3, §4.3 and §7:

- **Audit log is EXEMPT.** Audit-log entries are retained for the 7-year
  statutory minimum and are never shredded by this flow — we never destroy the
  trail that proves the erasure happened.
- **The audit row carries no erased values.** For both stores the audit
  `before` records only the **field names** cleared plus a `redacted: true`
  marker; `after` records the de-identified tombstone (DB path projects the
  erasure *state* — `nameErased`, `emailErased`, … booleans — not values). An
  auditor can prove and chain-verify the erasure without the log
  re-introducing the PII that was just destroyed. **APP 11.2-clean.**
- **Statutory / regulatory holds defer, never destroy.** An in-flight rates
  dispute or an active SAT/OAIC matter suspends deletion (§7). Callers pass
  `legalHold: true`; the service returns `409 conflict`, logs
  `erasure.deferred_legal_hold`, and leaves all PII intact. Resolve the hold,
  then re-request.

---

## 6. Idempotency

A re-run on an already-tombstoned subject is a **true no-op**:

- In-memory: `eraseOwner` detects the tombstone and returns `changed: false`;
  no second audit row is appended.
- DB: an idempotency **pre-check** (plain `SELECT` of the four PII columns)
  runs before `withAudit`. If the row is absent or already tombstoned, both
  the `UPDATE` **and** the audit row are skipped — zero audit noise.

The API reports `{ erased: false, alreadyErased: true, tenantsAffected: [] }`
on a replay.

---

## 7. Audit trail

- **New action type:** `erase_owner_pii` (exported as `ERASE_ACTION`).
- **Not fail-closed** (it is not in `FAIL_CLOSED_ACTIONS`); the destruction
  succeeds even if the best-effort in-memory mirror write fails, while the
  DB path's `withAudit` keeps the row in the same transaction as the update.
- Surfaced through the existing `GET /api/audit/log` route and
  `verify_audit_chain` tool like any other mutation, so the erasure appears in
  the tamper-evident chain a privacy auditor reviews.

---

## 8. Tests

`apps/web/tests/privacy-erasure.test.ts` (11 cases, in-proc transport, no
DATABASE_URL so it exercises the in-memory store + in-memory chain):

- **(a) PII gone** from `get_owner` and `search_by_owner` (and the old name no
  longer matches a search; the property stays on the roll under `[erased]`).
- **(b) Audit recorded + chain verifies** — exactly one `erase_owner_pii` row,
  carrying no erased PII, and `verifyChain` returns `ok: true`.
- **(c) Idempotent** — second erasure reports `alreadyErased`, writes no second
  audit row, chain still verifies.
- **(d) Unauthorized refused** — no session → 401; `rates_officer` → 403;
  empty `ownerId` → 400.
- **(e) Tenant-scoping** — `council_admin` refused on shared `O-WA-001` (403,
  PII untouched); `platform_admin` succeeds across tenants (`shared: true`);
  `council_admin` of the wrong council refused on a single-council owner.
- **Legal hold** — `legalHold: true` → 409 conflict, PII intact.

---

## 9. Files

| File | Role |
| --- | --- |
| `apps/web/app/api/privacy/erasure/route.ts` | API guard (auth, validation, attribution). |
| `apps/web/lib/privacy-erasure.ts` | Service — authorise, dual-store erasure, idempotency, holds, audit. |
| `packages/adapter-demo/src/inproc.ts` | `eraseOwnerInproc` — in-memory erase + paired audit row. |
| `packages/adapter-demo/src/data/index.ts` | `DataStore.eraseOwner` + tombstone constants. |
| `apps/web/tests/privacy-erasure.test.ts` | The 11-case regression suite. |
