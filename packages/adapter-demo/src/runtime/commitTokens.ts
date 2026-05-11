/**
 * Server-issued commit tokens for two-phase mutating tools.
 *
 * Mutating tools (`update_owner_contact`, `add_property_note`) follow a
 * preview-then-confirm pattern:
 *
 *   1. First call (`confirm: false`) validates the change, records what it
 *      WOULD do, and returns the human-readable preview plus a server-issued
 *      `commitToken`.
 *   2. Second call (`confirm: true`) MUST present the matching token; the
 *      handler then applies the recorded change and consumes the token.
 *
 * Tokens are:
 *   - Single-use (consumed on success).
 *   - Time-limited ({@link COMMIT_TOKEN_TTL_MS}, default 5 minutes).
 *   - Bound to the operation kind, target id, and a structural payload hash
 *     so a client cannot reuse a token issued for owner X to mutate owner Y.
 *   - Cryptographically random ({@link crypto.randomUUID}).
 *
 * The store is in-memory and per-process. Production adapters with multiple
 * replicas need a shared store (Redis with TTL, or signed tokens that are
 * stateless and carry their own expiry); the API surface stays the same.
 */

import { randomUUID } from "node:crypto";

/** Token time-to-live in milliseconds. */
export const COMMIT_TOKEN_TTL_MS = 5 * 60 * 1_000;

/**
 * Operation kind a token is bound to. Keeps tokens issued for one tool from
 * being replayed against a different one.
 */
export type CommitOperation =
  | "update_owner_contact"
  | "add_property_note"
  | "add_council";

/**
 * A pending mutation captured at preview time. The dispatcher uses this to
 * apply the exact same change at confirm time, even if the client's confirm
 * call arrives with stale/different parameters — the source of truth is the
 * preview, not the client's resend.
 */
export type PendingMutation =
  | {
      readonly operation: "update_owner_contact";
      readonly ownerId: string;
      readonly newPhone?: string;
      readonly newEmail?: string;
    }
  | {
      readonly operation: "add_property_note";
      readonly assessmentNumber: string;
      readonly note: string;
    }
  | {
      readonly operation: "add_council";
      readonly code: string;
      readonly name: string;
      readonly state:
        | "WA"
        | "NSW"
        | "QLD"
        | "VIC"
        | "SA"
        | "TAS"
        | "ACT"
        | "NT";
      readonly centerLat: number;
      readonly centerLng: number;
      readonly population: number;
      readonly rateableProperties: number;
      readonly rateRevenue: number;
    };

/**
 * Stored token entry. Held in {@link CommitTokenStore} until consumed or
 * expired. The expiry is wall-clock based; use a stable `now` injection at
 * call sites to avoid surprises in tests.
 */
type TokenEntry = {
  readonly token: string;
  readonly mutation: PendingMutation;
  readonly expiresAtMs: number;
};

/**
 * In-memory token store. Process-local — see file-level docstring for the
 * upgrade path to multi-replica deployments.
 */
export class CommitTokenStore {
  private readonly entries: Map<string, TokenEntry>;
  private readonly nowMs: () => number;
  private readonly ttlMs: number;

  /**
   * Construct a store. Inject `nowMs` for deterministic tests; defaults to
   * `Date.now`. `ttlMs` defaults to {@link COMMIT_TOKEN_TTL_MS}.
   */
  public constructor(
    nowMs: () => number = () => Date.now(),
    ttlMs: number = COMMIT_TOKEN_TTL_MS,
  ) {
    this.entries = new Map();
    this.nowMs = nowMs;
    this.ttlMs = ttlMs;
  }

  /**
   * Issue a new token for the given mutation. Returns the token string.
   * The mutation snapshot is captured by reference; callers must not mutate
   * the object after issuing.
   */
  public issue(mutation: PendingMutation): string {
    this.gc();
    const token = randomUUID();
    this.entries.set(token, {
      token,
      mutation,
      expiresAtMs: this.nowMs() + this.ttlMs,
    });
    return token;
  }

  /**
   * Consume a token. Returns the captured mutation if the token is valid
   * and matches the expected operation; otherwise returns a discriminated
   * failure describing why.
   *
   * On success, the token is removed from the store — single-use semantics.
   */
  public consume(
    token: string,
    expectedOperation: CommitOperation,
  ):
    | { readonly ok: true; readonly mutation: PendingMutation }
    | { readonly ok: false; readonly reason: "unknown" | "expired" | "operation_mismatch" } {
    // Look up BEFORE gc so an expired entry can be reported as "expired"
    // rather than indistinguishably collapsed into "unknown" by the sweeper.
    // Clients use this distinction to choose between "re-run the preview"
    // (expired) and "we never issued that token" (unknown).
    const entry = this.entries.get(token);
    if (entry === undefined) {
      this.gc();
      return { ok: false, reason: "unknown" };
    }
    if (entry.expiresAtMs <= this.nowMs()) {
      this.entries.delete(token);
      return { ok: false, reason: "expired" };
    }
    if (entry.mutation.operation !== expectedOperation) {
      return { ok: false, reason: "operation_mismatch" };
    }
    this.entries.delete(token);
    return { ok: true, mutation: entry.mutation };
  }

  /** Test helper: clear all tokens. */
  public __resetForTests(): void {
    this.entries.clear();
  }

  /** Garbage-collect expired tokens. Cheap; called on every operation. */
  private gc(): void {
    const now = this.nowMs();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAtMs <= now) this.entries.delete(token);
    }
  }
}
