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
 * In-memory token store. Process-local — see file-level docstring for the
 * upgrade path to multi-replica deployments.
 */
export class CommitTokenStore {
    entries;
    nowMs;
    ttlMs;
    /**
     * Construct a store. Inject `nowMs` for deterministic tests; defaults to
     * `Date.now`. `ttlMs` defaults to {@link COMMIT_TOKEN_TTL_MS}.
     */
    constructor(nowMs = () => Date.now(), ttlMs = COMMIT_TOKEN_TTL_MS) {
        this.entries = new Map();
        this.nowMs = nowMs;
        this.ttlMs = ttlMs;
    }
    /**
     * Issue a new token for the given mutation. Returns the token string.
     * The mutation snapshot is captured by reference; callers must not mutate
     * the object after issuing.
     */
    issue(mutation) {
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
    consume(token, expectedOperation) {
        this.gc();
        const entry = this.entries.get(token);
        if (entry === undefined) {
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
    __resetForTests() {
        this.entries.clear();
    }
    /** Garbage-collect expired tokens. Cheap; called on every operation. */
    gc() {
        const now = this.nowMs();
        for (const [token, entry] of this.entries) {
            if (entry.expiresAtMs <= now)
                this.entries.delete(token);
        }
    }
}
//# sourceMappingURL=commitTokens.js.map