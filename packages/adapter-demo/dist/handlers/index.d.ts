/**
 * Handler registry.
 *
 * The dispatcher uses this map to resolve a `ToolName` to its concrete
 * handler. Each handler is a pure async function that receives validated
 * input and a per-request context, and returns a `ToolResult` (success or
 * structured failure). Handlers never throw to the dispatcher under normal
 * operation; the dispatcher's catch-all converts any escapee into an
 * `internal_error` result.
 *
 * Adding a tool: define its input schema in `@ratesassist/contract`'s
 * `inputs`, register a description in the contract's `descriptions` map,
 * implement a handler here, and add the entry to {@link HANDLERS}.
 * TypeScript will surface every gap.
 */
import { schemas, type ToolName } from "@ratesassist/contract";
import type { RequestContext } from "../runtime/context.js";
/**
 * Generic handler signature. `Input` is the precise type for the matching
 * tool name; `ToolResult` is the contract's discriminated union.
 */
export type Handler<Input> = (input: Input, ctx: RequestContext) => Promise<schemas.ToolResult>;
/**
 * Registry of every tool handler, keyed by `ToolName`. Type-checked: a
 * missing entry is a TypeScript error.
 */
export declare const HANDLERS: {
    readonly [K in ToolName]: Handler<schemas.ToolInputs[K]>;
};
//# sourceMappingURL=index.d.ts.map