/**
 * Recovery handlers — composed over `@ratesassist/recovery-engine`.
 *
 * The adapter does not re-implement signal evaluation; it plugs the
 * recovery engine into the demo's data store via the shared
 * `EvaluationContext` on the request context.
 */
import type { schemas } from "@ratesassist/contract";
import type { RequestContext } from "../runtime/context.js";
/** `find_mining_mismatches` — composed over `findMismatches`. */
export declare function findMiningMismatchesHandler(input: schemas.ToolInputs["find_mining_mismatches"], ctx: RequestContext): Promise<schemas.ToolResult>;
/** `generate_evidence_pack` — composed over `buildEvidencePack`. */
export declare function generateEvidencePackHandler(input: schemas.ToolInputs["generate_evidence_pack"], ctx: RequestContext): Promise<schemas.ToolResult>;
/** `recovery_summary` — aggregate stats across the candidate set. */
export declare function recoverySummaryHandler(input: schemas.ToolInputs["recovery_summary"], ctx: RequestContext): Promise<schemas.ToolResult>;
/** `get_tenement_for_property` — list tenements that intersect one assessment. */
export declare function getTenementForPropertyHandler(input: schemas.ToolInputs["get_tenement_for_property"], ctx: RequestContext): Promise<schemas.ToolResult>;
//# sourceMappingURL=recovery.d.ts.map