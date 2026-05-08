/**
 * `daily_briefing` — morning roll-up for a rates officer.
 *
 * Combines the overdue sweep, the recovery candidate roll-up, and a
 * small "today's actions" prompt list. Demo data is static, so the
 * briefing is deterministic given a fixed clock.
 */
import type { schemas } from "@ratesassist/contract";
import type { RequestContext } from "../runtime/context.js";
/** `daily_briefing` handler. */
export declare function dailyBriefingHandler(input: schemas.ToolInputs["daily_briefing"], ctx: RequestContext): Promise<schemas.ToolResult>;
//# sourceMappingURL=briefing.d.ts.map