/**
 * Search handlers — free-text property search and owner-name search.
 *
 * Both return human-readable summaries plus structured `data` payloads so
 * the calling UI can render rich results without re-parsing the text.
 */
import type { schemas } from "@ratesassist/contract";
import type { RequestContext } from "../runtime/context.js";
/** `search_property` — substring match across address, suburb, postcode, assessment. */
export declare function searchPropertyHandler(input: schemas.ToolInputs["search_property"], ctx: RequestContext): Promise<schemas.ToolResult>;
/** `search_by_owner` — owner name (partial) with optional suburb filter. */
export declare function searchByOwnerHandler(input: schemas.ToolInputs["search_by_owner"], ctx: RequestContext): Promise<schemas.ToolResult>;
//# sourceMappingURL=search.d.ts.map