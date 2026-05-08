/**
 * Structured error helpers for the dispatcher and handlers.
 *
 * Handlers never throw to the MCP client. Instead they return a
 * `ToolResult` of the failure variant. The helpers in this file are the
 * canonical builders so the failure shape (code + message + correlationId
 * + retryable flag) stays uniform across every tool.
 */
/**
 * Build a structured failure `ToolResult`. The dispatcher validates the
 * shape against the contract schema before returning to the client; a
 * regression in this builder would surface as a validation error there.
 */
export function failure(code, error, correlationId, retryable = false) {
    return {
        ok: false,
        code,
        error,
        correlationId,
        retryable,
    };
}
/** Convenience builder for `not_found`. */
export function notFound(what, correlationId) {
    return failure("not_found", what, correlationId);
}
/** Convenience builder for `invalid_input`. */
export function invalidInput(message, correlationId) {
    return failure("invalid_input", message, correlationId);
}
/** Convenience builder for `forbidden`. Used for unimplemented templates. */
export function forbidden(message, correlationId) {
    return failure("forbidden", message, correlationId);
}
/** Convenience builder for `conflict` — used by two-phase commit token validation. */
export function conflict(message, correlationId) {
    return failure("conflict", message, correlationId);
}
/** Convenience builder for `internal_error`. */
export function internalError(message, correlationId) {
    return failure("internal_error", message, correlationId);
}
//# sourceMappingURL=errors.js.map