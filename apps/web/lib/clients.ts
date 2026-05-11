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
  type EvaluationContext,
} from "@ratesassist/recovery-engine";
import {
  TARGET_STATE_SCOPE,
  type MismatchCandidate,
  type Property,
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
  const propertiesByOwnerId = new Map<string, Property[]>();
  const ruralBySuburb = new Map<string, Property[]>();
  for (const p of PROPERTIES) {
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
    properties: PROPERTIES,
    ownersById,
    tenementsByAssessment,
    propertiesByOwnerId,
    ruralBySuburb,
    lagCandidatesByAssessment: MOCK_LAG_CANDIDATES_BY_ASSESSMENT,
    addressDiscrepanciesByAssessment: MOCK_ADDRESS_DISCREPANCIES_BY_ASSESSMENT,
    targetStateScope: TARGET_STATE_SCOPE,
  };
  return cachedContext;
}

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
