/**
 * Dispatcher — the single ingress for every tool call.
 *
 * Responsibilities, in order:
 *
 *   1. Resolve the tool name against the canonical catalogue.
 *   2. Validate the raw input via the contract's Zod schema.
 *   3. Invoke the handler with typed input + per-request context.
 *   4. Validate the handler's output against the contract's `toolResult`
 *      schema. A handler that returns a malformed shape becomes an
 *      `internal_error` rather than a corrupt response on the wire.
 *   5. Convert any thrown exception into a structured `internal_error`.
 *
 * No exception escapes this function under normal operation.
 */
import { schemas } from "@ratesassist/contract";
import type { RequestContext } from "./context.js";
/**
 * Dispatch one tool call. Always resolves; never rejects.
 */
export declare function dispatch(args: {
    readonly toolName: string;
    readonly input: unknown;
    readonly context: RequestContext;
}): Promise<schemas.ToolResult>;
//# sourceMappingURL=dispatcher.d.ts.map