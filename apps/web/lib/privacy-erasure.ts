/**
 * Right-to-be-forgotten (RTBF) / right-to-erasure service.
 *
 * Implements the data-subject erasure flow that the Compliance ship-readiness
 * criterion ("RTBF flow implemented + tested") requires, under the
 * *Privacy Act 1988 (Cth)*:
 *
 *   - APP 11.2 — an entity must take reasonable steps to destroy or
 *     de-identify personal information it no longer needs.
 *   - APP 12 / 13 — access and correction; erasure is the destroy-leg.
 *
 * It is the orchestration layer above two PII stores:
 *
 *   1. The in-memory {@link DataStore} (read by `get_owner`, `search_by_owner`,
 *      and the recovery `EvaluationContext`) — erased via
 *      `@ratesassist/adapter-demo/inproc`'s `eraseOwnerInproc`.
 *   2. The Postgres `owners` table (per-tenant rows; one row PER council a
 *      shared owner appears in) — erased under `withAudit` so the destruction
 *      itself extends the tamper-evident, append-only hash chain.
 *
 * Crypto-shred shape (both stores, byte-identical):
 *   name → "[erased]", email → null, phone → null, postalAddress → "[erased]",
 *   previousOwners → []. Structural linkage (`ownerId`, property `ownerIds`,
 *   `ownerSince`) is preserved so the rates roll stays referentially intact —
 *   we de-identify, we do not orphan.
 *
 * ── Shared-owner decision (load-bearing) ────────────────────────────────────
 * Owner identifiers are STATE-scoped (`O-WA-001`), not tenant-scoped. A single
 * data subject can therefore appear across multiple councils, and in the DB
 * that materialises as one `owners` row per tenant, each holding its own copy
 * of the contact PII. So:
 *
 *   - A FULL data-subject erasure (the right to be forgotten is a right of the
 *     person, not of one council) reaches the owner in EVERY tenant they appear
 *     in. Erasing across tenant boundaries is a cross-tenant action, so it
 *     requires `platform_admin` — the only principal authorised to act on more
 *     than its own council.
 *   - A SINGLE-council owner (appears in exactly one tenant) can be erased by
 *     that council's `council_admin` (the `write.user_management` holder),
 *     scoped strictly to their own tenant.
 *   - A `council_admin` may NEVER trigger erasure of a shared owner: doing so
 *     would either leak another council's contact data into the action or
 *     over-erase a record that another council remains the data controller for.
 *     The service refuses with `forbidden` and an explicit reason.
 *
 * This mirrors the F-008 shared-owner contact-redaction precedent in
 * `app/api/owners/[ownerId]/route.ts` and the Phase-1B per-tenant-contact
 * tracking note (`internal/PHASE-1B-DATA-MODEL.md`).
 *
 * ── Retention carve-outs (Privacy Act APP 11.2 + State Records Act) ──────────
 * Per `DATA-RETENTION-POLICY.md` §3, §4.3 and §7:
 *   - Audit-log entries are retained for the 7-year statutory minimum and are
 *     EXEMPT from this erasure — we never shred the trail that proves the
 *     erasure happened. The audit row we write here records the field NAMES
 *     cleared, never the cleared values, so the log is APP-11.2-clean.
 *   - Statutory / regulatory holds (an in-flight rates dispute, an active SAT
 *     or OAIC matter) suspend deletion. Callers pass `legalHold: true` to defer
 *     with a documented conflict rather than destroy.
 *
 * Australian English throughout; do not "fix" "council", "behaviour".
 */

import { scoped } from "./logger";
import { isDbWired } from "./db";
import {
  getEvaluationContext,
  invalidateEvaluationContext,
} from "./clients";
import { tenantFromAssessmentNumber } from "./api-helpers";

const log = scoped("apps/web/privacy-erasure");

/** Canonical action string for the erasure audit row (both stores). */
export const ERASE_ACTION = "erase_owner_pii";

/** Legal basis recorded on every erasure audit row. */
export const ERASURE_LEGAL_BASIS =
  "Privacy Act 1988 (Cth) APP 11.2 — destroy/de-identify PII no longer needed";

/**
 * The slice of an authenticated principal the erasure service needs. `roles`
 * is `readonly string[]` (not `Role[]`) so it accepts `resolveRouteSession`'s
 * return shape without a cast — unknown role strings simply never match the
 * RBAC checks below.
 */
export type ErasureSession = {
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
};

export type ErasureInput = {
  /** State-scoped owner identifier, e.g. `O-WA-001`. */
  readonly ownerId: string;
  /** Resolved route session — used for RBAC + actor attribution. */
  readonly session: ErasureSession;
  /** Optional free-text legal basis / ticket reference for the audit row. */
  readonly legalBasis?: string;
  /**
   * When true the subject is under a statutory/regulatory hold; the service
   * refuses to erase and records the conflict. Mirrors policy §4.3 step 3.
   */
  readonly legalHold?: boolean;
  readonly correlationId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
};

export type ErasureOutcome =
  | {
      readonly ok: true;
      /** True when at least one store/tenant actually changed. */
      readonly erased: boolean;
      /** True when nothing changed because the subject was already erased. */
      readonly alreadyErased: boolean;
      /** Council codes whose `owners` row was reached. */
      readonly tenantsAffected: readonly string[];
      /** True when this was a cross-tenant (shared-owner) erasure. */
      readonly shared: boolean;
      readonly ownerId: string;
    }
  | {
      readonly ok: false;
      readonly code:
        | "forbidden"
        | "not_found"
        | "conflict"
        | "internal_error";
      readonly message: string;
    };

/**
 * Resolve the set of council codes a given owner appears in, from the
 * in-process evaluation context's per-owner property index. This is the
 * authoritative tenant footprint for the shared-owner decision: an owner is
 * "shared" iff they appear in more than one council.
 *
 * The context is hydrated from the DB when `isDbWired()`; in pure in-memory
 * mode it is hydrated from the seed. Either way `propertiesByOwnerId` is the
 * same index the F-008 redaction logic walks.
 */
export function tenantFootprintForOwner(ownerId: string): readonly string[] {
  const ctx = getEvaluationContext();
  const properties = ctx.propertiesByOwnerId?.get(ownerId) ?? [];
  const codes = new Set<string>();
  for (const p of properties) {
    // Prefer the property's own `council` field; fall back to the assessment
    // prefix so we stay correct even for a property missing the council tag.
    const code =
      (p as { council?: string }).council ??
      tenantFromAssessmentNumber(
        (p as { assessmentNumber: string }).assessmentNumber,
      ) ??
      undefined;
    if (code !== undefined && code !== null) codes.add(code);
  }
  return [...codes].sort();
}

/**
 * Authorise an erasure request against the shared-owner rule. Returns null when
 * permitted, or a ready-to-surface failure outcome when refused.
 *
 * Rules:
 *   - Caller must hold `write.user_management` (council_admin or
 *     platform_admin). A draft-only `rates_officer` cannot erase.
 *   - Shared owner (footprint > 1 council)  → requires `platform_admin`.
 *   - Single-council owner                  → council_admin permitted, but ONLY
 *     for their own tenant; cross-tenant single-owner erasure still needs
 *     platform_admin.
 *   - Empty footprint (owner not on any property we can see) → treated as
 *     not_found for non-admins (no enumeration oracle); platform_admin may
 *     still proceed against any DB rows.
 */
export function authoriseErasure(
  session: ErasureSession,
  footprint: readonly string[],
): Extract<ErasureOutcome, { ok: false }> | null {
  const isPlatformAdmin = session.roles.includes("platform_admin");
  const hasUserMgmt = session.roles.some(
    (r) => r === "council_admin" || r === "platform_admin",
  );
  if (!hasUserMgmt) {
    return {
      ok: false,
      code: "forbidden",
      message:
        "write.user_management is required to erase a data subject (council_admin or platform_admin).",
    };
  }
  if (isPlatformAdmin) return null;

  // council_admin path — strictly single-tenant, own tenant only.
  if (footprint.length === 0) {
    // Don't confirm/deny existence across tenants for a council admin.
    return {
      ok: false,
      code: "not_found",
      message: "No erasable owner record is visible to this council.",
    };
  }
  if (footprint.length > 1) {
    return {
      ok: false,
      code: "forbidden",
      message:
        "This data subject appears in more than one council. A full right-to-be-forgotten erasure crosses tenant boundaries and requires platform_admin; a council_admin cannot erase a shared owner.",
    };
  }
  const onlyTenant = footprint[0]!;
  if (onlyTenant !== session.tenantId) {
    return {
      ok: false,
      code: "forbidden",
      message: `Owner belongs to council ${onlyTenant}; a session bound to ${session.tenantId} cannot erase it.`,
    };
  }
  return null;
}

/**
 * Execute the erasure across both stores. Idempotent and permissioned.
 *
 * Order of operations:
 *   1. Compute tenant footprint + authorise (shared-owner rule).
 *   2. Honour any statutory hold (defer, do not destroy).
 *   3. Erase the in-memory store (+ in-memory audit row) — always, since the
 *      `EvaluationContext` reads from it.
 *   4. When `isDbWired()`, erase the `owners` row in EVERY tenant in the
 *      footprint (or the session's own tenant for the single-council case),
 *      each under `withAudit` so the destruction extends the per-tenant chain.
 *   5. Invalidate the evaluation-context cache so reads reflect the erasure.
 */
export async function eraseOwnerData(
  input: ErasureInput,
): Promise<ErasureOutcome> {
  const { ownerId, session } = input;

  const footprint = tenantFootprintForOwner(ownerId);
  const shared = footprint.length > 1;

  const denied = authoriseErasure(session, footprint);
  if (denied !== null) {
    log.warn({
      event: "erasure.denied",
      code: denied.code,
      ownerId,
      actor: session.userId,
      sessionTenant: session.tenantId,
      footprint,
    });
    return denied;
  }

  // Statutory / regulatory hold — document the conflict, defer to lawful
  // direction (policy §4.3 step 3 / §7). We do NOT destroy.
  if (input.legalHold === true) {
    log.warn({
      event: "erasure.deferred_legal_hold",
      ownerId,
      actor: session.userId,
      footprint,
    });
    return {
      ok: false,
      code: "conflict",
      message:
        "Erasure deferred: this subject is under a statutory/regulatory hold. The conflict is recorded; resolve the hold before re-requesting.",
    };
  }

  // A council_admin acting on a single-tenant owner erases only their own
  // tenant; a platform_admin erases every tenant in the footprint.
  const isPlatformAdmin = session.roles.includes("platform_admin");
  const targetTenants = isPlatformAdmin
    ? footprint
    : footprint.filter((c) => c === session.tenantId);

  const attribution = {
    tenantId: session.tenantId,
    actorId: session.userId,
    actorKind: "user" as const,
    ...(input.correlationId !== undefined
      ? { correlationId: input.correlationId }
      : {}),
    ...(input.ip !== undefined ? { ip: input.ip } : {}),
    ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
  };

  let anyChanged = false;

  // ── Store 1: in-memory DataStore (authoritative for get_owner /
  // search_by_owner / EvaluationContext). Idempotent. ──────────────────────
  try {
    const { eraseOwnerInproc } = await import(
      "@ratesassist/adapter-demo/inproc"
    );
    const memResult = eraseOwnerInproc({ ownerId, ...attribution });
    if (memResult.status === "erased") anyChanged = true;
    // "noop" → already a tombstone; "not_found" → not in the in-memory seed
    // (acceptable: the DB may still hold rows for this owner).
  } catch (e) {
    log.error({
      event: "erasure.inproc_failed",
      ownerId,
      err: e instanceof Error ? e.message : String(e),
    });
    return {
      ok: false,
      code: "internal_error",
      message: "In-memory erasure failed; no partial state was committed.",
    };
  }

  // ── Store 2: Postgres owners rows (one per tenant). DB-wired only. ───────
  const tenantsAffected: string[] = [];
  if (isDbWired() && targetTenants.length > 0) {
    try {
      const dbChanged = await eraseOwnerRowsInDb({
        ownerId,
        councilCodes: targetTenants,
        actor: attribution,
        legalBasis: input.legalBasis,
        onTenantErased: (code) => tenantsAffected.push(code),
      });
      if (dbChanged) anyChanged = true;
    } catch (e) {
      log.error({
        event: "erasure.db_failed",
        ownerId,
        err: e instanceof Error ? e.message : String(e),
      });
      return {
        ok: false,
        code: "internal_error",
        message: "Database erasure failed.",
      };
    }
  } else {
    // No DB: the in-memory footprint is the affected set.
    tenantsAffected.push(...targetTenants);
  }

  // Reads must reflect the erasure immediately.
  await Promise.resolve(invalidateEvaluationContext());

  log.info({
    event: "erasure.ok",
    ownerId,
    actor: session.userId,
    shared,
    tenantsAffected,
    changed: anyChanged,
    legalBasis: input.legalBasis ?? ERASURE_LEGAL_BASIS,
  });

  return {
    ok: true,
    erased: anyChanged,
    alreadyErased: !anyChanged,
    tenantsAffected,
    shared,
    ownerId,
  };
}

/**
 * Erase the `owners` row for `ownerId` in each named council, under
 * {@link withAudit} so the destruction extends the tenant's tamper-evident
 * chain. The audit `before`/`after` snapshots are produced by `target.read`,
 * which projects ONLY the field names being cleared plus the resulting
 * tombstone — never the cleared PII values (APP 11.2: the log must not
 * re-introduce what was destroyed).
 *
 * Idempotent: we first read the row's erasure state and SKIP both the UPDATE
 * and the audit row entirely when it is already a tombstone, so a retried RTBF
 * request adds no audit noise and reports zero tenants affected. Returns true
 * when at least one row was changed.
 */
async function eraseOwnerRowsInDb(args: {
  readonly ownerId: string;
  readonly councilCodes: readonly string[];
  readonly actor: {
    readonly tenantId: string;
    readonly actorId: string;
    readonly actorKind: "user" | "service" | "llm";
    readonly correlationId?: string;
    readonly ip?: string;
    readonly userAgent?: string;
  };
  readonly legalBasis?: string;
  readonly onTenantErased: (code: string) => void;
}): Promise<boolean> {
  const { getWebDb } = await import("./db");
  const {
    eq,
    and,
    owners: ownersTable,
    tenants: tenantsTable,
    withAudit,
  } = await import("@ratesassist/db");
  const { ERASURE_NAME_TOMBSTONE, ERASURE_ADDRESS_TOMBSTONE } = await import(
    "@ratesassist/adapter-demo/data"
  );
  const db = await getWebDb();

  let anyChanged = false;

  for (const code of args.councilCodes) {
    const tenant = (
      await db
        .select({ id: tenantsTable.id })
        .from(tenantsTable)
        .where(eq(tenantsTable.code, code))
        .limit(1)
    )[0];
    if (tenant === undefined) {
      // No such tenant in the DB — skip; the in-memory store already handled
      // the footprint, and we never want to fail-closed on a stale code.
      continue;
    }
    const tenantId = tenant.id;

    // Idempotency pre-check: is this row already tombstoned, or absent? If so,
    // skip the UPDATE *and* the audit row so a re-run is a true no-op.
    const existing = (
      await db
        .select({
          name: ownersTable.name,
          email: ownersTable.email,
          phone: ownersTable.phone,
          postalAddress: ownersTable.postalAddress,
        })
        .from(ownersTable)
        .where(
          and(
            eq(ownersTable.tenantId, tenantId),
            eq(ownersTable.ownerExtId, args.ownerId),
          ),
        )
        .limit(1)
    )[0];
    if (existing === undefined) continue; // owner not in this tenant
    const alreadyTombstoned =
      existing.name === ERASURE_NAME_TOMBSTONE &&
      existing.email === null &&
      existing.phone === null &&
      existing.postalAddress === ERASURE_ADDRESS_TOMBSTONE;
    if (alreadyTombstoned) continue; // idempotent no-op — no audit row

    // Project ONLY the cleared-field names for the audit before/after — the
    // hash chain protects this projection, and it carries no erased values.
    const readProjection = async (tx: import("@ratesassist/db").Db) => {
      const row = (
        await tx
          .select({
            id: ownersTable.id,
            name: ownersTable.name,
            email: ownersTable.email,
            phone: ownersTable.phone,
            postalAddress: ownersTable.postalAddress,
          })
          .from(ownersTable)
          .where(
            and(
              eq(ownersTable.tenantId, tenantId),
              eq(ownersTable.ownerExtId, args.ownerId),
            ),
          )
          .limit(1)
      )[0];
      if (row === undefined) return null;
      // Report erasure STATE, not the values: whether each PII field is still
      // populated (true) or already shredded (false).
      return {
        ownerExtId: args.ownerId,
        redacted: true,
        nameErased: row.name === ERASURE_NAME_TOMBSTONE,
        emailErased: row.email === null,
        phoneErased: row.phone === null,
        postalAddressErased: row.postalAddress === ERASURE_ADDRESS_TOMBSTONE,
      };
    };

    // The idempotency pre-check above proved exactly one live, non-tombstoned
    // row matches (tenantId, ownerExtId), so the UPDATE inside withAudit
    // changes precisely that row. We therefore count this tenant as affected
    // without relying on a `.returning()` row count (which drizzle's union Db
    // type does not expose uniformly across pg / pglite).
    let rowChangedThisTenant = false;
    await withAudit(
      db,
      {
        tenantId,
        actorId: args.actor.actorId,
        actorKind: args.actor.actorKind,
        ...(args.actor.correlationId !== undefined
          ? { correlationId: args.actor.correlationId }
          : {}),
        ...(args.actor.ip !== undefined ? { ip: args.actor.ip } : {}),
        ...(args.actor.userAgent !== undefined
          ? { userAgent: args.actor.userAgent }
          : {}),
      },
      ERASE_ACTION,
      {
        type: "owner",
        id: args.ownerId,
        read: readProjection,
      },
      async (tx) => {
        await tx
          .update(ownersTable)
          .set({
            name: ERASURE_NAME_TOMBSTONE,
            email: null,
            phone: null,
            postalAddress: ERASURE_ADDRESS_TOMBSTONE,
            previousOwners: [],
          })
          .where(
            and(
              eq(ownersTable.tenantId, tenantId),
              eq(ownersTable.ownerExtId, args.ownerId),
            ),
          );
        rowChangedThisTenant = true;
      },
    );

    if (rowChangedThisTenant) {
      anyChanged = true;
      args.onTenantErased(code);
    }
  }

  return anyChanged;
}
