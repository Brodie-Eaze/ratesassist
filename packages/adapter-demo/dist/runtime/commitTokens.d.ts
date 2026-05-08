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
/** Token time-to-live in milliseconds. */
export declare const COMMIT_TOKEN_TTL_MS: number;
/**
 * Operation kind a token is bound to. Keeps tokens issued for one tool from
 * being replayed against a different one.
 */
export type CommitOperation = "update_owner_contact" | "add_property_note";
/**
 * A pending mutation captured at preview time. The dispatcher uses this to
 * apply the exact same change at confirm time, even if the client's confirm
 * call arrives with stale/different parameters — the source of truth is the
 * preview, not the client's resend.
 */
export type PendingMutation = {
    readonly operation: "update_owner_contact";
    readonly ownerId: string;
    readonly newPhone?: string;
    readonly newEmail?: string;
} | {
    readonly operation: "add_property_note";
    readonly assessmentNumber: string;
    readonly note: string;
};
/**
 * In-memory token store. Process-local — see file-level docstring for the
 * upgrade path to multi-replica deployments.
 */
export declare class CommitTokenStore {
    private readonly entries;
    private readonly nowMs;
    private readonly ttlMs;
    /**
     * Construct a store. Inject `nowMs` for deterministic tests; defaults to
     * `Date.now`. `ttlMs` defaults to {@link COMMIT_TOKEN_TTL_MS}.
     */
    constructor(nowMs?: () => number, ttlMs?: number);
    /**
     * Issue a new token for the given mutation. Returns the token string.
     * The mutation snapshot is captured by reference; callers must not mutate
     * the object after issuing.
     */
    issue(mutation: PendingMutation): string;
    /**
     * Consume a token. Returns the captured mutation if the token is valid
     * and matches the expected operation; otherwise returns a discriminated
     * failure describing why.
     *
     * On success, the token is removed from the store — single-use semantics.
     */
    consume(token: string, expectedOperation: CommitOperation): {
        readonly ok: true;
        readonly mutation: PendingMutation;
    } | {
        readonly ok: false;
        readonly reason: "unknown" | "expired" | "operation_mismatch";
    };
    /** Test helper: clear all tokens. */
    __resetForTests(): void;
    /** Garbage-collect expired tokens. Cheap; called on every operation. */
    private gc;
}
//# sourceMappingURL=commitTokens.d.ts.map