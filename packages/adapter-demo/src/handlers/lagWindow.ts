/**
 * `list_lag_window_candidates` handler — the headline cross-register signal.
 *
 * Delegates to `@ratesassist/spatial`'s `findLagWindowCandidates`, supplying
 * both the seeded grant fallback AND the seeded landuse fallback so the
 * demo / offline path is never silently dead. Honest source labelling is
 * preserved end-to-end: the dispatched payload always exposes `source` as
 * "live" | "seeded" | "cache" so the UI can disclose provenance.
 */

import type { schemas } from "@ratesassist/contract";
import {
  findLagWindowCandidates,
  SEEDED_GRANTS,
  SEEDED_LAGWINDOW_PARCELS,
  type LagSeverityHint,
} from "@ratesassist/spatial";

import type { RequestContext } from "../runtime/context.js";
import { failure } from "../runtime/errors.js";

const SEVERITY_RANK: Readonly<Record<LagSeverityHint, number>> = {
  low: 1,
  medium: 2,
  high: 3,
} as const;

export async function listLagWindowCandidatesHandler(
  input: schemas.ToolInputs["list_lag_window_candidates"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const { sinceDays, minSeverity, lgaName } = input;

  const result = await findLagWindowCandidates({
    sinceDays,
    correlationId: ctx.correlationId,
    seededGrants: SEEDED_GRANTS,
    seededParcels: SEEDED_LAGWINDOW_PARCELS,
    now: () => ctx.now().getTime(),
  });

  if (!result.ok) {
    return failure("upstream_error", result.error, ctx.correlationId, true);
  }

  const minRank = SEVERITY_RANK[minSeverity];
  const filtered = result.candidates.filter(
    (c) => SEVERITY_RANK[c.severityHint] >= minRank,
  );

  const lines = filtered.slice(0, 25).map((c, i) => {
    const sev = c.severityHint.toUpperCase();
    return (
      `${i + 1}. [${sev}] ${c.tenement.tenementIdDisplay} ` +
      `(${c.tenement.typeLabel}) — parcel "${c.parcel.landuse}" — ` +
      `lag ${c.lagDays}d`
    );
  });
  const overflow = filtered.length - lines.length;

  const noteFragment = result.note !== undefined ? ` Note: ${result.note}` : "";
  const text = [
    `Cadastre-lag candidates (sinceDays=${sinceDays}, minSeverity=${minSeverity}, source=${result.source}):`,
    `${filtered.length} candidate(s).${noteFragment}`,
    "",
    ...lines,
    overflow > 0 ? `... and ${overflow} more (truncated; see structured data).` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    ok: true,
    output: text,
    data: {
      candidates: filtered,
      source: result.source,
      queriedAt: result.queriedAt,
      sinceDays,
      minSeverity,
      ...(lgaName !== undefined ? { lgaNameHint: lgaName } : {}),
      ...(result.note !== undefined ? { note: result.note } : {}),
    },
    mutated: false,
  };
}
