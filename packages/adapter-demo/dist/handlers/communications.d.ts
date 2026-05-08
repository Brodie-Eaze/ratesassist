/**
 * Communications handlers — draft-only. The adapter NEVER auto-sends.
 *
 * Both handlers return `committed: false` on each `ReminderDraft`-shaped
 * data entry, mirroring the contract's invariant that drafts are previews
 * until a separately-authenticated send call is performed by a different
 * (commit) flow. This adapter does not implement send — it only drafts.
 */
import type { schemas } from "@ratesassist/contract";
import type { RequestContext } from "../runtime/context.js";
/** `draft_payment_reminder` — single-property draft. */
export declare function draftPaymentReminderHandler(input: schemas.ToolInputs["draft_payment_reminder"], ctx: RequestContext): Promise<schemas.ToolResult>;
/** `draft_chase_all_overdue` — batch preview across overdue accounts not on a payment arrangement. */
export declare function draftChaseAllOverdueHandler(input: schemas.ToolInputs["draft_chase_all_overdue"], ctx: RequestContext): Promise<schemas.ToolResult>;
//# sourceMappingURL=communications.d.ts.map