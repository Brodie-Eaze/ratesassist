/**
 * `list_address_discrepancies` handler.
 *
 * The address-mismatch signal lives at the Landgate × council-rating-record
 * boundary. In production the discrepancy set is produced by reconciling a
 * council's TechOne CiAnywhere export against the council's already-licensed
 * Landgate restricted-tier feed (see internal/LANDGATE-ACCESS.md). The
 * adapter-demo fixture below is hand-curated so the demo path tells the
 * same story without touching a real Landgate endpoint.
 *
 * Provenance is exposed honestly on the response — `source: "seeded"` so
 * the UI can disclose that the data is fixture-grade.
 */

import type { schemas } from "@ratesassist/contract";
import type {
  AddressDiscrepancy,
  AddressDiscrepancyKind,
  AddressDiscrepancySeverity,
} from "@ratesassist/spatial";

import type { RequestContext } from "../runtime/context.js";

const SEVERITY_RANK: Readonly<Record<AddressDiscrepancySeverity, number>> = {
  low: 1,
  medium: 2,
  high: 3,
} as const;

/**
 * Hand-curated address-discrepancy fixtures for the demo councils.
 * Each entry mirrors the {@link AddressDiscrepancy} shape exactly so the
 * recovery-engine signal renders the `reasoning` verbatim into the
 * evidence pack.
 */
export const SEEDED_ADDRESS_DISCREPANCIES: readonly AddressDiscrepancy[] = Object.freeze([
  {
    kind: "address_renumber",
    assessmentNumber: "TPS-3041-12",
    techoneAddress: "12 Stadium Road, Tom Price",
    techoneLandUse: "Residential",
    landgateAddress: "14 Stadium Road, Tom Price",
    landgateLandUse: "Residential - single dwelling",
    landgateLotPlan: "Lot 12 DP 191228",
    detectedAt: "2026-05-09T03:11:00Z",
    severityHint: "medium",
    reasoning:
      "Landgate cadastre records the parcel as 14 Stadium Road, Tom Price (RPDLU 211, residential). " +
      "Council rating record carries 12 Stadium Road — consistent with post-2024 street renumbering after " +
      "lots 12 and 14 were consolidated. Address-of-record correction required before the next levy run.",
  },
  {
    kind: "landuse_reclass",
    assessmentNumber: "ESH-7011-08",
    techoneAddress: "8 Newman Drive, Newman",
    techoneLandUse: "Commercial",
    landgateAddress: "8 Newman Drive, Newman",
    landgateLandUse: "Industrial - heavy industry",
    landgateLotPlan: "Lot 8 DP 304221",
    detectedAt: "2026-05-09T03:11:00Z",
    severityHint: "high",
    reasoning:
      "Landgate updated landuse to Industrial - heavy industry (RPDLU 511) following DA-2025-184 in Nov 2025. " +
      "Council still rating Commercial. East Pilbara differential between commercial and industrial classes " +
      "is ~2.4x — single largest annual uplift in the fixture.",
  },
  {
    kind: "subdivision",
    assessmentNumber: "KAL-7777-01",
    techoneAddress: "211 Hannan Street, Kalgoorlie",
    techoneLandUse: "Commercial",
    landgateAddress: "211A Hannan Street, Kalgoorlie",
    landgateLandUse: "Commercial - retail",
    landgateLotPlan: "Lot 211A DP 411902",
    detectedAt: "2026-05-09T03:11:00Z",
    severityHint: "high",
    reasoning:
      "Landgate now records 211, 211A and 211B Hannan Street as three separately-titled child lots " +
      "(SUB-2025-722, registered Sep 2025). Council is still rating the consolidated parent parcel " +
      "211 Hannan Street. Three rateable parcels currently invoiced as one — fragmentation likely " +
      "doubles aggregate annual rates once correctly assessed.",
  },
  {
    kind: "lot_plan_amend",
    assessmentNumber: "ASH-9911-04",
    techoneAddress: "Lot 9914 Nanutarra-Wittenoom Road, Pannawonica",
    techoneLandUse: "Industrial",
    landgateAddress: "Lot 9914A Nanutarra-Wittenoom Road, Pannawonica",
    landgateLandUse: "Industrial - heavy industry",
    landgateLotPlan: "Lot 9914A DP 552108",
    detectedAt: "2026-05-09T03:11:00Z",
    severityHint: "medium",
    reasoning:
      "Landgate lot/plan revised to Lot 9914A DP 552108 after BA-2026-019 boundary amendment " +
      "(Feb 2026). Council rating record still keyed to the pre-amendment lot reference. Records-only " +
      "discrepancy today but blocks reliable Landgate lookups for every future cross-reference.",
  },
  {
    kind: "industrial_reuse",
    assessmentNumber: "TPS-1102-44",
    techoneAddress: "Lot 1144 Great Northern Highway, Tom Price",
    techoneLandUse: "Rural",
    landgateAddress: "Lot 1144 Great Northern Highway, Tom Price",
    landgateLandUse: "Industrial - mining-related infrastructure",
    landgateLotPlan: "Lot 1144 DP 230711",
    detectedAt: "2026-05-09T03:11:00Z",
    severityHint: "high",
    reasoning:
      "Landgate landuse code now 513 (Industrial - mining-related infrastructure) after parcel was " +
      "converted to a haul-road maintenance depot in 2025. Council still rating Rural at $1,820/yr. " +
      "Mining differential rate applies — reclassification uplift likely 8x.",
  },
  {
    kind: "landuse_reclass",
    assessmentNumber: "MEK-3303-58",
    techoneAddress: "Lot 358 Yulgan Road, Meekatharra",
    techoneLandUse: "Vacant",
    landgateAddress: "Lot 358 Yulgan Road, Meekatharra",
    landgateLandUse: "Mining - tailings reprocessing",
    landgateLotPlan: "Lot 358 DP 992014",
    detectedAt: "2026-05-09T03:11:00Z",
    severityHint: "medium",
    reasoning:
      "Landgate landuse now records tailings reprocessing activity (RPDLU 523) tied to M 51/0902 " +
      "granted March 2026. Council rating still Vacant. Reclassification to mining differential " +
      "warranted; stacks with cadastre-lag signal on the same assessment.",
  },
  {
    kind: "address_renumber",
    assessmentNumber: "KAL-4401-12",
    techoneAddress: "Lot 4412 Goldfields Highway, Kalgoorlie",
    techoneLandUse: "Rural",
    landgateAddress: "Lot 4412A Goldfields Highway, Kalgoorlie",
    landgateLandUse: "Mining - production lease",
    landgateLotPlan: "Lot 4412 DP 218043",
    detectedAt: "2026-05-09T03:11:00Z",
    severityHint: "high",
    reasoning:
      "Landgate cadastre now references the southern portion of the parcel as 4412A after a 2025 boundary " +
      "amendment registered the mining-lease footprint separately. Council rating record uses the pre-split " +
      "address and rural classification. Stacks with cadastre-lag and recently-granted signals.",
  },
]);

/**
 * Group-by-assessment index used by the recovery engine. Built once at
 * module load — the seed list is frozen.
 */
export const SEEDED_ADDRESS_DISCREPANCIES_BY_ASSESSMENT: ReadonlyMap<
  string,
  readonly AddressDiscrepancy[]
> = (() => {
  const out = new Map<string, AddressDiscrepancy[]>();
  for (const d of SEEDED_ADDRESS_DISCREPANCIES) {
    const list = out.get(d.assessmentNumber);
    if (list === undefined) out.set(d.assessmentNumber, [d]);
    else list.push(d);
  }
  return out;
})();

export async function listAddressDiscrepanciesHandler(
  input: schemas.ToolInputs["list_address_discrepancies"],
  _ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const { kind, minSeverity, council } = input;
  const minRank = SEVERITY_RANK[minSeverity];

  const filtered = SEEDED_ADDRESS_DISCREPANCIES.filter((d) => {
    // `council` is injected by the web layer to the caller's tenant for
    // non-admins. Each discrepancy's assessment number embeds its owning
    // council (e.g. `KAL-7777-01`), so a prefix match scopes the set without
    // a separate council field. Omitted (platform_admin) → all councils.
    if (council !== undefined && !d.assessmentNumber.startsWith(`${council}-`))
      return false;
    if (kind !== "all" && d.kind !== (kind as AddressDiscrepancyKind)) return false;
    if (SEVERITY_RANK[d.severityHint] < minRank) return false;
    return true;
  });

  const lines = filtered.map(
    (d, i) =>
      `${i + 1}. [${d.severityHint.toUpperCase()}] ${d.assessmentNumber} (${d.kind}) — ` +
      `council "${d.techoneAddress}" / ${d.techoneLandUse}; ` +
      `Landgate "${d.landgateAddress}" / ${d.landgateLandUse}.`,
  );

  const scopeFragment = council !== undefined ? `, council=${council}` : "";
  const text = [
    `Landgate × rating-record address discrepancies (kind=${kind}, minSeverity=${minSeverity}${scopeFragment}, source=seeded):`,
    `${filtered.length} discrepancy(ies).`,
    "",
    ...lines,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    ok: true,
    output: text,
    data: {
      discrepancies: filtered,
      source: "seeded" as const,
      queriedAt: new Date().toISOString(),
      kind,
      minSeverity,
      ...(council !== undefined ? { council } : {}),
    },
    mutated: false,
  };
}
