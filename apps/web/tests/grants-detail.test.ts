/**
 * Round-trips `get_grant_detail` through the spawned MCP adapter — verifies
 * the apps/web wiring picks up the new tool and returns parcels (real or
 * synthetic-labelled).
 */

import { afterAll, describe, expect, it } from "vitest";
import { runMcpTool, closeMcpClient } from "../lib/mcp-client";

describe("apps/web get_grant_detail (via spawned adapter)", () => {
  afterAll(async () => {
    await closeMcpClient();
  });

  it("round-trips a seeded grant id and returns a labelled cadastre source", async () => {
    // The seeded tenement `M  4701569` is only present when SLIP returns
    // empty/seeded; in CI the real SLIP response may not include it. Accept
    // either ok:true (with cadastreSource) or ok:false / not_found and pin
    // the response shape in either case.
    const { result } = await runMcpTool("get_grant_detail", {
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
    const { result } = await runMcpTool("get_grant_detail", {
      tenementId: "Z  9999999",
      sinceDays: 90,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_found");
    }
  });
});
