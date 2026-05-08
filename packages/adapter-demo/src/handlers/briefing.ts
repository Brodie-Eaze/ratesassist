/**
 * `daily_briefing` — morning roll-up for a rates officer.
 *
 * Combines the overdue sweep, the recovery candidate roll-up, and a
 * small "today's actions" prompt list. Demo data is static, so the
 * briefing is deterministic given a fixed clock.
 */

import type { schemas } from "@ratesassist/contract";
import { findMismatches, recoveryStats } from "@ratesassist/recovery-engine";

import type { RequestContext } from "../runtime/context.js";
import { aud, isoDate } from "./format.js";

/** Number of "top by balance" overdue accounts to surface in the briefing. */
const TOP_OVERDUE_COUNT = 5;

/** `daily_briefing` handler. */
export async function dailyBriefingHandler(
  input: schemas.ToolInputs["daily_briefing"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const overdue = ctx.store.listOverdue(input.council);
  const totalOverdue = overdue.reduce((s, p) => s + p.balance, 0);
  const arrangements = overdue.filter((p) => p.paymentArrangement).length;
  const needingChase = overdue.length - arrangements;

  const candidates = findMismatches(ctx.evaluationContext, {
    ...(input.council !== undefined ? { council: input.council } : {}),
  });
  const stats = recoveryStats(candidates);

  const topOverdue = [...overdue]
    .sort((a, b) => b.balance - a.balance)
    .slice(0, TOP_OVERDUE_COUNT);

  const scope = input.council ? `council ${input.council}` : "all councils";
  const date = isoDate(ctx.now());

  const text = [
    `Rates briefing — ${date} (${scope})`,
    ``,
    `Overdue accounts: ${overdue.length}`,
    `Total outstanding: ${aud(totalOverdue)}`,
    `On payment arrangements: ${arrangements}`,
    `Needing follow-up: ${needingChase}`,
    ``,
    `Recovery candidates: ${stats.total} (high: ${stats.bySeverity.high}, medium: ${stats.bySeverity.medium}, low: ${stats.bySeverity.low})`,
    `Estimated annual uplift: ${aud(stats.totalUpliftAud)}`,
    `Estimated recovery opportunity (3-year arrears + uplift): ${aud(stats.totalRecoveryAud)}`,
    ``,
    `Top ${Math.min(TOP_OVERDUE_COUNT, topOverdue.length)} overdue by balance:`,
    ...topOverdue.map(
      (p) => `  - ${p.assessmentNumber} | ${p.address}, ${p.suburb} | ${aud(p.balance)}`,
    ),
    ``,
    `Suggested actions:`,
    `  - Run draft_chase_all_overdue for the friendly batch.`,
    `  - Review high-severity recovery candidates (find_mining_mismatches with minSeverity=high).`,
    `  - Generate evidence packs for the top three uplift candidates.`,
  ].join("\n");

  return {
    ok: true,
    output: text,
    data: {
      date,
      overdueCount: overdue.length,
      totalOverdue,
      arrangements,
      needingChase,
      recovery: stats,
    },
    mutated: false,
  };
}
