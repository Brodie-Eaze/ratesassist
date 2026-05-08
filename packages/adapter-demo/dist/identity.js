/**
 * Adapter identity surface.
 *
 * Exports a single immutable {@link AdapterIdentity} record describing this
 * adapter's stable id, semver, supported contract version, and capabilities.
 * Consumed by the MCP server bootstrap (advertised as a resource at
 * `adapter://identity` and reflected in the server's `name`/`version`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "@ratesassist/contract";
/**
 * Read this package's `package.json` once at module load. The bin script lives
 * at `dist/server.js`, so the manifest is one directory up from this module.
 */
function readManifest() {
    const manifestUrl = new URL("../package.json", import.meta.url);
    const raw = readFileSync(fileURLToPath(manifestUrl), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" ||
        parsed === null ||
        typeof parsed.name !== "string" ||
        typeof parsed.version !== "string") {
        throw new Error("adapter-demo: package.json is missing name/version");
    }
    const cast = parsed;
    return { name: cast.name, version: cast.version };
}
const MANIFEST = readManifest();
/**
 * The canonical identity advertised by this adapter. The `id` is the stable
 * adapter identifier ("ratesassist-demo") regardless of package name, so
 * downstream audit logs survive a hypothetical package rename.
 */
export const ADAPTER_IDENTITY = Object.freeze({
    id: "ratesassist-demo",
    name: "RatesAssist Demo Adapter",
    vendor: "RatesAssist",
    version: MANIFEST.version,
    contractVersion: CONTRACT_VERSION,
    capabilities: Object.freeze([
        "read.property",
        "read.owner",
        "read.transactions",
        "read.list_overdue",
        "write.update_owner_contact",
        "write.add_property_note",
        "generate.statutory_certificate",
    ]),
});
/**
 * Display name used as the MCP server's `name` field. Kept in sync with the
 * npm package name so MCP clients see the canonical identifier.
 */
export const SERVER_DISPLAY_NAME = MANIFEST.name;
//# sourceMappingURL=identity.js.map