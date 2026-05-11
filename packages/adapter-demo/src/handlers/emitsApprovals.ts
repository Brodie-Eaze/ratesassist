/**
 * `list_environmental_approvals` handler — DMIRS EMITS register.
 *
 * EMITS publishes no public machine-readable export today. The library
 * (`@ratesassist/spatial/emits`) therefore falls back to a caller-supplied
 * seeded set. This handler ships that fixture set — hand-curated to match
 * the tenement ids that already appear in the demo's cadastre-lag and
 * recent-grants narratives, so the EMITS signal compounds with them.
 *
 * Provenance is exposed honestly on the response — `source: "seeded"` so
 * the UI can disclose that the data is fixture-grade. Live mode is dormant
 * until DMIRS publishes a JSON endpoint.
 */

import type { schemas } from "@ratesassist/contract";
import {
  fetchEmitsApprovalsForTenement,
  type EmitsApproval,
} from "@ratesassist/spatial";

import type { RequestContext } from "../runtime/context.js";
import { failure } from "../runtime/errors.js";

/**
 * Seeded EMITS approvals. Keyed (loosely) against the tenement ids that
 * intersect the demo's cadastre-lag rows so the stacked-signal narrative
 * lights up in the UI. Tenement ids use the raw DMIRS form (letter + 2
 * spaces + 7 digits) — matches `GrantedTenement.tenementId` exactly so the
 * EMITS map keys line up with the scoring engine's tenement lookups.
 */
export const SEEDED_EMITS_APPROVALS: readonly EmitsApproval[] = Object.freeze([
  {
    tenementId: "M  4701612",
    approvalType: "MP",
    approvalNumber: "MP-12345",
    status: "active",
    startDate: "2025-09-12",
    endDate: "2030-09-12",
    scopeSummary:
      "Mining Proposal — iron ore open pit, pre-strip and ROM pad construction at M 47/1612.",
  },
  {
    tenementId: "M  2600987",
    approvalType: "POW",
    approvalNumber: "POW-98711",
    status: "active",
    startDate: "2026-01-04",
    endDate: "2026-12-31",
    scopeSummary:
      "Programme of Work — Year 1 gold tailings reprocessing at M 26/0987 (Kalgoorlie-Boulder).",
  },
  {
    tenementId: "M  4701709",
    approvalType: "MMP",
    approvalNumber: "MMP-44091",
    status: "active",
    startDate: "2026-02-28",
    endDate: "2031-02-28",
    scopeSummary:
      "Mine Management Plan — iron ore haul-road, water management and rehab schedule for M 47/1709.",
  },
  {
    tenementId: "G  2600123",
    approvalType: "MP",
    approvalNumber: "MP-15004",
    status: "pending",
    startDate: "2026-04-19",
    scopeSummary:
      "Mining Proposal — under assessment for mineral processing infrastructure at G 26/0123.",
  },
  {
    tenementId: "M  5100902",
    approvalType: "POW",
    approvalNumber: "POW-71248",
    status: "active",
    startDate: "2026-03-30",
    endDate: "2027-03-30",
    scopeSummary:
      "Programme of Work — gold tailings reprocessing at M 51/0902 (Meekatharra).",
  },
  {
    tenementId: "M  4701655",
    approvalType: "MP",
    approvalNumber: "MP-13988",
    status: "active",
    startDate: "2026-01-28",
    endDate: "2031-01-28",
    scopeSummary:
      "Mining Proposal — iron ore production at M 47/1655 (East Pilbara). Active producing operation.",
  },
  {
    tenementId: "M  4701569",
    approvalType: "MP",
    approvalNumber: "MP-12099",
    status: "expired",
    startDate: "2018-04-12",
    endDate: "2023-04-12",
    scopeSummary:
      "Mining Proposal — historical iron ore pre-strip at M 47/1569. Superseded by amendment; flagged for completeness.",
  },
]);

/**
 * Pre-built `emitsApprovalsByTenement` index suitable for feeding directly
 * into `EvaluationContext`. Each tenement maps to one or more entries whose
 * `active` flag and verbatim `reasoning` text are consumed by the
 * `reg.environmental_approval_active` signal.
 */
export const SEEDED_EMITS_BY_TENEMENT: ReadonlyMap<
  string,
  readonly { active: boolean; reasoning: string }[]
> = (() => {
  const out = new Map<string, { active: boolean; reasoning: string }[]>();
  for (const a of SEEDED_EMITS_APPROVALS) {
    const active = a.status === "active";
    const window =
      a.startDate !== undefined && a.endDate !== undefined
        ? ` (approved ${a.startDate}, expires ${a.endDate})`
        : a.startDate !== undefined
          ? ` (approved ${a.startDate})`
          : "";
    const reasoning = `EMITS records ${active ? "active" : a.status} ${labelFor(a.approvalType)} ${a.approvalNumber}${window} for tenement ${a.tenementId.trim()}. ${a.scopeSummary}`;
    const list = out.get(a.tenementId);
    if (list === undefined) out.set(a.tenementId, [{ active, reasoning }]);
    else list.push({ active, reasoning });
  }
  return out;
})();

function labelFor(t: EmitsApproval["approvalType"]): string {
  switch (t) {
    case "MP":
      return "Mining Proposal";
    case "POW":
      return "Programme of Work";
    case "MMP":
      return "Mine Management Plan";
    case "MIN":
      return "Ministerial Approval";
    case "other":
      return "Environmental Approval";
  }
}

export async function emitsApprovalsHandler(
  input: schemas.ToolInputs["list_environmental_approvals"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const { tenementId, active } = input;

  // When a tenement id is supplied, route through the library so the live
  // path (currently a no-op) is exercised and the seeded note is surfaced.
  if (tenementId !== undefined) {
    const r = await fetchEmitsApprovalsForTenement(tenementId, {
      seeded: SEEDED_EMITS_APPROVALS,
      correlationId: ctx.correlationId,
    });
    if (!r.ok) {
      return failure(
        r.code === "invalid_input" ? "invalid_input" : "upstream_error",
        r.error,
        ctx.correlationId,
        r.code === "upstream_error",
      );
    }
    const filtered = active ? r.approvals.filter((a) => a.status === "active") : r.approvals;
    return {
      ok: true,
      output: renderText(filtered, { source: r.source, tenementId, active }),
      data: {
        approvals: filtered,
        source: r.source,
        queriedAt: r.queriedAt,
        ...(r.note !== undefined ? { note: r.note } : {}),
      },
      mutated: false,
    };
  }

  // No tenement filter — return the full fixture set with the active filter
  // applied locally. Source is honestly seeded.
  const filtered = active
    ? SEEDED_EMITS_APPROVALS.filter((a) => a.status === "active")
    : [...SEEDED_EMITS_APPROVALS];

  return {
    ok: true,
    output: renderText(filtered, { source: "seeded", tenementId: undefined, active }),
    data: {
      approvals: filtered,
      source: "seeded" as const,
      queriedAt: new Date().toISOString(),
      note: "EMITS has no public machine-readable export; returning seeded fixture set.",
    },
    mutated: false,
  };
}

function renderText(
  approvals: readonly EmitsApproval[],
  opts: { source: string; tenementId: string | undefined; active: boolean },
): string {
  const header = `EMITS environmental approvals (source=${opts.source}, active=${opts.active}${opts.tenementId !== undefined ? `, tenementId="${opts.tenementId}"` : ""}):`;
  const lines = approvals.map(
    (a, i) =>
      `${i + 1}. [${a.status.toUpperCase()}] ${a.approvalNumber} ${labelFor(a.approvalType)} — ${a.tenementId.trim()} — ${a.scopeSummary}`,
  );
  return [
    header,
    `${approvals.length} approval(s).`,
    "",
    ...lines,
  ]
    .filter((l) => l !== "")
    .join("\n");
}
