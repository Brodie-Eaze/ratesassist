/**
 * `list_recent_grants` handler — recently-granted live mining tenements.
 *
 * The headline sales-trigger event for the RatesAssist platform: when a
 * fresh LIVE tenement is granted on a parcel currently rated rural/vacant,
 * the council can lawfully reclassify it for higher rates. This handler
 * delegates to `@ratesassist/spatial`'s `fetchRecentlyGrantedTenements`
 * with the seeded fallback so demo/offline mode still returns rows.
 */

import type { schemas } from "@ratesassist/contract";
import {
  fetchRecentlyGrantedTenements,
  SEEDED_GRANTS,
} from "@ratesassist/spatial";

import type { RequestContext } from "../runtime/context.js";
import { failure } from "../runtime/errors.js";

/** Convert sinceDays → epoch ms watermark, anchored on `ctx.now`. */
function watermarkMs(sinceDays: number, now: Date): number {
  return now.getTime() - sinceDays * 24 * 60 * 60 * 1000;
}

export async function listRecentGrantsHandler(
  input: schemas.ToolInputs["list_recent_grants"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const sinceDays = input.sinceDays;
  const watermark = watermarkMs(sinceDays, ctx.now());

  const result = await fetchRecentlyGrantedTenements({
    sinceMs: watermark,
    ...(input.types !== undefined ? { types: input.types } : {}),
    correlationId: ctx.correlationId,
    seededFeatures: SEEDED_GRANTS,
    now: () => ctx.now().getTime(),
  });

  if (!result.ok) {
    return failure("upstream_error", result.error, ctx.correlationId, true);
  }

  // LGA filter is applied client-side by name (we don't have LGA polygons in
  // the demo store; the live SLIP path uses bbox upstream, but the seeded
  // fallback has no LGA tagging — so accept the filter as a hint that the
  // UI applies, not a hard filter here).
  const grants = [...result.grants];

  const lines = grants.slice(0, 25).map((g, i) => {
    const flag = g.provisional ? "  [PROVISIONAL — 30-day appeal window]" : "";
    return `${i + 1}. ${g.tenementIdDisplay} (${g.typeLabel}) — ${g.holder} — granted ${g.grantDate}${flag}`;
  });
  const overflow = grants.length - lines.length;

  const text = [
    `Recently-granted live tenements (last ${sinceDays} day${sinceDays === 1 ? "" : "s"}, source=${result.source}):`,
    `${grants.length} grant(s).${result.note !== undefined ? ` Note: ${result.note}` : ""}`,
    ``,
    ...lines,
    overflow > 0 ? `... and ${overflow} more (truncated; see structured data).` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    ok: true,
    output: text,
    data: {
      grants,
      source: result.source,
      watermarkUsedMs: watermark,
      queriedAt: result.queriedAt,
      ...(result.note !== undefined ? { note: result.note } : {}),
    },
    mutated: false,
  };
}
