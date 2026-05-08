/**
 * MCP stdio client singleton for apps/web. Spawns @ratesassist/adapter-demo
 * lazily on first call; respawns up to 3 times in any rolling 30s window if
 * the child dies. Per-call timeout defaults to 5s (RA_MCP_TOOL_TIMEOUT_MS).
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
  const override = process.env["RA_MCP_ADAPTER_PATH"];
  if (!override) {
    return path.resolve(root, "packages/adapter-demo/dist/server.js");
  }

  // SEC: env override must resolve inside the monorepo and end in
  // /dist/server.js to foreclose arbitrary-binary execution via env injection.
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.resolve(override));
  } catch {
    throw new Error(
      `RA_MCP_ADAPTER_PATH refused: path does not exist (${override})`,
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

  const markDead = (err?: Error): void => {
    handle.dead = true;
    if (err) console.error("[mcp-client] transport error", err.message);
    if (live === handle) live = null;
  };
  transport.onclose = (): void => markDead();
  transport.onerror = (err: Error): void => markDead(err);

  return handle;
}

async function getLive(): Promise<Live> {
  if (live && !live.dead) return live;
  if (initPromise) return initPromise;

  const limit = recordRespawn();
  if (!limit.ok) throw new Error(limit.reason);

  // Exponential backoff between respawns prevents a child that crashes during
  // handshake from burning the 3-attempt budget in milliseconds.
  const attemptIndex = Math.min(
    respawnHistory.length - 1,
    RESPAWN_BACKOFF_MS.length - 1,
  );
  const backoff = RESPAWN_BACKOFF_MS[attemptIndex] ?? 0;

  initPromise = (async (): Promise<Live> => {
    try {
      if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
      live = await spawnLive();
      return live;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/** Returns the connected MCP client. Spawns on first call; respawns if dead. */
export async function getMcpClient(): Promise<Client> {
  return (await getLive()).client;
}

type McpToolEntry = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

let cachedCatalogue: ReadonlyArray<McpToolEntry> | null = null;

export async function listMcpTools(): Promise<ReadonlyArray<McpToolEntry>> {
  if (cachedCatalogue) return cachedCatalogue;
  const client = await getMcpClient();
  const result = await client.listTools();
  cachedCatalogue = result.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema:
      (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
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
    if (opts.signal) {
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
    const code: Extract<ToolResult, { ok: false }>["code"] = /abort|timeout|timed out/i.test(message)
      ? "timeout"
      : "upstream_error";
    log(durationMs, false, code);
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

type TextBlock = { type: "text"; text: string };

function isTextBlock(b: unknown): b is TextBlock {
  return (
    typeof b === "object" &&
    b !== null &&
    (b as { type?: unknown }).type === "text" &&
    typeof (b as { text?: unknown }).text === "string"
  );
}

// Adapter encodes structured data in `_meta.data` on success; on failure, the
// second text block carries a JSON-encoded error payload.
function parseMcpToolResult(
  raw: Awaited<ReturnType<Client["callTool"]>>,
  correlationId: string,
): ToolResult {
  const content = (raw as { content?: unknown }).content;
  const isError = Boolean((raw as { isError?: unknown }).isError);
  const meta = (raw as { _meta?: Record<string, unknown> })._meta ?? {};
  const textBlocks = (Array.isArray(content) ? content : []).filter(isTextBlock);

  if (!isError) {
    return {
      ok: true,
      output: textBlocks[0]?.text ?? "",
      mutated: Boolean(meta["mutated"]),
      ...(meta["data"] !== undefined ? { data: meta["data"] } : {}),
      ...(typeof meta["commitToken"] === "string" ? { commitToken: meta["commitToken"] } : {}),
    };
  }

  const payloadText = textBlocks[1]?.text;
  if (payloadText) {
    try {
      const payload = JSON.parse(payloadText) as {
        code?: string;
        error?: string;
        correlationId?: string;
        retryable?: boolean;
      };
      if (typeof payload.code === "string" && typeof payload.error === "string") {
        return {
          ok: false,
          code: payload.code as Extract<ToolResult, { ok: false }>["code"],
          error: payload.error,
          correlationId: payload.correlationId ?? correlationId,
          retryable: payload.retryable ?? false,
        };
      }
    } catch {
      // fall through
    }
  }

  return {
    ok: false,
    code: "internal_error",
    error: textBlocks[0]?.text ?? "tool error",
    correlationId,
    retryable: false,
  };
}

/** Test/debug helper — closes the underlying transport. */
export async function closeMcpClient(): Promise<void> {
  if (live) {
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
