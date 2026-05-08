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

import {
  schemas,
  type ToolName,
} from "@ratesassist/contract";
import { inputs, toolResult } from "@ratesassist/contract/schemas";

import { HANDLERS } from "../handlers/index.js";
import type { RequestContext } from "./context.js";
import { failure } from "./errors.js";

/** Set of all valid tool names, derived from the contract catalogue. */
const KNOWN_TOOLS: ReadonlySet<ToolName> = new Set(
  Object.keys(inputs) as ToolName[],
);

/** Type-guard: is the supplied string a contract-defined tool name? */
function isToolName(name: string): name is ToolName {
  return KNOWN_TOOLS.has(name as ToolName);
}

/**
 * Dispatch one tool call. Always resolves; never rejects.
 */
export async function dispatch(args: {
  readonly toolName: string;
  readonly input: unknown;
  readonly context: RequestContext;
}): Promise<schemas.ToolResult> {
  const { toolName, input, context } = args;

  // 1. Resolve the tool name.
  if (!isToolName(toolName)) {
    return failure(
      "invalid_input",
      `Unknown tool "${toolName}".`,
      context.correlationId,
    );
  }

  // 2. Validate the input shape via the contract's Zod schema.
  const schema = inputs[toolName];
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ") || "invalid input";
    return failure("invalid_input", message, context.correlationId);
  }

  // 3 + 4. Invoke the handler and validate its output. The cast on the
  // handler is sound because both `inputs[toolName]` and `HANDLERS[toolName]`
  // are indexed by the same `ToolName`; TypeScript does not narrow the
  // generic relationship across the property access, so we use a single
  // explicit cast inside the dispatcher (the only one in the package).
  // SAFETY: HANDLERS[K] is typed as `Handler<ToolInputs[K]>`; the parsed
  // input on the matching schema has type `ToolInputs[K]`. Both are keyed
  // by `toolName` so the runtime invariant matches the typing.
  const handler = HANDLERS[toolName] as (
    typedInput: unknown,
    ctx: RequestContext,
  ) => Promise<schemas.ToolResult>;

  let raw: unknown;
  try {
    raw = await handler(parsed.data, context);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "handler threw";
    // Important: do NOT include payload or stack in the message — keep
    // log surfaces PII-clean. The full stack should be logged elsewhere
    // by the caller (server.ts) at console.error level.
    return failure("internal_error", message, context.correlationId);
  }

  // 5. Validate the result shape against the contract.
  const validatedResult = toolResult.safeParse(raw);
  if (!validatedResult.success) {
    return failure(
      "internal_error",
      `handler "${toolName}" returned a result that did not match the contract: ${validatedResult.error.issues
        .map((i) => i.message)
        .join("; ")}`,
      context.correlationId,
    );
  }
  return validatedResult.data;
}
