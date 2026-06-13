/**
 * Readiness probe.
 *
 * Verifies the service can actually serve traffic:
 *   - MCP child can spawn / is connected (2s budget)
 *   - At least one tool surfaces in the cached catalogue
 *   - ANTHROPIC_API_KEY is present and prefix-shaped (cheap probe;
 *     we deliberately do NOT call the API to keep this free + fast)
 *
 * Returns 200 when all checks pass, 503 otherwise. Either way the body
 * is `{ ok, checks: { ... } }` so the orchestrator can log specifics.
 */

import { NextResponse } from "next/server";
import { getMcpClient, listMcpTools } from "@/lib/mcp-client";
import { getWebDb, isDbWired, pingDb } from "@/lib/db";
import { scoped } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MCP_BUDGET_MS = 2_000;
// Cold probe may trigger the memoised migrate+seed bootstrap (~700ms observed);
// give the DB check headroom above that. Warm probes resolve in <5ms.
const DB_BUDGET_MS = 3_000;

type Checks = {
  mcp: boolean;
  mcp_tools: boolean;
  anthropic_key_present: boolean;
  db: boolean;
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function looksLikeAnthropicKey(v: string | undefined): boolean {
  if (!v) return false;
  // Prefix-shape check only — never log or transmit the actual value.
  return v.startsWith("sk-ant-") && v.length > 20;
}

export async function GET(): Promise<NextResponse> {
  const log = scoped("api/ready");
  const checks: Checks = {
    mcp: false,
    mcp_tools: false,
    anthropic_key_present: false,
    db: false,
  };

  // (a) MCP child can spawn / is connected.
  try {
    await withTimeout(getMcpClient(), MCP_BUDGET_MS, "mcp.connect");
    checks.mcp = true;
  } catch (err) {
    log.warn({ err: (err as Error).message }, "ready.mcp.failed");
  }

  // (b) At least one cached tool surfaces.
  if (checks.mcp) {
    try {
      const tools = await withTimeout(listMcpTools(), MCP_BUDGET_MS, "mcp.listTools");
      checks.mcp_tools = tools.length > 0;
    } catch (err) {
      log.warn({ err: (err as Error).message }, "ready.mcp.listTools.failed");
    }
  }

  // (c) Anthropic key present + prefix-shaped (no network call).
  checks.anthropic_key_present = looksLikeAnthropicKey(process.env.ANTHROPIC_API_KEY);

  // (d) DB reachable — only gates readiness when the DB is in the serving
  // path (RA_USE_DB). A cold probe also exercises the migrate+seed bootstrap,
  // so a DB that cannot migrate (or the production-pglite durability guard)
  // correctly fails readiness instead of the app serving on a broken store.
  if (isDbWired()) {
    try {
      const db = await withTimeout(getWebDb(), DB_BUDGET_MS, "db.bootstrap");
      await withTimeout(pingDb(db), DB_BUDGET_MS, "db.ping");
      checks.db = true;
    } catch (err) {
      log.warn({ err: (err as Error).message }, "ready.db.failed");
    }
  } else {
    // DB intentionally out of the serving path (mock-adapter mode) — not a
    // readiness gate, report healthy so the probe reflects actual topology.
    checks.db = true;
  }

  const ok =
    checks.mcp && checks.mcp_tools && checks.anthropic_key_present && checks.db;
  return NextResponse.json(
    { ok, checks, ts: new Date().toISOString() },
    { status: ok ? 200 : 503 },
  );
}
