/**
 * @ratesassist/contract — Auth & RBAC
 *
 * Roles, permissions, and the RBAC matrix that every consumer (web, adapters,
 * future workers) reads from. The matrix is the single source of truth — do
 * not duplicate role-permission checks anywhere else.
 *
 * Stability: changing role/permission shapes is a breaking change. Add new
 * permissions additively; never repurpose an existing one.
 */

/** Role granted to a session principal. */
export type Role =
  | "ratepayer" // citizen-facing; read-only public data
  | "rates_officer" // council clerk; read all + draft mutations
  | "rates_supervisor" // approve mutations; commit two-phase tokens
  | "council_admin" // tenant admin; manage users
  | "platform_admin"; // RatesAssist staff; cross-tenant audit access

/** Permissions are referenced by string in route handlers. */
export type Permission =
  | "read.public"
  | "read.tenant_data"
  | "read.audit_log"
  | "write.draft_mutation"
  | "write.commit_mutation"
  | "write.user_management"
  | "write.platform_admin";

const supervisorPerms: ReadonlyArray<Permission> = [
  "read.public",
  "read.tenant_data",
  "write.draft_mutation",
  "write.commit_mutation",
  "read.audit_log",
];

const councilAdminPerms: ReadonlyArray<Permission> = [
  ...supervisorPerms,
  "write.user_management",
];

const platformAdminPerms: ReadonlyArray<Permission> = [
  ...councilAdminPerms,
  "write.platform_admin",
];

/**
 * RBAC matrix. Each role lists the permissions it grants. Lookups are O(N)
 * over a small list, which is fine — checks are not on a hot path.
 */
export const RBAC: Readonly<Record<Role, ReadonlyArray<Permission>>> = {
  ratepayer: ["read.public"],
  rates_officer: ["read.public", "read.tenant_data", "write.draft_mutation"],
  rates_supervisor: supervisorPerms,
  council_admin: councilAdminPerms,
  platform_admin: platformAdminPerms,
} as const;

/** All known roles in display order. Useful for dev login picker. */
export const ALL_ROLES: ReadonlyArray<Role> = [
  "ratepayer",
  "rates_officer",
  "rates_supervisor",
  "council_admin",
  "platform_admin",
];

/** Authenticated session payload. Signed and round-tripped via cookie/JWT-lite. */
export type Session = {
  /** Stable principal id (subject). */
  userId: string;
  email: string;
  displayName: string;
  /** Council/tenant code, e.g. "TPS" (Town of Port Stephens demo). */
  tenantId: string;
  roles: ReadonlyArray<Role>;
  /** ISO-8601 expiry. Verifier rejects after this instant. */
  expiresAt: string;
  /** ISO-8601 issuance. */
  issuedAt: string;
  /**
   * Phase 4+: SSO claims pass-through, MFA timestamp, tenant entitlements.
   * Free-form for now; extend the type before consuming.
   */
  ssoClaims?: Readonly<Record<string, unknown>>;
  mfaAt?: string;
};

/** True if any of the roles grants the permission. */
export function roleHasPermission(role: Role, perm: Permission): boolean {
  return RBAC[role].includes(perm);
}
