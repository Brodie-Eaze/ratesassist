import { afterAll, describe, expect, it } from "vitest";
import { runMcpTool, closeMcpClient, listMcpTools } from "../lib/mcp-client";

describe("apps/web mcp-client", () => {
  afterAll(async () => {
    await closeMcpClient();
  });

  it("lists tools via MCP catalogue", async () => {
    const tools = await listMcpTools();
    expect(tools.length).toBeGreaterThan(5);
    const names = tools.map((t) => t.name);
    expect(names).toContain("search_property");
    expect(names).toContain("find_mining_mismatches");
  });

  it("returns ok:true for a valid tool call", async () => {
    const { result } = await runMcpTool("list_councils", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.output).toBe("string");
      expect(result.output.length).toBeGreaterThan(0);
    }
  });

  it("returns ok:false with code for a bogus assessment", async () => {
    const { result } = await runMcpTool("get_property_detail", {
      assessmentNumber: "DOES-NOT-EXIST-9999",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBeDefined();
      expect(typeof result.error).toBe("string");
    }
  });
});
