import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";

const SERVER_PATH = path.resolve(__dirname, "../dist/server.js");

let client: Client;
let transport: StdioClientTransport;

describe("adapter-demo MCP server roundtrip", () => {
  beforeAll(async () => {
    if (!fs.existsSync(SERVER_PATH)) {
      execSync("npm run build", {
        cwd: path.resolve(__dirname, ".."),
        stdio: "inherit",
      });
    }
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_PATH],
      stderr: "ignore",
    });
    client = new Client(
      { name: "test-client", version: "0.0.1" },
      { capabilities: {} },
    );
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it("listTools advertises the contract catalogue", async () => {
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(5);
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("search_property");
    expect(names).toContain("find_mining_mismatches");
    expect(names).toContain("generate_evidence_pack");
  });

  it("tools/call search_property returns ok", async () => {
    const r = await client.callTool({
      name: "search_property",
      arguments: { query: "Tom Price" },
    });
    expect(r.isError).not.toBe(true);
    expect(Array.isArray(r.content)).toBe(true);
  });

  it("tools/call find_mining_mismatches returns text", async () => {
    const r = await client.callTool({
      name: "find_mining_mismatches",
      arguments: {},
    });
    expect(Array.isArray(r.content)).toBe(true);
    const first = (r.content as Array<{ type: string; text?: string }>)[0];
    expect(first?.type).toBe("text");
    expect(typeof first?.text).toBe("string");
  });

  it("tools/call generate_evidence_pack returns a result (ok or structured error)", async () => {
    const r = await client.callTool({
      name: "generate_evidence_pack",
      arguments: { assessmentNumber: "TPS-1102-44" },
    });
    expect(Array.isArray(r.content)).toBe(true);
  });
});
