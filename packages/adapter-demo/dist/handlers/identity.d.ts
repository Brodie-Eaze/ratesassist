/**
 * Identity handlers — ABN verification (mock-mode demo) and council list.
 */
import type { schemas } from "@ratesassist/contract";
import type { RequestContext } from "../runtime/context.js";
/** `verify_abn` — composed over `@ratesassist/identity`. */
export declare function verifyAbnHandler(input: schemas.ToolInputs["verify_abn"], ctx: RequestContext): Promise<schemas.ToolResult>;
/** `list_councils` — list every tenant the adapter knows about. */
export declare function listCouncilsHandler(_input: schemas.ToolInputs["list_councils"], ctx: RequestContext): Promise<schemas.ToolResult>;
//# sourceMappingURL=identity.d.ts.map