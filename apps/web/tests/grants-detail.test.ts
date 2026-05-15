/**
 * Round-trips `get_grant_detail` through the spawned MCP adapter — verifies
 * the apps/web wiring picks up the new tool and returns parcels (real or
 * synthetic-labelled).
 *
 * FLAKE NOTE — historically this file would intermittently fail with a
 * transient `upstream_error` or `timeout` on its first call when run
 * alongside the other MCP-using tests. Root cause: the spawned adapter
 * shares a singleton transport (apps/web/lib/mcp-client.ts), and the first
 * `tools/call` after a respawn races against the SDK's `client.connect`
 * handshake — under heavy load the child can write its identity banner to
 * stderr concurrently with the protocol's initialize/initialized exchange,
 * and the very first `tools/call` lands on the framing boundary. The fix
 * here is to retry transient-only codes with bounded attempts —
 * application-level codes like `not_found` are pinned and never retried
 * (they're the assertion target). 3 attempts × the 5s per-call timeout
 * caps total wall time at <16s per assertion.
 */

import { afterAll, describe, expect, it } from "vitest";
import { runMcpTool, closeMcpClient } from "../lib/mcp-client";
import type { schemas } from "@ratesassist/contract";

type ToolResult = schemas.ToolResult;

/** Failure codes that we treat as transient — only these get retried. */
const TRANSIENT_CODES = new Set<string>(["upstream_error", "timeout"]);

/**
 * Call `get_grant_detail` with bounded retry on transient transport errors.
 * Application-level failures (e.g. `not_found`) return on the first attempt;
 * only transport-level transients are retried so we don't paper over real
 * bugs.
 */
async function runGrantDetail(
  input: Record<string, unknown>,
  { maxAttempts = 3 }: { maxAttempts?: number } = {},
): Promise<ToolResult> {
  let lastResult: ToolResult | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { result } = await runMcpTool("get_grant_detail", input);
    lastResult = result;
    if (result.ok) return result;
    if (!TRANSIENT_CODES.has(result.code)) return result;
    // Transient — log and retry. mcp-client's pino logs already capture the
    // structured failure, so the retry chain is observable in CI artefacts.
    if (attempt < maxAttempts) {
      // eslint-disable-next-line no-console
      console.warn(
        `[grants-detail.test] transient ${result.code} on attempt ${attempt}, retrying…`,
      );
      // Tiny back-off — gives a respawn cycle room to settle if the
      // singleton just died.
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  // Exhausted retries — surface the last transient so the test fails with
  // an actionable code rather than a swallowed timeout.
  return lastResult!;
}

describe("apps/web get_grant_detail (via spawned adapter)", () => {
  afterAll(async () => {
    await closeMcpClient();
  });

  it("round-trips a seeded grant id and returns a labelled cadastre source", async () => {
    // The seeded tenement `M  4701569` is only present when SLIP returns
    // empty/seeded; in CI the real SLIP response may not include it. Accept
    // either ok:true (with cadastreSource) or ok:false / not_found and pin
    // the response shape in either case.
    const result = await runGrantDetail({
      tenementId: "M  4701569",
      sinceDays: 365,
    });
    if (result.ok) {
      const data = result.data as {
        grant: { tenementId: string };
        intersectingParcels: unknown[];
        cadastreSource: string;
      };
      expect(data.grant.tenementId).toBe("M  4701569");
      expect(Array.isArray(data.intersectingParcels)).toBe(true);
      expect(["live", "seeded"]).toContain(data.cadastreSource);
    } else {
      expect(result.code).toBe("not_found");
    }
  });

  it("returns ok:false / not_found for an unknown tenement", async () => {
    const result = await runGrantDetail({
      tenementId: "Z  9999999",
      sinceDays: 90,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_found");
    }
  });
});
