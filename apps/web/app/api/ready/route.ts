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
import { scoped } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MCP_BUDGET_MS = 2_000;

type Checks = {
  mcp: boolean;
  mcp_tools: boolean;
  anthropic_key_present: boolean;
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

  const ok = checks.mcp && checks.mcp_tools && checks.anthropic_key_present;
  return NextResponse.json(
    { ok, checks, ts: new Date().toISOString() },
    { status: ok ? 200 : 503 },
  );
}
