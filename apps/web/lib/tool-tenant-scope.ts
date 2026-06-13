/**
 * Tenant + RBAC scoping for the chat tool-dispatch surface.
 *
 * Background
 * ----------
 * Every REST route in `apps/web/app/api/**` scopes tool calls to the caller's
 * tenant (and enforces RBAC) before reaching the adapter. The chat surface
 * (`/api/chat` → `runChat` → `runTool`) historically did NOT: it was
 * authenticated but unscoped, so the LLM could call e.g. `list_councils` or
 * `get_property_detail` with another council's identifiers and the adapter —
 * which holds every council's data globally — would happily answer. That is a
 * cross-tenant READ IDOR (and, for the mutation tools, a privilege-escalation
 * vector: a `rates_officer` could reach supervisor/admin-only tools through
 * chat that the REST layer gates).
 *
 * Design
 * ------
 * `applyToolScope(name, input, scope)` is the single chokepoint. For every one
 * of the 33 catalogue tools there is an explicit policy that does two things,
 * mirroring the REST layer EXACTLY so chat can't be used to bypass the REST
 * security contract:
 *
 *   1. RBAC gate — the same permission the tool's REST counterpart requires
 *      (`read.tenant_data`, `write.draft_mutation`, `write.commit_mutation`,
 *      `write.user_management`, `read.audit_log`, or the universal
 *      `read.public`).
 *   2. Tenant scope — either force-inject the caller's `council`/`tenantId`
 *      into the input (READ filters + audit), or refuse cross-tenant
 *      identifiers (assessment / owner / council-write tools).
 *
 * Correct-by-construction:
 *   - `POLICY` is typed `Record<ToolName, PolicyFn>`, so adding a tool to the
 *     contract without a policy entry is a COMPILE error.
 *   - `applyToolScope` fails CLOSED on the runtime string path: an unknown
 *     tool name in a scoped session is denied, never dispatched.
 *   - Refusals on read paths are masked as `not_found` (not `forbidden`) so
 *     the surface can't be an enumeration oracle for which identifiers exist
 *     on other tenants — identical to the REST routes.
 *
 * `platform_admin` bypasses tenant scoping (legitimate cross-tenant support /
 * audit) but still flows through the permission gates (admins hold every
 * permission, so every gate allows).
 *
 * Australian-English notes are deliberate; don't "fix" "council", "behaviour".
 */

import {
  RBAC,
  roleHasPermission,
  type Permission,
  type Role,
  type ToolName,
} from "@ratesassist/contract";

import {
  sessionMayAccessTenant,
  tenantFromAssessmentNumber,
} from "./api-helpers";
import { getEvaluationContext } from "./clients";

/**
 * The minimal slice of a session the scoping layer needs. `roles` is
 * `readonly string[]` (not `Role[]`) so it accepts `resolveRouteSession`'s
 * return shape without a cast; unknown role strings are filtered by
 * {@link roleIsKnown} before any RBAC lookup.
 */
export type ToolScope = {
  readonly tenantId: string;
  readonly roles: readonly string[];
};

/** A post-dispatch view of a successful tool result, for redaction transforms. */
export type ScopedResultView = {
  readonly output: string;
  readonly data?: unknown;
};

/**
 * The decision for a single tool call.
 *  - `allow`: dispatch with `input` (possibly rewritten). If `transformResult`
 *    is present it is applied to the SUCCESSFUL result (output + data) before
 *    it is returned — used for shared-owner contact redaction.
 *  - `deny`: do not dispatch; surface `{ code, message }` as a tool error.
 */
export type ToolScopeOutcome =
  | {
      readonly action: "allow";
      readonly input: Record<string, unknown>;
      readonly transformResult?: (r: ScopedResultView) => ScopedResultView;
    }
  | {
      readonly action: "deny";
      readonly code: "forbidden" | "not_found" | "unauthorized";
      readonly message: string;
    };

type PolicyFn = (
  input: Record<string, unknown>,
  scope: ToolScope,
) => ToolScopeOutcome;

// ===== helpers =====

function isAdmin(scope: ToolScope): boolean {
  return scope.roles.includes("platform_admin");
}

/** Type-guard: is this string a known role key in the RBAC matrix? */
function roleIsKnown(r: string): r is Role {
  return Object.prototype.hasOwnProperty.call(RBAC, r);
}

/** True if ANY of the scope's roles grants `perm`. Unknown roles are ignored. */
function hasPermission(scope: ToolScope, perm: Permission): boolean {
  return scope.roles.some((r) => roleIsKnown(r) && roleHasPermission(r, perm));
}

function allow(
  input: Record<string, unknown>,
  transformResult?: (r: ScopedResultView) => ScopedResultView,
): ToolScopeOutcome {
  return transformResult !== undefined
    ? { action: "allow", input, transformResult }
    : { action: "allow", input };
}

function deny(
  code: "forbidden" | "not_found" | "unauthorized",
  message: string,
): ToolScopeOutcome {
  return { action: "deny", code, message };
}

function stringField(
  input: Record<string, unknown>,
  field: string,
): string | undefined {
  const v = input[field];
  return typeof v === "string" ? v : undefined;
}

// ===== shared-owner contact redaction (mirrors F-008 on /api/owners/[ownerId]) =====

const SHARED_OWNER_REASON = "shared_owner_cross_tenant";
const REDACTION_PLACEHOLDER = "[redacted — shared owner across councils]";

/**
 * Redact contact PII from a `get_owner` result when the owner spans multiple
 * tenants. Strips email / phone / mobilePhone / postalAddress from BOTH the
 * structured `data.owner` payload AND the LLM-facing `output` narration (any
 * literal PII value is scrubbed out of the text). Name, ABN and ownerSince are
 * retained — they are not contact PII. Correct-by-construction: no PII value
 * present in the result survives, regardless of the handler's text format.
 */
function redactOwnerContact(view: ScopedResultView): ScopedResultView {
  const data = view.data;
  if (typeof data !== "object" || data === null) return view;
  const root = data as Record<string, unknown>;
  const owner = root["owner"];
  if (typeof owner !== "object" || owner === null) return view;
  const o = owner as Record<string, unknown>;

  const piiFields = ["email", "phone", "mobilePhone", "postalAddress"] as const;
  const piiValues: string[] = [];
  for (const f of piiFields) {
    const v = o[f];
    if (typeof v === "string" && v.length > 0) piiValues.push(v);
  }

  const redactedOwner: Record<string, unknown> = {
    ...o,
    email: undefined,
    phone: undefined,
    mobilePhone: undefined,
    postalAddress: undefined,
    contactRedacted: true,
    contactRedactedReason: SHARED_OWNER_REASON,
  };

  // Scrub any literal PII value out of the narration (split/join avoids the
  // es2021 String.replaceAll lib requirement and handles all occurrences).
  let output = view.output;
  for (const v of piiValues) {
    output = output.split(v).join(REDACTION_PLACEHOLDER);
  }

  return { output, data: { ...root, owner: redactedOwner } };
}

// ===== policy factories =====

/**
 * READ tool that accepts a `council` filter. Force-inject the caller's tenant
 * so the handler can only ever return the caller's own council rows. Admins
 * pass through unmodified (legitimate cross-tenant read). Gated by `perm`.
 */
function injectCouncil(perm: Permission): PolicyFn {
  return (input, scope) => {
    if (!hasPermission(scope, perm)) {
      return deny("forbidden", `${perm} permission required.`);
    }
    if (isAdmin(scope)) return allow(input);
    return allow({ ...input, council: scope.tenantId });
  };
}

/**
 * Audit tools — force-inject the caller's `tenantId`; require `read.audit_log`.
 * Mirrors /api/audit/log + /api/audit/verify-chain (supervisor and above;
 * cross-tenant requires platform_admin).
 */
function injectAuditTenant(): PolicyFn {
  return (input, scope) => {
    if (!hasPermission(scope, "read.audit_log")) {
      return deny("forbidden", "read.audit_log permission required.");
    }
    if (isAdmin(scope)) return allow(input);
    return allow({ ...input, tenantId: scope.tenantId });
  };
}

/**
 * Tools keyed by an assessment number. Refuse cross-tenant access by comparing
 * the assessment's tenant prefix to the caller's tenant. Masked as `not_found`
 * so the surface can't be an enumeration oracle (mirrors /api/strata,
 * /api/notify and the `[assessmentNumber]` read routes).
 */
function assessmentGuard(field: string, perm: Permission): PolicyFn {
  return (input, scope) => {
    if (!hasPermission(scope, perm)) {
      return deny("forbidden", `${perm} permission required.`);
    }
    if (isAdmin(scope)) return allow(input);
    const value = stringField(input, field);
    // Absent / non-string → let the contract's Zod schema produce the
    // canonical invalid_input error rather than masking it as not_found here.
    if (value === undefined) return allow(input);
    if (sessionMayAccessTenant(scope, tenantFromAssessmentNumber(value))) {
      return allow(input);
    }
    return deny(
      "not_found",
      `No record found for assessment ${JSON.stringify(value)}.`,
    );
  };
}

/**
 * Owner tools. An owner can hold property across multiple councils (the
 * shared-owner data model). Access is granted iff the owner's property
 * portfolio intersects the caller's tenant.
 *
 * `whenShared` decides what happens when the portfolio spans MORE THAN ONE
 * tenant and the caller is not a `platform_admin` (which bypasses above):
 *
 *   - "allow"  — dispatch unchanged. The tool exposes nothing tenant-private,
 *                so sharing is irrelevant to it.
 *   - "redact" — dispatch, then strip contact PII from the result so council A
 *                never sees council B's contact details for a co-held owner
 *                (mirrors F-008 on `/api/owners/[ownerId]`). Reads use this.
 *   - "deny"   — refuse (MT-04). A single council's clerk must not silently
 *                mutate contact details that ANOTHER council also relies on:
 *                the owner row is shared state, and an uncoordinated cross-
 *                council edit is both a data-integrity and a privacy hazard.
 *                Writes use this. The denial is `forbidden` (not the usual
 *                `not_found` mask) because the caller can already SEE this
 *                owner within their own council — the read path even returns
 *                `contactRedactedReason: "shared_owner_cross_tenant"` for it —
 *                so an honest, actionable refusal leaks nothing new. Only a
 *                `platform_admin` may edit a cross-council owner until per-
 *                council contact records land (Phase 6). The genuine
 *                cross-tenant case (owner the caller can't see at all) is
 *                still masked `not_found` below, before this branch.
 */
function ownerGuard(opts: {
  whenShared: "allow" | "redact" | "deny";
  perm: Permission;
}): PolicyFn {
  return (input, scope) => {
    if (!hasPermission(scope, opts.perm)) {
      return deny("forbidden", `${opts.perm} permission required.`);
    }
    if (isAdmin(scope)) return allow(input);
    const ownerId = stringField(input, "ownerId");
    if (ownerId === undefined) return allow(input); // Zod handles missing field

    // `propertiesByOwnerId` is an optional O(1) index on EvaluationContext.
    // The sync in-memory builder always populates it, but fall back to a
    // linear scan (mirroring the recovery engine's own pattern) so a
    // context that omits the index never silently denies every owner read.
    const evalCtx = getEvaluationContext();
    const portfolio =
      evalCtx.propertiesByOwnerId?.get(ownerId) ??
      evalCtx.properties.filter((p) => p.ownerIds.includes(ownerId));
    const accessible = portfolio.some((p) =>
      sessionMayAccessTenant(scope, tenantFromAssessmentNumber(p.assessmentNumber)),
    );
    if (!accessible) {
      // Reuse the handler's genuine not_found wording verbatim so a
      // cross-tenant probe is indistinguishable from a genuine miss.
      return deny("not_found", `No owner with id "${ownerId}".`);
    }
    if (opts.whenShared !== "allow") {
      const tenants = new Set(
        portfolio
          .map((p) => tenantFromAssessmentNumber(p.assessmentNumber))
          .filter((t): t is string => t !== null),
      );
      if (tenants.size > 1) {
        if (opts.whenShared === "deny") {
          return deny(
            "forbidden",
            `Owner "${ownerId}" holds property across multiple councils; ` +
              `cross-council contact changes require a platform administrator.`,
          );
        }
        return allow(input, redactOwnerContact); // "redact"
      }
    }
    return allow(input);
  };
}

/**
 * Council-write tools (the data-import family). Mirror
 * `assertSessionMayWriteCouncil`: require `write.user_management` AND
 * `councilCode === caller tenant` (admins bypass). Explicit `forbidden` on
 * mismatch — the caller already named the council, so there's nothing to leak,
 * and an operator hand-fixing a misrouted import deserves an honest error.
 */
function councilWriteGuard(field: string, perm: Permission): PolicyFn {
  return (input, scope) => {
    if (!hasPermission(scope, perm)) {
      return deny("forbidden", `${perm} permission required.`);
    }
    if (isAdmin(scope)) return allow(input);
    const value = stringField(input, field);
    if (value === undefined) return allow(input); // Zod handles missing field
    if (value !== scope.tenantId) {
      return deny(
        "forbidden",
        `Cannot write to council ${value} from a session bound to ${scope.tenantId}.`,
      );
    }
    return allow(input);
  };
}

/** Permission gate only — no tenant dimension (e.g. add_council creates a tenant). */
function requirePermission(perm: Permission): PolicyFn {
  return (input, scope) => {
    if (!hasPermission(scope, perm)) {
      return deny("forbidden", `${perm} permission required.`);
    }
    return allow(input);
  };
}

/**
 * Genuinely public catalogue data (DMIRS/MINEDEX tenements, ABR lookups,
 * public land-use). `read.public` is granted to every authenticated role, and
 * these tools expose no council-private data, so they always allow.
 */
function publicTool(): PolicyFn {
  return (input) => allow(input);
}

// ===== the policy table (exhaustive over the 33-tool catalogue) =====

const POLICY: Record<ToolName, PolicyFn> = {
  // --- READ: council-filtered (read.tenant_data) ---
  search_property: injectCouncil("read.tenant_data"),
  search_by_owner: injectCouncil("read.tenant_data"),
  list_overdue: injectCouncil("read.tenant_data"),
  list_properties: injectCouncil("read.tenant_data"),
  list_councils: injectCouncil("read.tenant_data"),
  find_mining_mismatches: injectCouncil("read.tenant_data"),
  recovery_summary: injectCouncil("read.tenant_data"),
  daily_briefing: injectCouncil("read.tenant_data"),
  get_grant_detail: injectCouncil("read.tenant_data"),
  list_address_discrepancies: injectCouncil("read.tenant_data"),

  // --- READ: assessment-keyed (read.tenant_data) ---
  get_property_detail: assessmentGuard("assessmentNumber", "read.tenant_data"),
  get_transaction_history: assessmentGuard("assessmentNumber", "read.tenant_data"),
  get_tenement_for_property: assessmentGuard("assessmentNumber", "read.tenant_data"),
  generate_statutory_certificate: assessmentGuard("assessmentNumber", "read.tenant_data"),
  generate_evidence_pack: assessmentGuard("assessmentNumber", "read.tenant_data"),

  // --- READ: owner-keyed (read.tenant_data; redact shared-owner contact) ---
  get_owner: ownerGuard({ whenShared: "redact", perm: "read.tenant_data" }),

  // --- WRITE: draft mutations (write.draft_mutation) ---
  draft_payment_reminder: assessmentGuard("assessmentNumber", "write.draft_mutation"),
  add_property_note: assessmentGuard("assessmentNumber", "write.draft_mutation"),
  draft_chase_all_overdue: injectCouncil("write.draft_mutation"),
  notify_clerk: assessmentGuard("candidateAssessmentNumber", "write.draft_mutation"),
  update_owner_contact: ownerGuard({ whenShared: "deny", perm: "write.draft_mutation" }),

  // --- WRITE: commit mutation (write.commit_mutation) ---
  request_strata_conversion: assessmentGuard("parentAssessmentNumber", "write.commit_mutation"),

  // --- WRITE: council data import (write.user_management) ---
  import_rating_roll: councilWriteGuard("councilCode", "write.user_management"),
  import_rate_schedule: councilWriteGuard("councilCode", "write.user_management"),
  import_landgate_title_data: councilWriteGuard("councilCode", "write.user_management"),
  import_wc_eligibility: councilWriteGuard("councilCode", "write.user_management"),
  add_council: requirePermission("write.user_management"),

  // --- AUDIT (read.audit_log) ---
  list_audit_log: injectAuditTenant(),
  verify_audit_chain: injectAuditTenant(),

  // --- PUBLIC catalogue (read.public — universal) ---
  verify_abn: publicTool(),
  list_recent_grants: publicTool(),
  list_lag_window_candidates: publicTool(),
  list_environmental_approvals: publicTool(),
};

/**
 * Apply the tenant + RBAC policy for `name` under `scope`. Fails CLOSED: a
 * tool name with no policy entry is denied (never dispatched) in a scoped
 * session. The compile-time `Record<ToolName, …>` guarantees every catalogue
 * tool has an entry; this runtime guard covers the untyped string path.
 */
export function applyToolScope(
  name: string,
  input: Record<string, unknown>,
  scope: ToolScope,
): ToolScopeOutcome {
  const policy = (POLICY as Record<string, PolicyFn | undefined>)[name];
  if (policy === undefined) {
    return deny(
      "forbidden",
      `Tool "${name}" is not available in a tenant-scoped session.`,
    );
  }
  return policy(input, scope);
}

/**
 * Every catalogue tool that has a scope policy. Used by the CI completeness
 * test to assert no tool is silently missing a policy.
 */
export function scopedToolNames(): readonly string[] {
  return Object.keys(POLICY);
}
