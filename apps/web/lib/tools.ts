// Thin facade over the MCP client. Tool implementations live in
// @ratesassist/adapter-demo and are reached over stdio.

import type Anthropic from "@anthropic-ai/sdk";
import { buildToolCatalogue } from "@ratesassist/contract";
import type { schemas } from "@ratesassist/contract";

import { runMcpTool } from "./mcp-client";
import {
  applyToolScope,
  type ScopedResultView,
  type ToolScope,
} from "./tool-tenant-scope";

export type JsonSchemaProperty = {
  type: string;
  description?: string;
  enum?: readonly string[];
};

export type ToolDef = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export const TOOLS: ToolDef[] = buildToolCatalogue().map((t) => {
  const schema = (t.inputSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  }) ?? {};
  return {
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object",
      properties: schema.properties ?? {},
      ...(Array.isArray(schema.required) ? { required: schema.required } : {}),
    },
  };
});

const KNOWN_TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

export function isKnownTool(name: string): boolean {
  return KNOWN_TOOL_NAMES.has(name);
}

export function toAnthropicTool(t: ToolDef): Anthropic.Tool {
  return {
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object",
      properties: t.input_schema.properties,
      required: t.input_schema.required,
    },
  } as Anthropic.Tool;
}

/** Anthropic-shaped tool catalogue, used by the LLM tool-use loop. */
export function getToolCatalogue(): Anthropic.Tool[] {
  return TOOLS.map(toAnthropicTool);
}

export type RunToolResult = {
  output: string;
  durationMs: number;
  error?: string;
  ok: boolean;
  code?: string;
  data?: unknown;
  commitToken?: string;
  mutated?: boolean;
};

export type RunToolAttribution = {
  readonly tenantId?: string;
  readonly actorId?: string;
  readonly actorKind?: "user" | "service" | "llm";
  readonly ip?: string;
  readonly userAgent?: string;
};

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  correlationId?: string,
  attribution?: RunToolAttribution,
  scope?: ToolScope,
): Promise<RunToolResult> {
  if (!isKnownTool(name)) {
    return {
      output: `Unknown tool: ${name}`,
      durationMs: 0,
      ok: false,
      code: "not_found",
      error: "unknown_tool",
    };
  }

  // Tenant + RBAC scoping. When a scope is supplied (chat surface), the policy
  // either rewrites the input to the caller's tenant, refuses the call, or —
  // for shared-owner reads — schedules a post-dispatch redaction. When no
  // scope is supplied (direct/REST callers that already scoped upstream), the
  // call passes through unchanged for backward compatibility.
  let effectiveInput = input ?? {};
  let transformResult: ((r: ScopedResultView) => ScopedResultView) | undefined;
  if (scope !== undefined) {
    const outcome = applyToolScope(name, effectiveInput, scope);
    if (outcome.action === "deny") {
      const safeMessage = outcome.message.replace(/[\x00-\x1f\x7f]/g, " ");
      return {
        output: `Tool error (${outcome.code}): ${safeMessage}`,
        durationMs: 0,
        ok: false,
        code: outcome.code,
        error: safeMessage,
      };
    }
    effectiveInput = outcome.input;
    transformResult = outcome.transformResult;
  }

  const { result, durationMs } = await runMcpTool(name, effectiveInput, {
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(attribution?.tenantId !== undefined ? { tenantId: attribution.tenantId } : {}),
    ...(attribution?.actorId !== undefined ? { actorId: attribution.actorId } : {}),
    ...(attribution?.actorKind !== undefined ? { actorKind: attribution.actorKind } : {}),
    ...(attribution?.ip !== undefined ? { ip: attribution.ip } : {}),
    ...(attribution?.userAgent !== undefined ? { userAgent: attribution.userAgent } : {}),
  });

  if (result.ok) {
    // Apply any scope-mandated post-dispatch transform (e.g. shared-owner
    // contact redaction) to BOTH the narration and the structured data.
    const view: ScopedResultView =
      transformResult !== undefined
        ? transformResult(
            result.data !== undefined
              ? { output: result.output, data: result.data }
              : { output: result.output },
          )
        : result.data !== undefined
          ? { output: result.output, data: result.data }
          : { output: result.output };
    return {
      output: view.output,
      durationMs,
      ok: true,
      mutated: result.mutated,
      ...(view.data !== undefined ? { data: view.data } : {}),
      ...(result.commitToken !== undefined ? { commitToken: result.commitToken } : {}),
    };
  }

  // Strip control chars from upstream errors before they reach LLM context,
  // so a malicious upstream string can't smuggle prompt-injection bytes.
  const safeError = result.error.replace(/[\x00-\x1f\x7f]/g, " ");
  return {
    output: `Tool error (${result.code}): ${safeError}`,
    durationMs,
    ok: false,
    code: result.code,
    error: safeError,
  };
}

export type ToolResult = schemas.ToolResult;
