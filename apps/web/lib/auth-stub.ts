/**
 * Dev/demo stub auth provider.
 *
 * Issues real HMAC-signed sessions (same wire format as production will use)
 * but with the principal chosen by the caller rather than by an SSO IdP.
 *
 * The stub is the ONLY way to get a session in dev until WorkOS / Microsoft
 * Entra is wired up in Phase 4. The signature is grade-A — anyone tampering
 * with the cookie still fails verification, even in dev. The "stub-ness"
 * is purely about how the principal gets chosen, not about the crypto.
 *
 * Production safety: the autologin + dev login routes refuse to operate
 * when NODE_ENV === "production". Only `issueStubSession` is callable in
 * prod (and only by the SSO callback once it lands in Phase 4).
 */

import {
  type Role,
  type Session,
  ALL_ROLES,
} from "@ratesassist/contract";
import {
  DEFAULT_SESSION_TTL_MS,
  signSessionToken,
} from "./auth.js";

export type StubSessionInput = {
  userId?: string;
  email?: string;
  displayName?: string;
  tenantId?: string;
  roles?: ReadonlyArray<Role>;
  ttlMs?: number;
};

/**
 * Default demo principal for the Tom Price Shire (TPS) tenant — matches the
 * adapter-demo's seed data.
 */
const DEMO_DEFAULTS = {
  userId: "demo-officer",
  email: "officer@tomprice.wa.gov.au",
  displayName: "Demo Rates Officer",
  tenantId: "TPS",
  roles: ["rates_officer"] as ReadonlyArray<Role>,
} as const;

/**
 * Issue a signed session token. Used by:
 *   - /api/auth/login (dev)
 *   - the optional RA_DEV_AUTOLOGIN_SESSION middleware path
 *   - tests
 *   - (future) the SSO callback
 */
export async function issueStubSession(
  input: StubSessionInput = {},
): Promise<{ session: Session; token: string }> {
  const now = Date.now();
  const ttl = input.ttlMs ?? DEFAULT_SESSION_TTL_MS;

  const session: Session = {
    userId: input.userId ?? DEMO_DEFAULTS.userId,
    email: input.email ?? DEMO_DEFAULTS.email,
    displayName: input.displayName ?? DEMO_DEFAULTS.displayName,
    tenantId: input.tenantId ?? DEMO_DEFAULTS.tenantId,
    roles: input.roles ?? DEMO_DEFAULTS.roles,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
  };

  const token = await signSessionToken(session);
  return { session, token };
}

/**
 * Roles autologin is allowed to mint.
 *
 * F-003 (pen-test, ship-ready iteration 1) surfaced that the original
 * role-name shortcut + the prod escape hatch (`RA_DEMO_AUTOLOGIN=1`)
 * let any unauthenticated visitor acquire a signed `platform_admin`
 * cookie on the council-CFO demo URL. That collapses every downstream
 * tenant-boundary check because the principal IS the highest authority
 * on the platform.
 *
 * Mitigation is structural: autologin can ONLY mint these two non-
 * administrative roles. council_admin / platform_admin / auditor are
 * rejected and fall through to "no session", forcing SSO. Smoke tests
 * that need elevated roles must run in non-prod and must explicitly
 * call `issueStubSession({ roles: [...] })` from server-side code that
 * has its own auth gate.
 */
const AUTOLOGIN_ALLOWED_ROLES: ReadonlyArray<Role> = [
  "rates_officer",
  "ratepayer",
];

function isAutologinAllowedRole(r: Role): boolean {
  return AUTOLOGIN_ALLOWED_ROLES.includes(r);
}

/**
 * Parse RA_DEV_AUTOLOGIN_SESSION env. Format: JSON object matching
 * StubSessionInput, OR the literal string "default" for the demo principal.
 *
 * Returns null in production OR when the env var is unset OR malformed
 * OR when any requested role exceeds {@link AUTOLOGIN_ALLOWED_ROLES}.
 * Never throws — autologin is a convenience, not a security mechanism.
 */
export function parseDevAutologin(): StubSessionInput | null {
  // Autologin is a convenience for local dev. In production it's refused
  // unless RA_DEMO_AUTOLOGIN=1 is explicitly set on the deploy — this is
  // the escape hatch for council-CFO demo deployments where SSO isn't
  // wired yet. Every UI surface still shows the autologin source via
  // /api/me, so it's never a silent capability.
  if (
    process.env.NODE_ENV === "production" &&
    process.env["RA_DEMO_AUTOLOGIN"] !== "1"
  ) {
    return null;
  }
  const raw = process.env["RA_DEV_AUTOLOGIN_SESSION"];
  if (!raw) return null;
  if (raw === "default" || raw === "1" || raw === "true") return {};
  // Role-name shortcut: only non-administrative roles are accepted. A
  // value of `council_admin`/`platform_admin`/`auditor` here is treated
  // as a misconfiguration and yields null — the request continues
  // without a session and the user sees the SSO redirect.
  if (ALL_ROLES.includes(raw as Role)) {
    const r = raw as Role;
    if (!isAutologinAllowedRole(r)) return null;
    return { roles: [r] };
  }
  try {
    const parsed = JSON.parse(raw) as StubSessionInput;
    if (parsed.roles) {
      // Catching a single privileged role kills the entire autologin —
      // we refuse partial fulfilment because the operator most likely
      // intended the elevated session.
      if (!parsed.roles.every((r) => ALL_ROLES.includes(r))) return null;
      if (!parsed.roles.every(isAutologinAllowedRole)) return null;
    }
    // ship-ready iter3 (Q4 case f): the council code-review surfaced
    // that a JSON blob carrying ONLY `{tenantId: "KAL"}` (no role
    // field) would happily mint a rates_officer session bound to a
    // FOREIGN tenant — the env was a fully open cross-tenant lever.
    // In production-demo mode (`RA_DEMO_AUTOLOGIN=1`) this is a
    // standing capability for anyone with deploy-env access to
    // impersonate a clerk in ANY tenant they like.
    //
    // We now refuse autologin entirely when the env tries to set a
    // tenantId that doesn't match the DEMO_DEFAULTS tenant. The
    // demo principal is hardcoded to `TPS` for the council-CFO
    // walkthrough; operators who need to demo a different tenant
    // must change `DEMO_DEFAULTS` in source (visible diff, code
    // review, audit trail), not flip an env var.
    if (
      parsed.tenantId !== undefined &&
      parsed.tenantId !== DEMO_DEFAULTS.tenantId
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Dev-mode check for routes that should 501 in production. */
export function isProductionMode(): boolean {
  return process.env.NODE_ENV === "production";
}
