/**
 * Property handlers — single-property detail, transaction history, paginated list.
 */
import type { schemas } from "@ratesassist/contract";
import type { RequestContext } from "../runtime/context.js";
/** `get_property_detail` — full record for one property. */
export declare function getPropertyDetailHandler(input: schemas.ToolInputs["get_property_detail"], ctx: RequestContext): Promise<schemas.ToolResult>;
/** `get_transaction_history` — chronological transaction list. */
export declare function getTransactionHistoryHandler(input: schemas.ToolInputs["get_transaction_history"], ctx: RequestContext): Promise<schemas.ToolResult>;
/** `list_properties` — paginated list, optionally restricted to one council. */
export declare function listPropertiesHandler(input: schemas.ToolInputs["list_properties"], ctx: RequestContext): Promise<schemas.ToolResult>;
//# sourceMappingURL=property.d.ts.map