/**
 * Workspace-package client wiring for `apps/web`.
 *
 * The web app composes types and engines from `@ratesassist/contract`,
 * `@ratesassist/recovery-engine`, and `@ratesassist/identity`. Each of those
 * packages takes its configuration through explicit constructors — they do
 * not read `process.env` themselves. This module is the single place where
 * the web app instantiates those clients and caches them at module scope.
 *
 * Because Next.js may import this module from server components, route
 * handlers, and tool handlers within the same process, the singletons here
 * are intentionally process-local and lazily initialised.
 */

import { createAbnClient, type AbnClient } from "@ratesassist/identity";
import {
  recoveryStats as engineRecoveryStats,
  findMismatches,
  type ChangeDetectionEntry,
  type EvaluationContext,
} from "@ratesassist/recovery-engine";
import {
  TARGET_STATE_SCOPE,
  WA_RATE_TABLES,
  type MismatchCandidate,
  type Property,
  type RateTable,
  type Tenement,
} from "@ratesassist/contract";

import { OWNERS, PROPERTIES, TENEMENTS } from "./data";

/**
 * Default ABN-Lookup base. Library code does not read environment, so we read
 * `ABN_LOOKUP_BASE` here and pass it through to the factory.
 */
const ABN_LOOKUP_BASE: string =
  process.env["ABN_LOOKUP_BASE"] ?? "https://abr.business.gov.au/json";

/**
 * Singleton ABN client. The legacy app silently fell back to mock data on
 * upstream failure even when a GUID was configured; the new client
 * distinguishes "no GUID" (mock allowed) from "live call failed" (returns an
 * error). Web-app callers should treat `ok: false` as a real failure mode.
 *
 * Strict mode is left off in the web app so that local development without an
 * ABN_LOOKUP_GUID still surfaces honest mock results. Pilot deployments will
 * flip `strict: true` via configuration change at deploy time.
 */
export const abnClient: AbnClient = createAbnClient({
  baseUrl: ABN_LOOKUP_BASE,
  guid: process.env["ABN_LOOKUP_GUID"] ?? "",
  strict: process.env.NODE_ENV === "production",
});

// ===== Evaluation context for the recovery engine =====

let cachedContext: EvaluationContext | null = null;

/**
 * Build (and memoise) the {@link EvaluationContext} that the recovery engine
 * sweeps over.
 *
 * The context is constructed once per process from the in-memory data layer:
 * an `ownersById` map and a `tenementsByAssessment` index keyed by the
 * `intersectsAssessmentNumbers` field. The recovery engine then evaluates
 * signals in O(1) per property given the indexes.
 *
 * Phase 1B will replace this in-process context with one populated through
 * the MCP client; the engine's signature stays the same.
 */
/**
 * Synthetic GRV / UV overlays for the demo properties that the accurate
 * uplift calculator needs. Production runs receive these from the
 * Valuer-General's record via the rating-system adapter. For the demo we
 * pin plausible numbers against the same assessments the lifecycle-change
 * mocks reference so the accurate path fires end-to-end.
 */
const VALUATIONS_OVERLAY: ReadonlyMap<
  string,
  { readonly grv?: number; readonly uv?: number }
> = new Map([
  ["TPS-1102-91", { grv: 18_000, uv: 40_400 }],
  ["KAL-4401-12", { grv: 22_500, uv: 63_100 }],
  ["ESH-1102-92", { grv: 19_800, uv: 71_200 }],
  ["TPS-3041-12", { grv: 32_500, uv: 280_000 }],
  ["ESH-7011-08", { grv: 184_000, uv: 1_120_000 }],
  ["KAL-7777-01", { grv: 168_000, uv: 1_350_000 }],
  ["ASH-9911-04", { grv: 412_000, uv: 2_800_000 }],
  ["TPS-1102-44", { grv: 22_000, uv: 55_000 }],
  ["MEK-3303-58", { grv: 8_400, uv: 23_500 }],
  ["NEW-9001-12", { grv: 14_200, uv: 42_000 }],
  ["KAL-7000-08", { grv: 28_500, uv: 145_000 }],
  ["IND-EXP-2200", { grv: 96_000, uv: 540_000 }],
]);

function overlayValuations(props: readonly Property[]): readonly Property[] {
  return props.map((p) => {
    const overlay = VALUATIONS_OVERLAY.get(p.assessmentNumber);
    if (overlay === undefined) return p;
    return { ...p, grv: overlay.grv, uv: overlay.uv };
  });
}

export function getEvaluationContext(): EvaluationContext {
  if (cachedContext !== null) return cachedContext;

  const ownersById = new Map(OWNERS.map((o) => [o.ownerId, o]));

  const tenementsByAssessment = new Map<string, Tenement[]>();
  for (const tenement of TENEMENTS) {
    for (const assessment of tenement.intersectsAssessmentNumbers) {
      const list = tenementsByAssessment.get(assessment);
      if (list === undefined) {
        tenementsByAssessment.set(assessment, [tenement]);
      } else {
        list.push(tenement);
      }
    }
  }

  // PERF-002 / PERF-003: build per-owner and per-suburb-rural indexes in a
  // single pass over PROPERTIES so the scoring engine can look up O(1)
  // instead of re-scanning the full property list on every signal eval.
  const enrichedProperties = overlayValuations(PROPERTIES);
  const propertiesByOwnerId = new Map<string, Property[]>();
  const ruralBySuburb = new Map<string, Property[]>();
  for (const p of enrichedProperties) {
    for (const ownerId of p.ownerIds) {
      const bucket = propertiesByOwnerId.get(ownerId);
      if (bucket === undefined) {
        propertiesByOwnerId.set(ownerId, [p]);
      } else {
        bucket.push(p);
      }
    }
    if (p.landUse === "Rural") {
      const bucket = ruralBySuburb.get(p.suburb);
      if (bucket === undefined) {
        ruralBySuburb.set(p.suburb, [p]);
      } else {
        bucket.push(p);
      }
    }
  }

  cachedContext = {
    properties: enrichedProperties,
    ownersById,
    tenementsByAssessment,
    propertiesByOwnerId,
    ruralBySuburb,
    lagCandidatesByAssessment: MOCK_LAG_CANDIDATES_BY_ASSESSMENT,
    addressDiscrepanciesByAssessment: MOCK_ADDRESS_DISCREPANCIES_BY_ASSESSMENT,
    emitsApprovalsByTenement: MOCK_EMITS_APPROVALS_BY_TENEMENT,
    changeDetectionByAssessment: MOCK_CHANGE_DETECTION_BY_ASSESSMENT,
    rateTablesByCouncil: RATE_TABLES_BY_COUNCIL,
    targetStateScope: TARGET_STATE_SCOPE,
  };
  return cachedContext;
}

const RATE_TABLES_BY_COUNCIL: ReadonlyMap<string, RateTable> = new Map(
  Object.entries(WA_RATE_TABLES),
);

/**
 * Mock property-lifecycle change-detection records. Each entry carries
 * `kind` (matching one of the six `change.*` signals), an ISO
 * `detectedAt` date for backdating math, and an optional `correctLandUse`
 * hypothesis that routes the accurate uplift calculator. Plausible WA
 * narratives across the demo assessments.
 */
const MOCK_CHANGE_DETECTION_BY_ASSESSMENT: ReadonlyMap<
  string,
  readonly ChangeDetectionEntry[]
> = new Map<string, readonly ChangeDetectionEntry[]>([
  [
    "KAL-4401-12",
    [
      {
        kind: "commercial_use_observed",
        detectedAt: "2024-02-15",
        correctLandUse: "Mining",
        reasoning:
          "Nearmap change-feed confirms continuous heavy-vehicle activity and ROM pad construction on Lot 4412 since Feb 2024; tenement M 26/0987 (producing gold) intersects. Rural rating is stale.",
      },
    ],
  ],
  [
    "ESH-1102-92",
    [
      {
        kind: "commercial_use_observed",
        detectedAt: "2023-09-01",
        correctLandUse: "Mining",
        reasoning:
          "Producing iron-ore mining lease M 47/1655 on a parcel still rated Rural since Sep 2023; backdating period exceeds practical 3y cap — statutory 5y cap applies.",
      },
    ],
  ],
  [
    "TPS-3041-12",
    [
      {
        kind: "renovation_detected",
        detectedAt: "2025-03-20",
        correctLandUse: "Residential",
        reasoning:
          "Landgate cadastre records post-renumber address; GRV likely stale after consolidation of lots 12 and 14 (March 2025).",
      },
    ],
  ],
  [
    "ESH-7011-08",
    [
      {
        kind: "construction_completed",
        detectedAt: "2024-07-08",
        correctLandUse: "Industrial",
        reasoning:
          "DA-2025-184 occupancy certificate issued July 2024 for heavy-industrial fitout; council still rating Commercial.",
      },
    ],
  ],
  [
    "KAL-7777-01",
    [
      {
        kind: "subdivision_detected",
        detectedAt: "2025-01-10",
        correctLandUse: "Commercial",
        reasoning:
          "Landgate records 211, 211A, 211B Hannan St as three separately-titled child lots since Jan 2025 (SUB-2025-722). Parent still rated as one parcel.",
      },
    ],
  ],
  [
    "ASH-9911-04",
    [
      {
        kind: "renovation_detected",
        detectedAt: "2024-11-22",
        correctLandUse: "Industrial",
        reasoning:
          "BA-2026-019 boundary amendment in Nov 2024 added processing-plant footprint; GRV revaluation not yet flowed through.",
      },
    ],
  ],
  [
    "TPS-1102-44",
    [
      {
        kind: "commercial_use_observed",
        detectedAt: "2024-05-30",
        correctLandUse: "Industrial",
        reasoning:
          "Aerial feed confirms haul-road maintenance depot on parcel rated Rural since May 2024. Industrial reclassification overdue.",
      },
    ],
  ],
  [
    "MEK-3303-58",
    [
      {
        kind: "commercial_use_observed",
        detectedAt: "2025-02-14",
        correctLandUse: "Mining",
        reasoning:
          "Gold tailings reprocessing tied to M 51/0902 commenced Feb 2025 on parcel still rated Vacant.",
      },
    ],
  ],

  // ----- New lifecycle-demo records (residential / commercial / industrial) -----
  [
    "NEW-9001-12",
    [
      {
        kind: "subdivision_detected",
        detectedAt: "2025-08-04",
        correctLandUse: "Residential",
        reasoning:
          "Landgate registered four child lots (Lots 12A-D) carved from a vacant Karratha block in Aug 2025; council still issues a single rate notice against the parent.",
      },
      {
        kind: "construction_approved",
        detectedAt: "2025-11-10",
        reasoning:
          "DA-2025-411 approves four single-storey dwellings on the subdivided lots; pre-emptive rating-system review prevents arrears compounding.",
      },
    ],
  ],
  [
    "KAL-7000-08",
    [
      {
        kind: "commercial_use_observed",
        detectedAt: "2024-12-01",
        correctLandUse: "Commercial",
        reasoning:
          "Rural shed at Lot 7000 fitted out as a roadside retail outlet since Dec 2024 — signage, customer parking, and EFTPOS activity visible in aerial feed.",
      },
    ],
  ],
  [
    "IND-EXP-2200",
    [
      {
        kind: "construction_completed",
        detectedAt: "2025-06-18",
        correctLandUse: "Industrial",
        reasoning:
          "Factory extension completed June 2025 (occupancy certificate OC-2025-088); GRV revaluation pending.",
      },
      {
        kind: "gru_revaluation_pending",
        detectedAt: "2025-07-01",
        reasoning:
          "Valuer-General's last GRV for this parcel dates from 2022 — past the 3-year cycle for this district.",
      },
    ],
  ],
]);

/**
 * Mock cadastre-lag candidates for the demo.
 *
 * Each entry represents a parcel where a DMIRS tenement is registered but
 * the underlying Landgate title record does NOT yet list that tenement
 * number as an interest/encumbrance. The council's normal Lot-Plan lookup
 * therefore misses the mining activity and the parcel keeps being rated
 * from its old landuse code (Rural / Vacant).
 *
 * In production this map is populated by the cross-register pull in
 * scripts/lag-window-pull.ts (DMIRS × Landgate-restricted-tier). For demo
 * we hand-curate plausible entries against properties whose addresses
 * already telegraph the narrative (Tom Price Mining Road, Goldfields
 * Highway, Auski Road, etc.).
 *
 * Each reasoning string follows the shape the
 * `reg.dmirs_ahead_of_landgate` signal renders verbatim into the evidence
 * pack — tenement id, type, grant date, parcel landuse, lag days,
 * reclassification consequence.
 */
const MOCK_LAG_CANDIDATES_BY_ASSESSMENT: ReadonlyMap<
  string,
  ReadonlyArray<{ severityHint: "high" | "medium" | "low"; reasoning: string }>
> = new Map([
  [
    "TPS-1102-91",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Tenement M 47/1612 (Mining Lease — iron ore) granted 2026-03-18 (54 days ago) intersects Lot 1191 Tom Price Mining Road. Landgate title does not yet list M 47/1612 as a registered interest. Current rating: Rural. Reclassification window open.",
      },
    ],
  ],
  [
    "KAL-4401-12",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Tenement M 26/0987 (Mining Lease — gold, producing) granted 2026-04-02 (39 days ago) intersects Lot 4412 Goldfields Highway. Landgate title omits the tenement number. Current rating: Rural at $2,800/yr; Kalgoorlie-Boulder mining differential rate applies.",
      },
    ],
  ],
  [
    "ASH-9911-22",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Tenement M 47/1709 (Mining Lease — iron ore) granted 2026-02-11 (89 days ago) intersects Lot 9922 Tom Price-Karratha Road. Landgate title last refreshed 2025-12; tenement notation missing. Current rating: Rural.",
      },
    ],
  ],
  [
    "KAL-4401-77",
    [
      {
        severityHint: "medium" as const,
        reasoning:
          "Tenement G 26/0123 (General-Purpose Lease — mineral processing infrastructure) granted 2026-04-19 (22 days ago) intersects Lot 4477 Coolgardie Esplanade. Landgate title shows no interest. Current rating: Vacant.",
      },
    ],
  ],
  [
    "MEK-3303-58",
    [
      {
        severityHint: "medium" as const,
        reasoning:
          "Tenement M 51/0902 (Mining Lease — gold tailings reprocessing) granted 2026-03-30 (42 days ago) intersects Lot 358 Yulgan Road. Adjacent to gold-rush era dump. Landgate title not updated. Current rating: Vacant.",
      },
    ],
  ],
  [
    "ESH-1102-92",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Tenement M 47/1655 (Mining Lease — iron ore, producing) granted 2026-01-28 (103 days ago) intersects Lot 1192 Auski Road. Landgate title shows the parcel free of mining interests. Current rating: Rural.",
      },
    ],
  ],
]);

/**
 * Mock Landgate × rating-record address-discrepancy entries.
 *
 * Each entry mirrors the {@link AddressDiscrepancy} contract from
 * `@ratesassist/spatial`. The recovery engine consumes only
 * `severityHint` and `reasoning` so the wider shape is informational only
 * — the UI doesn't render this map directly. In production this map is
 * populated by reconciling the council's TechOne export against the
 * council-licensed Landgate restricted-tier feed (see
 * internal/LANDGATE-ACCESS.md). For demo we hand-curate plausible
 * narratives against WA-only assessments.
 */
const MOCK_ADDRESS_DISCREPANCIES_BY_ASSESSMENT: ReadonlyMap<
  string,
  ReadonlyArray<{ severityHint: "high" | "medium" | "low"; reasoning: string }>
> = new Map([
  [
    "TPS-3041-12",
    [
      {
        severityHint: "medium" as const,
        reasoning:
          "Landgate cadastre records the parcel as 14 Stadium Road, Tom Price (RPDLU 211, residential). Council rating record carries 12 Stadium Road — consistent with post-2024 street renumbering after lots 12 and 14 were consolidated. Address-of-record correction required before the next levy run.",
      },
    ],
  ],
  [
    "ESH-7011-08",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Landgate updated landuse to Industrial - heavy industry (RPDLU 511) following DA-2025-184 in Nov 2025. Council still rating Commercial. East Pilbara differential between commercial and industrial classes is ~2.4x.",
      },
    ],
  ],
  [
    "KAL-7777-01",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Landgate now records 211, 211A and 211B Hannan Street as three separately-titled child lots (SUB-2025-722, Sep 2025). Council is still rating the consolidated parent parcel. Three rateable parcels currently invoiced as one.",
      },
    ],
  ],
  [
    "ASH-9911-04",
    [
      {
        severityHint: "medium" as const,
        reasoning:
          "Landgate lot/plan revised to Lot 9914A DP 552108 after BA-2026-019 boundary amendment (Feb 2026). Council rating record still keyed to the pre-amendment lot reference — records-only discrepancy today but blocks reliable Landgate lookups for every future cross-reference.",
      },
    ],
  ],
  [
    "TPS-1102-44",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Landgate landuse code now 513 (Industrial - mining-related infrastructure) after parcel converted to a haul-road maintenance depot in 2025. Council still rating Rural at $1,820/yr. Mining differential rate applies — uplift likely 8x.",
      },
    ],
  ],
  [
    "MEK-3303-58",
    [
      {
        severityHint: "medium" as const,
        reasoning:
          "Landgate landuse now records tailings reprocessing (RPDLU 523) tied to M 51/0902 granted March 2026. Council rating still Vacant. Stacks with cadastre-lag signal on the same assessment.",
      },
    ],
  ],
  [
    "KAL-4401-12",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Landgate cadastre now references the southern portion of the parcel as 4412A after a 2025 boundary amendment registered the mining-lease footprint separately. Council rating record uses the pre-split address and rural classification. Stacks with cadastre-lag and recently-granted signals.",
      },
    ],
  ],
]);

/**
 * Mock DMIRS EMITS environmental approvals, keyed by tenement id.
 *
 * EMITS publishes no public machine-readable export today (see
 * internal/SIGNAL-environmental-approval.md). This map mirrors the seed
 * pool the adapter-demo handler ships, but rekeyed against the
 * slash-format tenement ids that the web-app's in-memory data layer
 * uses (e.g. `M70/1284`) so the recovery engine's
 * `reg.environmental_approval_active` signal compounds correctly with the
 * cadastre-lag rows for the same assessments.
 *
 * Each entry carries `active: true|false` and a verbatim `reasoning`
 * string the signal renders into the evidence pack.
 */
const MOCK_EMITS_APPROVALS_BY_TENEMENT: ReadonlyMap<
  string,
  ReadonlyArray<{ active: boolean; reasoning: string }>
> = new Map([
  [
    "M70/1284",
    [
      {
        active: true,
        reasoning:
          "EMITS records active Mining Proposal MP-12345 (approved 2025-09-12, expires 2030-09-12) for tenement M70/1284. Scope: iron ore open-pit pre-strip and ROM pad. Active environmental approval is strong evidence of on-ground works.",
      },
    ],
  ],
  [
    "M70/1411",
    [
      {
        active: true,
        reasoning:
          "EMITS records active Programme of Work POW-98711 (approved 2026-01-04, expires 2026-12-31) for tenement M70/1411. Scope: Year 1 iron-ore production at Tom Price.",
      },
    ],
  ],
  [
    "M70/1502",
    [
      {
        active: true,
        reasoning:
          "EMITS records active Mine Management Plan MMP-44091 (approved 2026-02-28, expires 2031-02-28) for tenement M70/1502. Scope: iron ore haul-road, water management and rehab schedule.",
      },
    ],
  ],
  [
    "M26/0444",
    [
      {
        active: true,
        reasoning:
          "EMITS records active Mining Proposal MP-13988 (approved 2026-01-28, expires 2031-01-28) for tenement M26/0444. Scope: gold production at Kalgoorlie-Boulder.",
      },
    ],
  ],
  [
    "M51/0144",
    [
      {
        active: true,
        reasoning:
          "EMITS records active Programme of Work POW-71248 (approved 2026-03-30, expires 2027-03-30) for tenement M51/0144. Scope: gold tailings reprocessing at Meekatharra.",
      },
    ],
  ],
  [
    "M08/0211",
    [
      {
        active: true,
        reasoning:
          "EMITS records active Mining Proposal MP-15004 (approved 2025-11-19, expires 2030-11-19) for tenement M08/0211. Scope: mineral-sands processing at Onslow.",
      },
    ],
  ],
  [
    "G26/0119",
    [
      {
        active: false,
        reasoning:
          "EMITS records expired Programme of Work POW-30221 (approved 2021-04-12, expired 2024-04-12) for tenement G26/0119. Historical entry only — included for completeness; does not fire the signal.",
      },
    ],
  ],
]);

/**
 * Reset the memoised {@link EvaluationContext} so the next call to
 * {@link getEvaluationContext} rebuilds from the underlying data.
 *
 * Mutation handlers in `apps/web/lib/tools.ts` (e.g. `add_property_note`,
 * `update_owner_contact`, payment-arrangement bookings) MUST call this
 * function after a successful commit so subsequent recovery-engine sweeps
 * observe the new state. Without it, mutations are invisible until the
 * process restarts.
 */
export function invalidateEvaluationContext(): void {
  cachedContext = null;
}

// ===== Recovery stats — legacy-shape helper =====
//
// The new `recoveryStats` from `@ratesassist/recovery-engine` returns a
// readonly aggregate keyed by `bySeverity` and `*Aud`-suffixed monetary
// fields. The web app's UI and `recovery_summary` tool currently consume the
// legacy shape (`high`, `medium`, `low`, `totalUplift`, etc.). Rather than
// touching every consumer in this refactor, we expose a thin adapter that
// produces the legacy shape from the new aggregate.
//
// The legacy shape will be retired alongside the in-process data layer in
// Phase 1B; until then, every consumer is funnelled through this helper so
// there is exactly one place to delete.

/**
 * Web-app-shaped recovery summary. Composed from the engine's
 * {@link engineRecoveryStats} output plus a couple of derived counts the UI
 * needs (per-severity totals at the top level, total recovery as a
 * convenience).
 */
export type WebRecoveryStats = {
  readonly total: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly totalUplift: number;
  readonly highUplift: number;
  readonly totalArrears: number;
  readonly totalRecovery: number;
  readonly signalCounts: Readonly<Record<string, number>>;
};

/**
 * Compute web-app-shaped recovery stats for the given (optional) council
 * filter. Calls the engine internally so callers do not need to wire up the
 * evaluation context themselves.
 */
export function recoveryStatsForWeb(councilCode?: string): WebRecoveryStats {
  const ctx = getEvaluationContext();
  const candidates: readonly MismatchCandidate[] =
    councilCode !== undefined
      ? findMismatches(ctx, { council: councilCode })
      : findMismatches(ctx);
  return webStatsFromCandidates(candidates);
}

/**
 * PERF-001: stats overload for callers that have already computed the
 * candidate set. Avoids the double `findMismatches` sweep that
 * `/api/data` was doing (once explicitly + once inside
 * `recoveryStatsForWeb`). Same legacy-shape output.
 */
export function recoveryStatsFor(
  candidates: readonly MismatchCandidate[],
): WebRecoveryStats {
  return webStatsFromCandidates(candidates);
}

function webStatsFromCandidates(
  candidates: readonly MismatchCandidate[],
): WebRecoveryStats {
  const s = engineRecoveryStats(candidates);
  return {
    total: s.total,
    high: s.bySeverity.high,
    medium: s.bySeverity.medium,
    low: s.bySeverity.low,
    totalUplift: s.totalUpliftAud,
    highUplift: s.highSeverityUpliftAud,
    totalArrears: s.totalArrears3yAud,
    totalRecovery: s.totalRecoveryAud,
    signalCounts: s.signalCounts,
  };
}
