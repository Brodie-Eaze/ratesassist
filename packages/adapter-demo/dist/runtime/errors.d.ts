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
export type ToolErrorCode = "not_found" | "invalid_input" | "unauthorized" | "forbidden" | "conflict" | "rate_limited" | "upstream_error" | "timeout" | "internal_error";
/**
 * Build a structured failure `ToolResult`. The dispatcher validates the
 * shape against the contract schema before returning to the client; a
 * regression in this builder would surface as a validation error there.
 */
export declare function failure(code: ToolErrorCode, error: string, correlationId: string, retryable?: boolean): schemas.ToolResult;
/** Convenience builder for `not_found`. */
export declare function notFound(what: string, correlationId: string): schemas.ToolResult;
/** Convenience builder for `invalid_input`. */
export declare function invalidInput(message: string, correlationId: string): schemas.ToolResult;
/** Convenience builder for `forbidden`. Used for unimplemented templates. */
export declare function forbidden(message: string, correlationId: string): schemas.ToolResult;
/** Convenience builder for `conflict` — used by two-phase commit token validation. */
export declare function conflict(message: string, correlationId: string): schemas.ToolResult;
/** Convenience builder for `internal_error`. */
export declare function internalError(message: string, correlationId: string): schemas.ToolResult;
//# sourceMappingURL=errors.d.ts.map