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
 * Parse RA_DEV_AUTOLOGIN_SESSION env. Format: JSON object matching
 * StubSessionInput, OR the literal string "default" for the demo principal.
 *
 * Returns null in production OR when the env var is unset OR malformed.
 * Never throws — autologin is a convenience, not a security mechanism.
 */
export function parseDevAutologin(): StubSessionInput | null {
  if (process.env.NODE_ENV === "production") return null;
  const raw = process.env["RA_DEV_AUTOLOGIN_SESSION"];
  if (!raw) return null;
  if (raw === "default" || raw === "1" || raw === "true") return {};
  // Role-name shortcut: `RA_DEV_AUTOLOGIN_SESSION=council_admin` mints a
  // default principal elevated to that role. Convenient for smoke tests
  // exercising RBAC-gated endpoints without crafting a JSON blob.
  if (ALL_ROLES.includes(raw as Role)) {
    return { roles: [raw as Role] };
  }
  try {
    const parsed = JSON.parse(raw) as StubSessionInput;
    if (parsed.roles && !parsed.roles.every((r) => ALL_ROLES.includes(r))) {
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
