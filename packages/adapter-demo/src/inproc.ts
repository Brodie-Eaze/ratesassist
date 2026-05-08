/**
 * In-process adapter entrypoint — used by the web app when stdio child
 * processes are not viable (Vercel serverless, edge runtimes, anywhere a
 * long-lived adapter process can't be spawned).
 *
 * Surfaces the same call/list-tools semantics as the MCP server in
 * `server.ts`, minus the transport. The dispatcher, store, commit-token
 * store, and ABN client are constructed once per Node process and reused;
 * the singletons match the lifecycle the stdio server has.
 *
 * NOTE: this entrypoint loses the trust boundary the stdio transport
 * provides — a misbehaving handler can affect the host. That is acceptable
 * for the demo adapter (read-only synthetic data). Production adapters
 * MUST be wired over a real transport.
 */

import { buildToolCatalogue } from "@ratesassist/contract";
import type { schemas } from "@ratesassist/contract";

import { DataStore } from "./data/index.js";
import { CommitTokenStore } from "./runtime/commitTokens.js";
import {
  createDefaultAbnClient,
  createRequestContext,
} from "./runtime/context.js";
import { dispatch } from "./runtime/dispatcher.js";

type ToolResult = schemas.ToolResult;

let _store: DataStore | undefined;
let _commitTokens: CommitTokenStore | undefined;

function getStore(): DataStore {
  if (_store === undefined) _store = new DataStore();
  return _store;
}

function getCommitTokens(): CommitTokenStore {
  if (_commitTokens === undefined) _commitTokens = new CommitTokenStore();
  return _commitTokens;
}

export type InprocToolEntry = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

let _catalogue: ReadonlyArray<InprocToolEntry> | null = null;

export function listTools(): ReadonlyArray<InprocToolEntry> {
  if (_catalogue) return _catalogue;
  _catalogue = buildToolCatalogue().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));
  return _catalogue;
}

export async function callTool(args: {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly correlationId?: string;
}): Promise<ToolResult> {
  const ctx = createRequestContext({
    store: getStore(),
    commitTokens: getCommitTokens(),
    abnClient: createDefaultAbnClient(),
    ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
  });
  return dispatch({
    toolName: args.name,
    input: args.input,
    context: ctx,
  });
}

/** Test helper — clears in-process singletons. */
export function _resetInproc(): void {
  _store = undefined;
  _commitTokens = undefined;
  _catalogue = null;
}
