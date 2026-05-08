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
export {};
//# sourceMappingURL=server.d.ts.map