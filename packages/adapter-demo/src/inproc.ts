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
import type { Owner, schemas } from "@ratesassist/contract";

import { recordMutation } from "./audit/index.js";
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
  /** Forwarded from the apps/web auth middleware (`x-session` header). */
  readonly tenantId?: string;
  readonly actorId?: string;
  readonly actorKind?: "user" | "service" | "llm";
  readonly ip?: string;
  readonly userAgent?: string;
}): Promise<ToolResult> {
  const ctx = createRequestContext({
    store: getStore(),
    commitTokens: getCommitTokens(),
    abnClient: createDefaultAbnClient(),
    ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
    ...(args.tenantId !== undefined ? { tenantId: args.tenantId } : {}),
    ...(args.actorId !== undefined ? { actorId: args.actorId } : {}),
    ...(args.actorKind !== undefined ? { actorKind: args.actorKind } : {}),
    ...(args.ip !== undefined ? { ip: args.ip } : {}),
    ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
  });
  return dispatch({
    toolName: args.name,
    input: args.input,
    context: ctx,
  });
}

/**
 * Outcome of an in-memory erasure attempt. `not_found` lets the caller decide
 * whether a missing owner is a hard error or a benign skip (a shared owner
 * present in the DB but never loaded into this process's in-memory seed).
 */
export type EraseOwnerInprocResult =
  | { readonly status: "erased"; readonly before: Owner; readonly after: Owner }
  | { readonly status: "noop"; readonly owner: Owner }
  | { readonly status: "not_found" };

/**
 * Right-to-be-forgotten erasure against the in-memory {@link DataStore}
 * singleton, plus the paired tamper-evident audit row.
 *
 * This is the in-process companion to the DB-backed erasure in
 * `apps/web/lib/privacy-erasure.ts`. It crypto-shreds the owner's contact PII
 * (see {@link DataStore.eraseOwner}) and — only when a field actually changed
 * — appends an `erase_owner_pii` row to the in-memory hash-chained audit log.
 *
 * The audit row deliberately records NO erased PII values: `before` carries
 * only the field names that were cleared and a redaction marker; `after`
 * carries the de-identified tombstone the record now holds. An auditor can
 * prove the erasure happened and chain-verify it without the log itself
 * re-introducing the personal information that was just destroyed.
 *
 * Idempotent: a second call on an already-tombstoned owner returns `noop` and
 * writes no further audit row.
 */
export function eraseOwnerInproc(args: {
  readonly ownerId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly actorKind: "user" | "service" | "llm";
  readonly correlationId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
}): EraseOwnerInprocResult {
  const store = getStore();
  const result = store.eraseOwner(args.ownerId);
  if (result === undefined) return { status: "not_found" };
  if (!result.changed) return { status: "noop", owner: result.after };

  // Tamper-evident audit WITHOUT re-storing the erased values. `before` lists
  // only which fields were shredded; `after` is the de-identified record.
  recordMutation({
    tenantId: args.tenantId,
    actorId: args.actorId,
    actorKind: args.actorKind,
    action: "erase_owner_pii",
    target: { type: "owner", id: args.ownerId },
    before: {
      redacted: true,
      clearedFields: ["name", "email", "phone", "postalAddress", "previousOwners"],
    },
    after: {
      ownerId: result.after.ownerId,
      name: result.after.name,
      email: result.after.email,
      phone: result.after.phone,
      postalAddress: result.after.postalAddress,
      previousOwners: result.after.previousOwners,
    },
    ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
    ...(args.ip !== undefined ? { ip: args.ip } : {}),
    ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
  });

  return { status: "erased", before: result.before, after: result.after };
}

/** Test helper — clears in-process singletons. */
export function _resetInproc(): void {
  _store = undefined;
  _commitTokens = undefined;
  _catalogue = null;
}
