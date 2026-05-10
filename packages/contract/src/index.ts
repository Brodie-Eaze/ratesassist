/**
 * @ratesassist/contract
 *
 * The single source of truth for the RatesAssist platform's domain model
 * and MCP tool surface. Every adapter implements this contract; every
 * consumer reads types and schemas from it.
 *
 * Stability: this is the public API of the platform. Breaking changes
 * require a major version bump and a coordinated rollout across all
 * adapters and consumers.
 */

export * from "./types.js";
export * as schemas from "./schemas.js";
export * from "./tools.js";
export * from "./auth.js";
export { buildOpenApiDocument, type OpenApiOptions } from "./openapi.js";

/** Current contract version. Adapters declare which contract version they support. */
export const CONTRACT_VERSION = "0.2.0";
