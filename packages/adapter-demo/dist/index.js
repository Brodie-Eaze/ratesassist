/**
 * @ratesassist/adapter-demo — package barrel.
 *
 * Re-exports the programmatic surface so test harnesses and integration
 * tests can drive the dispatcher without spawning the MCP server. The
 * actual MCP entry point lives in {@link ./server} (the `bin` script).
 */
export { ADAPTER_IDENTITY, SERVER_DISPLAY_NAME } from "./identity.js";
export { DataStore, COUNCILS, TENEMENTS, TRANSACTIONS } from "./data/index.js";
export { CommitTokenStore, COMMIT_TOKEN_TTL_MS, } from "./runtime/commitTokens.js";
export { createDefaultAbnClient, createRequestContext, DEMO_TENANT_ID, DEMO_USER_ID, DEMO_USER_ROLE, } from "./runtime/context.js";
export { dispatch } from "./runtime/dispatcher.js";
export { HANDLERS } from "./handlers/index.js";
//# sourceMappingURL=index.js.map