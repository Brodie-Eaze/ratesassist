#!/usr/bin/env node
/**
 * MCP server bootstrap for the RatesAssist demo adapter.
 *
 * Exposes the canonical RatesAssist tool catalogue over the MCP stdio
 * transport. Every incoming `tools/call` is funnelled through the
 * dispatcher, which validates input, invokes the handler, and validates
 * the output before returning. Adapter identity is also surfaced as a
 * read-only resource at `adapter://identity` for compliance and audit.
 *
 * Lifecycle:
 *   - Build identity, server capabilities, store, commit-tokens, ABN client.
 *   - Register list/call handlers for tools and list/read handlers for resources.
 *   - Connect stdio transport.
 *   - Install SIGTERM / SIGINT handlers that close the transport cleanly.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { buildToolCatalogue } from "@ratesassist/contract";

import { DataStore } from "./data/index.js";
import { ADAPTER_IDENTITY, SERVER_DISPLAY_NAME } from "./identity.js";
import { CommitTokenStore } from "./runtime/commitTokens.js";
import {
  createDefaultAbnClient,
  createRequestContext,
} from "./runtime/context.js";
import { dispatch } from "./runtime/dispatcher.js";

/** URI for the adapter-identity resource exposed to MCP clients. */
const ADAPTER_IDENTITY_URI = "adapter://identity";

/** Successful exit code; SIGTERM/SIGINT graceful shutdown returns this. */
const EXIT_OK = 0;

/** Failure exit code for fatal startup errors. */
const EXIT_FATAL = 1;

/**
 * Build and connect the MCP server. Returns a disposer that closes the
 * transport — used by the signal handlers below.
 */
async function main(): Promise<() => Promise<void>> {
  const server = new Server(
    {
      name: SERVER_DISPLAY_NAME,
      version: ADAPTER_IDENTITY.version,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // ----- Process-wide singletons -----

  const store = new DataStore();
  const commitTokens = new CommitTokenStore();
  const abnClient = createDefaultAbnClient();

  const catalogue = buildToolCatalogue();

  // ----- Tool surface -----

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: catalogue.map((t) => ({
        name: t.name,
        description: t.description,
        // The contract emits OpenAPI-3 JSON Schema. The MCP SDK's `tools.tool`
        // type asks for `Record<string, unknown>` — at runtime we hand it the
        // generated schema verbatim. SAFETY: the schema generator returns a
        // JSON Schema object; MCP clients tolerate unknown extensions.
        inputSchema: t.inputSchema as Record<string, unknown>,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const ctx = createRequestContext({ store, commitTokens, abnClient });
    const result = await dispatch({
      toolName: request.params.name,
      input: request.params.arguments ?? {},
      context: ctx,
    });

    if (result.ok) {
      // Build a single `_meta` payload so successive spreads cannot stomp
      // each other's keys. Only include keys that are actually present.
      const meta: Record<string, unknown> = {};
      if (result.data !== undefined) meta["data"] = result.data;
      if (result.commitToken !== undefined) meta["commitToken"] = result.commitToken;
      meta["mutated"] = result.mutated;
      return {
        content: [{ type: "text", text: result.output }],
        isError: false,
        _meta: meta,
      };
    }

    // Failure path: surface a structured error to the client. We use the
    // `isError: true` MCP convention plus a JSON-encoded payload so any
    // client (including LLMs) can branch on `code`.
    const errorPayload = {
      code: result.code,
      error: result.error,
      correlationId: result.correlationId,
      retryable: result.retryable,
    };
    return {
      content: [
        { type: "text", text: `Error (${result.code}): ${result.error}` },
        { type: "text", text: JSON.stringify(errorPayload) },
      ],
      isError: true,
    };
  });

  // ----- Resource surface (adapter identity) -----

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: ADAPTER_IDENTITY_URI,
        name: "Adapter identity",
        description:
          "RatesAssist adapter identity (id, version, contractVersion, capabilities). Used by the web app for audit logging and compatibility checking.",
        mimeType: "application/json",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== ADAPTER_IDENTITY_URI) {
      throw new Error(`Unknown resource URI: ${request.params.uri}`);
    }
    return {
      contents: [
        {
          uri: ADAPTER_IDENTITY_URI,
          mimeType: "application/json",
          text: JSON.stringify(ADAPTER_IDENTITY, null, 2),
        },
      ],
    };
  });

  // ----- Transport -----

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Diagnostic line on stderr only (stdout is reserved for MCP framing).
  console.error(
    `[${ADAPTER_IDENTITY.id}@${ADAPTER_IDENTITY.version}] connected via stdio (contract ${ADAPTER_IDENTITY.contractVersion}, ${catalogue.length} tools)`,
  );

  return async () => {
    await server.close();
  };
}

/**
 * Install SIGTERM / SIGINT handlers that close the transport cleanly and
 * exit 0. A second signal during shutdown forces immediate exit.
 */
function installSignalHandlers(disposer: () => Promise<void>): void {
  let shuttingDown = false;
  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      console.error(`[adapter-demo] received ${signal} during shutdown — exiting immediately`);
      process.exit(EXIT_OK);
      return;
    }
    shuttingDown = true;
    console.error(`[adapter-demo] received ${signal} — closing transport`);
    disposer().then(
      () => process.exit(EXIT_OK),
      (e: unknown) => {
        console.error(
          `[adapter-demo] error during shutdown: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        process.exit(EXIT_FATAL);
      },
    );
  };
  process.on("SIGTERM", handle);
  process.on("SIGINT", handle);
}

main().then(
  (disposer) => installSignalHandlers(disposer),
  (e: unknown) => {
    console.error(
      `[adapter-demo] fatal startup error: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    process.exit(EXIT_FATAL);
  },
);
