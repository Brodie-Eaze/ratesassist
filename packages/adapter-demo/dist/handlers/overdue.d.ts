/**
 * `list_overdue` — surface every property with an outstanding balance.
 *
 * The contract's input also carries an optional `minDaysOverdue` filter.
 * The demo dataset does not record per-instalment due dates, so we treat
 * it as the floor on a derived metric (days since `lastPaymentDate`); when
 * `lastPaymentDate` is `null`, we treat the account as exceeding any
 * positive threshold (it is overdue from rate-strike date by definition).
 */
import type { schemas } from "@ratesassist/contract";
import type { RequestContext } from "../runtime/context.js";
/** `list_overdue` handler. */
export declare function listOverdueHandler(input: schemas.ToolInputs["list_overdue"], ctx: RequestContext): Promise<schemas.ToolResult>;
//# sourceMappingURL=overdue.d.ts.map