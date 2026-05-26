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
  | "add_council"
  | "import_rating_roll"
  | "import_rate_schedule"
  | "import_landgate_title_data"
  | "import_wc_eligibility"
  | "request_strata_conversion";

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
    }
  | {
      readonly operation: "import_rating_roll";
      readonly councilCode: string;
      readonly mergeStrategy: "replace" | "upsert";
      readonly rowCount: number;
      // Rows are captured at preview time and re-applied verbatim at confirm time.
      readonly rows: ReadonlyArray<Record<string, unknown>>;
    }
  | {
      readonly operation: "import_rate_schedule";
      readonly councilCode: string;
      readonly financialYear: string;
      readonly mergeStrategy: "replace" | "upsert";
      readonly rowCount: number;
      readonly rows: ReadonlyArray<Record<string, unknown>>;
    }
  | {
      readonly operation: "import_landgate_title_data";
      readonly councilCode: string;
      readonly sourceTier:
        | "wc_feed"
        | "landgate_restricted"
        | "slip"
        | "council_uploaded_pdf";
      readonly retrievedAt: string;
      readonly recordCount: number;
      readonly pinCount: number;
      readonly encumbranceCount: number;
      readonly strataParentCount: number;
      // Aggregated VEN -> record snapshot captured at preview time.
      readonly records: ReadonlyArray<Record<string, unknown>>;
    }
  | {
      readonly operation: "import_wc_eligibility";
      readonly councilCode: string;
      readonly retrievedAt: string;
      readonly rowCount: number;
      readonly rows: ReadonlyArray<Record<string, unknown>>;
    }
  | {
      readonly operation: "request_strata_conversion";
      readonly parentAssessmentNumber: string;
      readonly toState:
        | "strata_plan_uploaded"
        | "children_previewed"
        | "children_imported"
        | "parent_superseded"
        | "withdrawn";
      readonly childCts: ReadonlyArray<{
        readonly volume: string;
        readonly folio: string;
        readonly ven?: string;
        readonly address?: string;
      }>;
      readonly reason?: string;
    };

/**
 * Identity binding for a commit token.
 *
 * Pen-test F-005 (ship-ready iter1) demonstrated that the original
 * `TokenEntry` carried only `operation + payload-hash` — a token
 * issued during one principal's preview could be replayed by ANY
 * other principal's confirm call, including across tenants. Tokens
 * now record the tenant + actor they were issued for; consume
 * refuses if the calling principal doesn't match.
 *
 * Both fields are optional ONLY for backwards compatibility with
 * legacy callers in tests and dev tooling. Production handlers MUST
 * pass them on issue and on consume.
 */
export type TokenBinding = {
  readonly tenantId?: string;
  readonly actorId?: string;
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
  readonly binding: TokenBinding;
};

/**
 * Discriminated failure shape returned by {@link CommitTokenStore.consume}.
 * `binding_mismatch` is the F-005 mitigation surface — callers should NOT
 * leak the actual issuing principal back to the consumer, just refuse.
 */
type ConsumeFailure =
  | { readonly ok: false; readonly reason: "unknown" }
  | { readonly ok: false; readonly reason: "expired" }
  | { readonly ok: false; readonly reason: "operation_mismatch" }
  | { readonly ok: false; readonly reason: "binding_mismatch" };

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
   *
   * `binding` records the tenant + actor that this token belongs to. The
   * subsequent {@link consume} call must present a matching binding or it
   * will be refused (F-005 mitigation). Default `{}` for callers that
   * predate the binding requirement; new code should always pass it.
   */
  public issue(
    mutation: PendingMutation,
    binding: TokenBinding = {},
  ): string {
    this.gc();
    const token = randomUUID();
    this.entries.set(token, {
      token,
      mutation,
      expiresAtMs: this.nowMs() + this.ttlMs,
      binding,
    });
    return token;
  }

  /**
   * Consume a token. Returns the captured mutation if the token is valid,
   * matches the expected operation, AND the supplied principal matches the
   * one the token was issued to. Otherwise returns a discriminated failure.
   *
   * `consumer` records who's trying to commit. When the token's binding
   * carries a `tenantId` / `actorId`, the consumer's value MUST equal it
   * (string equality, no normalisation). This is the F-005 mitigation —
   * even if an attacker observes a token, they cannot replay it from a
   * different session.
   *
   * Legacy callers that don't supply `consumer` see the old behaviour
   * (binding check is skipped). Production routes have been updated to
   * always pass it.
   *
   * On success, the token is removed from the store — single-use.
   */
  public consume(
    token: string,
    expectedOperation: CommitOperation,
    consumer: TokenBinding = {},
  ):
    | { readonly ok: true; readonly mutation: PendingMutation }
    | ConsumeFailure {
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
    // F-005: binding check. Only enforced when the ISSUING side
    // supplied identity — older callers without binding still work,
    // but any production handler that passes the binding on issue
    // gates consume on it. We do NOT delete the token on
    // binding_mismatch so a legitimate later attempt from the right
    // principal can still succeed (until expiry).
    if (entry.binding.tenantId !== undefined) {
      if (consumer.tenantId !== entry.binding.tenantId) {
        return { ok: false, reason: "binding_mismatch" };
      }
    }
    if (entry.binding.actorId !== undefined) {
      if (consumer.actorId !== entry.binding.actorId) {
        return { ok: false, reason: "binding_mismatch" };
      }
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
