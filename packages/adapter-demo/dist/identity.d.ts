/**
 * Adapter identity surface.
 *
 * Exports a single immutable {@link AdapterIdentity} record describing this
 * adapter's stable id, semver, supported contract version, and capabilities.
 * Consumed by the MCP server bootstrap (advertised as a resource at
 * `adapter://identity` and reflected in the server's `name`/`version`).
 */
import { type AdapterIdentity } from "@ratesassist/contract";
/**
 * The canonical identity advertised by this adapter. The `id` is the stable
 * adapter identifier ("ratesassist-demo") regardless of package name, so
 * downstream audit logs survive a hypothetical package rename.
 */
export declare const ADAPTER_IDENTITY: AdapterIdentity;
/**
 * Display name used as the MCP server's `name` field. Kept in sync with the
 * npm package name so MCP clients see the canonical identifier.
 */
export declare const SERVER_DISPLAY_NAME: string;
//# sourceMappingURL=identity.d.ts.map