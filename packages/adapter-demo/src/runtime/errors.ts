/**
 * Structured error helpers for the dispatcher and handlers.
 *
 * Handlers never throw to the MCP client. Instead they return a
 * `ToolResult` of the failure variant. The helpers in this file are the
 * canonical builders so the failure shape (code + message + correlationId
 * + retryable flag) stays uniform across every tool.
 */

import { schemas } from "@ratesassist/contract";

/**
 * Stable failure code set. Mirrors the contract's `toolResult` schema.
 * Centralised here as a string literal union so handlers can branch on
 * the code without re-importing the schema.
 */
export type ToolErrorCode =
  | "not_found"
  | "invalid_input"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "commit_token_invalid"
  | "commit_token_expired"
  | "rate_limited"
  | "upstream_error"
  | "timeout"
  | "internal_error";

/**
 * Build a structured failure `ToolResult`. The dispatcher validates the
 * shape against the contract schema before returning to the client; a
 * regression in this builder would surface as a validation error there.
 */
export function failure(
  code: ToolErrorCode,
  error: string,
  correlationId: string,
  retryable: boolean = false,
): schemas.ToolResult {
  return {
    ok: false,
    code,
    error,
    correlationId,
    retryable,
  };
}

/** Convenience builder for `not_found`. */
export function notFound(
  what: string,
  correlationId: string,
): schemas.ToolResult {
  return failure("not_found", what, correlationId);
}

/** Convenience builder for `invalid_input`. */
export function invalidInput(
  message: string,
  correlationId: string,
): schemas.ToolResult {
  return failure("invalid_input", message, correlationId);
}

/** Convenience builder for `forbidden`. Used for unimplemented templates. */
export function forbidden(
  message: string,
  correlationId: string,
): schemas.ToolResult {
  return failure("forbidden", message, correlationId);
}

/** Convenience builder for `conflict` — used by two-phase commit token validation. */
export function conflict(
  message: string,
  correlationId: string,
): schemas.ToolResult {
  return failure("conflict", message, correlationId);
}

/**
 * Convenience builder for `commit_token_invalid` — token unknown, already
 * consumed, or issued for a different operation/target. Discriminable from
 * generic `conflict` so clients can offer a "re-run preview" affordance.
 */
export function commitTokenInvalid(
  message: string,
  correlationId: string,
): schemas.ToolResult {
  return failure("commit_token_invalid", message, correlationId);
}

/**
 * Convenience builder for `commit_token_expired` — token presented past its
 * TTL. Always retryable: clients should re-run the preview call.
 */
export function commitTokenExpired(
  message: string,
  correlationId: string,
): schemas.ToolResult {
  return failure("commit_token_expired", message, correlationId, true);
}

/** Convenience builder for `internal_error`. */
export function internalError(
  message: string,
  correlationId: string,
): schemas.ToolResult {
  return failure("internal_error", message, correlationId);
}
