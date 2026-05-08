/**
 * MCP client singleton for apps/web.
 *
 * Spawns the @ratesassist/adapter-demo bin (./dist/server.js) as a child
 * process over the stdio transport. All tool calls in apps/web flow through
 * here — there is no in-process duplicate of the tool implementations.
 *
 * Lifecycle:
 *   - First call to {@link getMcpClient} lazily spawns + handshakes.
 *   - Concurrent first-callers all await the same init promise (race-safe).
 *   - If the child process dies (EPIPE / exit / transport closed), the next
 *     call respawns. Up to 3 respawn attempts in any rolling 30s window;
 *     beyond that we fail fast.
 *   - Per-call timeout is 5s by default (configurable via
 *     `RA_MCP_TOOL_TIMEOUT_MS`).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";

import type { schemas } from "@ratesassist/contract";

type ToolResult = schemas.ToolResult;

const DEFAULT_TIMEOUT_MS = 5_000;
const RESPAWN_WINDOW_MS = 30_000;
const RESPAWN_MAX_ATTEMPTS = 3;
const RESPAWN_BACKOFF_MS = [0, 1_000, 2_000, 4_000];

function monorepoRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

function resolveAdapterPath(): string {
  const root = monorepoRoot();
  const defaultPath = path.resolve(
    root,
    "packages/adapter-demo/dist/server.js",
  );
  const override = process.env["RA_MCP_ADAPTER_PATH"];
  if (override === undefined || override.length === 0) return defaultPath;

  // SEC: validate override before passing to spawn. The override is intended
  // for monorepo-relative deploys (e.g. a built bundle moved during release).
  // Reject anything that isn't an absolute path resolving inside the monorepo
  // and ending in /dist/server.js — that combination forecloses arbitrary-
  // binary execution via env injection.
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.resolve(override));
  } catch {
    throw new Error(
      `RA_MCP_ADAPTER_PATH refused: path does not exist or is not a regular file (${override})`,
    );
  }
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(
      `RA_MCP_ADAPTER_PATH refused: path escapes monorepo root (${resolved})`,
    );
  }
  if (!resolved.endsWith(`${path.sep}dist${path.sep}server.js`)) {
    throw new Error(
      `RA_MCP_ADAPTER_PATH refused: must end in /dist/server.js (${resolved})`,
    );
  }
  return resolved;
}

function resolveTimeoutMs(): number {
  const v = process.env["RA_MCP_TOOL_TIMEOUT_MS"];
  if (v === undefined) return DEFAULT_TIMEOUT_MS;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

type Live = {
  readonly client: Client;
  readonly transport: StdioClientTransport;
  dead: boolean;
};

let live: Live | null = null;
let initPromise: Promise<Live> | null = null;
const respawnHistory: number[] = [];

function recordRespawn(): { ok: true } | { ok: false; reason: string } {
  const now = Date.now();
  // Drop entries outside the window.
  while (respawnHistory.length > 0 && respawnHistory[0]! < now - RESPAWN_WINDOW_MS) {
    respawnHistory.shift();
  }
  if (respawnHistory.length >= RESPAWN_MAX_ATTEMPTS) {
    return {
      ok: false,
      reason: `adapter respawn limit hit (${RESPAWN_MAX_ATTEMPTS} attempts in ${RESPAWN_WINDOW_MS / 1000}s)`,
    };
  }
  respawnHistory.push(now);
  return { ok: true };
}

async function spawnLive(): Promise<Live> {
  const adapterPath = resolveAdapterPath();

  const transport = new StdioClientTransport({
    command: process.execPath, // node binary
    args: [adapterPath],
    stderr: "inherit",
  });

  const client = new Client(
    { name: "ratesassist-web", version: "0.1.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  const handle: Live = { client, transport, dead: false };

  // Mark dead on transport close so the next call triggers respawn.
  transport.onclose = (): void => {
    handle.dead = true;
    if (live === handle) live = null;
  };
  transport.onerror = (err: Error): void => {
    handle.dead = true;
    console.error("[mcp-client] transport error", err.message);
    if (live === handle) live = null;
  };

  return handle;
}

async function getLive(): Promise<Live> {
  if (live !== null && !live.dead) return live;

  if (initPromise !== null) return initPromise;

  const limit = recordRespawn();
  if (!limit.ok) {
    throw new Error(limit.reason);
  }

  // Exponential backoff between respawns prevents a child that crashes during
  // handshake from burning the 3-attempt budget in milliseconds.
  const attemptIndex = Math.min(
    respawnHistory.length - 1,
    RESPAWN_BACKOFF_MS.length - 1,
  );
  const backoff = RESPAWN_BACKOFF_MS[attemptIndex] ?? 0;

  initPromise = (async (): Promise<Live> => {
    try {
      if (backoff > 0) {
        await new Promise((r) => setTimeout(r, backoff));
      }
      const next = await spawnLive();
      live = next;
      return next;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/** Returns the connected MCP client. Spawns on first call; respawns if dead. */
export async function getMcpClient(): Promise<Client> {
  const handle = await getLive();
  return handle.client;
}

/** Tool catalogue from the adapter, fetched once and cached. */
let cachedCatalogue: ReadonlyArray<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> | null = null;

export async function listMcpTools(): Promise<
  ReadonlyArray<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>
> {
  if (cachedCatalogue !== null) return cachedCatalogue;
  const client = await getMcpClient();
  const result = await client.listTools();
  cachedCatalogue = result.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    // SAFETY: MCP advertises inputSchema as a JSON-Schema-shaped object;
    // Anthropic tool input_schema accepts the same structure verbatim.
    inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
  }));
  return cachedCatalogue;
}

export type RunMcpToolOpts = {
  readonly correlationId?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
};

/**
 * Invoke a tool over MCP and return the parsed {@link ToolResult}.
 * Always resolves with a structured value — transport / timeout failures
 * become `{ ok: false, code: "upstream_error" | "timeout", ... }`.
 */
export async function runMcpTool(
  name: string,
  input: Record<string, unknown>,
  opts: RunMcpToolOpts = {},
): Promise<{ result: ToolResult; durationMs: number }> {
  const start = Date.now();
  const correlationId = opts.correlationId ?? `mcp_${start}_${Math.random().toString(36).slice(2, 8)}`;
  const timeoutMs = opts.timeoutMs ?? resolveTimeoutMs();

  const log = (durationMs: number, ok: boolean, code?: string): void => {
    console.log(
      JSON.stringify({
        scope: "mcp-client",
        correlationId,
        tool: name,
        durationMs,
        ok,
        ...(code !== undefined ? { code } : {}),
      }),
    );
  };

  try {
    const client = await getMcpClient();

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    if (opts.signal !== undefined) {
      if (opts.signal.aborted) ctrl.abort();
      else opts.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }

    let raw: Awaited<ReturnType<Client["callTool"]>>;
    try {
      raw = await client.callTool(
        { name, arguments: input },
        undefined,
        { signal: ctrl.signal, timeout: timeoutMs },
      );
    } finally {
      clearTimeout(timer);
    }

    const result = parseMcpToolResult(raw, correlationId);
    const durationMs = Date.now() - start;
    log(durationMs, result.ok, result.ok ? undefined : result.code);
    return { result, durationMs };
  } catch (e: unknown) {
    const durationMs = Date.now() - start;
    const message = e instanceof Error ? e.message : String(e);
    const isTimeout = /abort|timeout|timed out/i.test(message);
    const code: Extract<ToolResult, { ok: false }>["code"] = isTimeout
      ? "timeout"
      : "upstream_error";
    log(durationMs, false, code);
    // SAFETY: discriminated-union construction — matches the failure variant
    // shape declared in @ratesassist/contract's `toolResult` schema.
    const result: ToolResult = {
      ok: false,
      error: message,
      code,
      correlationId,
      retryable: true,
    };
    return { result, durationMs };
  }
}

/**
 * Parse an MCP `tools/call` response into a contract `ToolResult`.
 * The adapter encodes structured data in `_meta.data` on success and
 * a JSON-encoded error payload as the second text block on failure.
 */
function parseMcpToolResult(
  raw: Awaited<ReturnType<Client["callTool"]>>,
  correlationId: string,
): ToolResult {
  // SAFETY: MCP SDK types `content` as unknown[]; we narrow at runtime.
  const content = (raw as { content?: unknown }).content;
  const isError = Boolean((raw as { isError?: unknown }).isError);
  const meta = (raw as { _meta?: Record<string, unknown> })._meta ?? {};

  const blocks = Array.isArray(content) ? content : [];
  const textBlocks = blocks.filter(
    (b): b is { type: "text"; text: string } =>
      typeof b === "object" &&
      b !== null &&
      (b as { type?: unknown }).type === "text" &&
      typeof (b as { text?: unknown }).text === "string",
  );

  if (!isError) {
    const output = textBlocks[0]?.text ?? "";
    const result: ToolResult = {
      ok: true,
      output,
      mutated: Boolean(meta["mutated"]),
      ...(meta["data"] !== undefined ? { data: meta["data"] } : {}),
      ...(typeof meta["commitToken"] === "string" ? { commitToken: meta["commitToken"] as string } : {}),
    };
    return result;
  }

  // Error path: try to parse the JSON payload from the second text block.
  const payloadText = textBlocks[1]?.text;
  if (payloadText !== undefined) {
    try {
      const payload = JSON.parse(payloadText) as {
        code?: string;
        error?: string;
        correlationId?: string;
        retryable?: boolean;
      };
      if (typeof payload.code === "string" && typeof payload.error === "string") {
        // SAFETY: code is validated against the contract enum at adapter side.
        return {
          ok: false,
          code: payload.code as Extract<ToolResult, { ok: false }>["code"],
          error: payload.error,
          correlationId: payload.correlationId ?? correlationId,
          retryable: payload.retryable ?? false,
        };
      }
    } catch {
      // fall through to generic error
    }
  }

  const fallbackMessage = textBlocks[0]?.text ?? "tool error";
  return {
    ok: false,
    code: "internal_error",
    error: fallbackMessage,
    correlationId,
    retryable: false,
  };
}

/** Test/debug helper — closes the underlying transport. */
export async function closeMcpClient(): Promise<void> {
  if (live !== null) {
    try {
      await live.client.close();
    } catch {
      // ignore
    }
    live = null;
  }
  cachedCatalogue = null;
  respawnHistory.length = 0;
}
