/**
 * Detection signal catalogue.
 *
 * Each signal is a hypothesis about why a property might be mis-rated, with
 * a calibrated weight, an authoritative source, and a category. Signals
 * compose into a transparent weighted-additive composite score.
 *
 * Stability: weights have been hand-calibrated against pilot-1 data. They
 * will be replaced by an ML-calibrated head once enough labelled outcomes
 * are accumulated (Phase 8). Until then, every weight here is auditable
 * and every signal hit cites its source in the evidence pack.
 */

import type { SignalDef } from "@ratesassist/contract";

export const SIGNAL_CATALOGUE: readonly SignalDef[] = [
  // ---- REGISTER signals (authoritative state/federal mining + cadastral data) ----
  {
    id: "reg.tenement.producing.on_rural_or_vacant",
    name: "Producing tenement on rural/vacant rate",
    short: "Producing tenement",
    category: "register",
    weight: 0.55,
    exclusiveGroup: "tenement-class",
    description:
      "Property currently rated rural or vacant, but a producing mining lease intersects the parcel. Strongest single-source recovery signal.",
    source: "DMIRS MINEDEX (WA) / state mining registers",
  },
  {
    id: "reg.tenement.live_lease.on_rural_or_vacant",
    name: "Live mining lease on rural/vacant rate",
    short: "Live lease",
    category: "register",
    weight: 0.45,
    exclusiveGroup: "tenement-class",
    description:
      "Live mining lease (M-class) intersects parcel; production status unconfirmed but lease is granted, statutory basis for reclassification still applies.",
    source: "DMIRS MINEDEX",
  },
  {
    id: "reg.gpl.producing.on_vacant",
    name: "Producing general-purpose lease on vacant rate",
    short: "Producing GPL",
    category: "register",
    weight: 0.55,
    exclusiveGroup: "tenement-class",
    description:
      "Property listed as vacant but a producing general-purpose lease (typically solar farms or mining infrastructure) intersects the parcel.",
    source: "DMIRS MINEDEX",
  },
  {
    id: "reg.tenement.recently_granted",
    name: "Tenement granted within last 90 days",
    short: "Recent grant",
    category: "register",
    weight: 0.40,
    // NOT in tenement-class exclusive group — this fires IN ADDITION to
    // the producing/live/exploration-only signals because it adds the
    // time-sensitivity dimension. A producing mining lease granted last
    // week is more urgent than one granted in 1985.
    description:
      "Intersecting tenement was granted within the last 90 days. Recently granted licences carry both higher recovery urgency (current rates classification has not yet caught up) and the 30-day wardens-court appeal risk if grantdate is within 30 days.",
    source: "DMIRS MINEDEX (grantdate field)",
  },
  {
    id: "reg.tenement.exploration_only.on_rural",
    name: "Exploration tenement only — review",
    short: "Exploration only",
    category: "register",
    weight: 0.20,
    exclusiveGroup: "tenement-class",
    description:
      "Only exploration / prospecting tenements intersect parcel. Reclassification depends on actual ground disturbance — flagged for officer review with aerial-imagery cross-check before action.",
    source: "DMIRS MINEDEX",
  },

  // ---- HEADLINE: DMIRS ahead of Landgate cadastre ----
  {
    id: "reg.dmirs_ahead_of_landgate",
    name: "DMIRS tenement ahead of Landgate cadastre",
    short: "Cadastre lag",
    category: "register",
    weight: 0.50,
    // NOT in tenement-class exclusive group — stacks with recently_granted,
    // producing_tenement, etc. The headline edge of the platform.
    description:
      "Live DMIRS tenement intersects a Landgate cadastre parcel whose landuse code does not yet reflect the mining activity. This is the reclassification lag window — the highest-confidence recovery opportunity, ahead of any council audit cycle.",
    source: "DMIRS MINEDEX × Landgate cadastre (Property_and_Planning/MapServer)",
  },

  // ---- REGISTER: EMITS environmental approval active on a tenement ----
  {
    id: "reg.environmental_approval_active",
    name: "Active environmental approval on tenement",
    short: "Env. approval",
    category: "register",
    weight: 0.30,
    // NOT in tenement-class exclusive group — stacks with cadastre-lag,
    // recently_granted, producing_tenement, etc. Compounding evidence that
    // the tenement is being actively worked on the ground.
    description:
      "EMITS records an active environmental approval (Mining Proposal, Programme of Work, or equivalent) for a tenement intersecting this parcel — strong evidence the tenement is being worked on the ground. Compounds with cadastre lag and recent-grant signals.",
    source: "DMIRS EMITS (Environmental Management & Tracking)",
  },

  // ---- HEADLINE: Landgate address / landuse mismatch with rating record ----
  {
    id: "reg.address_mismatch_landgate",
    name: "Landgate address/landuse differs from rating record",
    short: "Address mismatch",
    category: "register",
    weight: 0.40,
    // NOT in tenement-class exclusive group — stacks with cadastre lag,
    // recent grant, etc. Each mismatch is a mis-rated parcel until
    // reconciled.
    description:
      "Landgate cadastre carries a different address, lot/plan, or landuse code for this parcel than the council rating record. Covers residential renumbering, sub-divisions, reclassifications, and industrial reuse — each one is a mis-rated parcel until reconciled.",
    source: "Landgate cadastre × council rating record",
  },

  // ---- IDENTITY signals (ABN / ASIC) ----
  {
    id: "id.abn.cancelled_or_suspended",
    name: "Owner ABN cancelled or suspended",
    short: "ABN cancelled",
    category: "identity",
    weight: 0.30,
    description:
      "The corporate entity registered as ratepayer is no longer an active ABN. Rates correspondence may be uncollectable; ownership often shifted without title transfer being registered.",
    source: "ATO ABN Lookup",
  },
  {
    id: "id.holder_ne_owner",
    name: "Tenement holder differs from rated owner",
    short: "Holder ≠ owner",
    category: "identity",
    weight: 0.30,
    description:
      "DMIRS-registered tenement holder is not the property's rated owner. Common after tenement transfer when council records were not updated.",
    source: "DMIRS + council rating record",
  },
  {
    id: "id.industry_indicator_in_owner_name",
    name: "Industry indicator in owner name vs rural rate",
    short: "Industry name",
    category: "corporate",
    weight: 0.20,
    description:
      "Registered owner name contains a mining-, resources- or industry-specific term (e.g. 'Iron', 'Resources', 'Mining', 'Solar') yet the parcel is rated rural / vacant. Soft signal; compounds with tenement coverage.",
    source: "ASIC company register + ABN Lookup",
  },

  // ---- BEHAVIOURAL / PORTFOLIO signals ----
  {
    id: "beh.owner_portfolio_tenement_majority",
    name: "Owner portfolio is mining-dominant",
    short: "Mining portfolio",
    category: "behavioural",
    weight: 0.20,
    description:
      "Owner holds ≥3 properties in the council portfolio AND ≥50% of those have tenement coverage. Suggests mining-business ratepayer; outliers in their portfolio rated rural deserve review.",
    source: "Internal portfolio analysis",
  },

  // ---- SPATIAL signals ----
  {
    id: "spat.outlier.high_value_rural",
    name: "High-value rural — outlier in suburb",
    short: "High-value rural",
    category: "spatial",
    weight: 0.15,
    description:
      "Property rated rural but valuation is in the top 10% of rural-rated parcels in the suburb. Often indicates undeclared improvements or commercial use.",
    source: "Internal spatial-pattern analysis",
  },

  // ---- AERIAL signals (Nearmap / Geoscape change detection) ----
  {
    id: "aerial.change_detected_recent",
    name: "Recent aerial change detected",
    short: "Aerial change",
    category: "aerial",
    weight: 0.30,
    description:
      "Nearmap AI change-detection feed flagged a structural or land-use change since last rates classification review (new structures, clearing, solar arrays, vehicle/equipment activity).",
    source: "Nearmap AI change feed",
  },

  // ---- PROPERTY-LIFECYCLE CHANGE signals ----
  // Each fires from a changeDetectionByAssessment map entry. They stack
  // additively — a parcel that was subdivided, then had construction
  // approved, then had construction completed compounds. No exclusiveGroup
  // because each is independent evidence of a distinct lifecycle step.
  {
    id: "change.subdivision_detected",
    name: "Subdivision detected — parent still rated as one parcel",
    short: "Subdivision",
    category: "register",
    weight: 0.45,
    description:
      "Landgate has registered child lots from a subdivision but council is still rating the consolidated parent. Each child lot is separately rateable from registration date.",
    source: "Landgate cadastre (parent/child lot diff)",
  },
  {
    id: "change.construction_approved",
    name: "Construction approved (DA register hit)",
    short: "DA approved",
    category: "register",
    weight: 0.30,
    description:
      "Development Application register shows an approval that has not yet flowed to the rating record. Pre-emptive review prevents arrears compounding silently.",
    source: "Council DA register",
  },
  {
    id: "change.construction_completed",
    name: "Construction completed (occupancy / aerial)",
    short: "Construction complete",
    category: "aerial",
    weight: 0.40,
    description:
      "Occupancy certificate issued or aerial change feed shows completed structures on a parcel still rated Vacant. Reclassification is overdue.",
    source: "Council occupancy register / Nearmap AI",
  },
  {
    id: "change.renovation_detected",
    name: "Renovation / alteration detected",
    short: "Renovation",
    category: "aerial",
    weight: 0.20,
    description:
      "DA amendment or aerial change-feed indicates structural alteration since last GRV; valuation likely stale.",
    source: "Council DA amendments / Nearmap AI",
  },
  {
    id: "change.gru_revaluation_pending",
    name: "GRV revaluation pending — stale Valuer-General record",
    short: "GRV stale",
    category: "register",
    weight: 0.15,
    description:
      "Valuer-General's GRV record is past its 3-year revaluation cycle; rates are being struck against a stale value while a documented change is on file.",
    source: "Landgate / Valuer-General revaluation cycle",
  },
  {
    id: "change.commercial_use_observed",
    name: "Commercial activity observed on rural-rated land",
    short: "Commercial use",
    category: "aerial",
    weight: 0.35,
    description:
      "Aerial / change-feed shows sustained commercial activity (signage, vehicle activity, customer parking, fitout) on land still rated Rural. Reclassification to Commercial likely applies.",
    source: "Nearmap AI change feed + council fieldcheck",
  },

  // ---- VEN / PIN / CT class signals (7) ----
  // All stack additively (no exclusive group). Sourced from the council's
  // Landgate restricted-tier subscription (primary) reconciled against the
  // council's own rating record. Every firing carries the
  // {@link TitleSourceFreshness} retrieved-at timestamp in its evidence
  // string so audit-defensibility is preserved end-to-end.
  {
    id: "mismatch.proprietor",
    name: "Landgate proprietor differs from council owner of record",
    short: "Proprietor mismatch",
    category: "identity",
    weight: 0.40,
    description:
      "Landgate's registered proprietor on the Certificate of Title differs from the council's owner of record. Typical cause is an unregistered title transfer or a council record that was not updated when ownership changed. Rates correspondence may be going to the wrong party and the rating record itself needs reconciliation against the canonical Landgate proprietor.",
    source: "Landgate restricted-tier × council rating record",
  },
  {
    id: "mismatch.ct_number_changed",
    name: "Certificate of Title volume/folio changed",
    short: "CT changed",
    category: "register",
    weight: 0.35,
    description:
      "Volume / folio recorded against this assessment differs from Landgate's current CT for the parcel. Usually indicates a re-issued title (subdivision parent superseded, replacement after loss, or strata conversion) that the council's rating record has not caught up with.",
    source: "Landgate restricted-tier × council rating record",
  },
  {
    id: "mismatch.strata_parent_still_rated",
    name: "Strata parent still rated — children exist on title",
    short: "Strata parent",
    category: "register",
    weight: 0.55,
    description:
      "Landgate records show this CT has been strata-subdivided and child titles have issued, yet the council is still rating the parent record. Each child is separately rateable from the date of registration. Highest-impact register signal in this class — surfaces strata-conversion lifecycle workflow.",
    source: "Landgate restricted-tier (strata register)",
  },
  {
    id: "mismatch.encumbrance_added",
    name: "New encumbrance on title since last review",
    short: "Encumbrance added",
    category: "register",
    weight: 0.25,
    description:
      "A mortgage, easement, caveat, tenement notation, or covenant has been registered against the title that the council's record does not reflect. Often signals a change of control, financing event, or competing interest that may affect ratepayer identity, postal address, or recovery routing.",
    source: "Landgate restricted-tier (encumbrances register)",
  },
  {
    id: "mismatch.pin_landuse_diverges",
    name: "Landgate PIN landuse diverges from council rate code",
    short: "PIN landuse",
    category: "register",
    weight: 0.40,
    description:
      "One or more PINs under this VEN carry a Landgate landuse classification that differs from the council's rate code on the assessment. Fires once per property when ANY PIN diverges; evidence enumerates every divergent PIN with its lot/plan and area so the clerk can compute the area-share impact.",
    source: "Landgate restricted-tier (cadastre × landuse)",
  },
  {
    id: "mismatch.pin_missing_from_record",
    name: "Council records fewer PINs than Landgate has on the VEN",
    short: "Missing PIN",
    category: "register",
    weight: 0.30,
    description:
      "Landgate has more PINs registered under this VEN than the council's rating record carries. Typically indicates a recent subdivision that has not yet flowed to the council, an inherited record from prior council mergers, or a data-entry omission. Every missing PIN is a potential rateable parcel the council is not billing.",
    source: "Landgate restricted-tier (VEN → PIN cardinality)",
  },
  {
    id: "id.cross_council_pin",
    name: "PIN straddles council boundaries — jurisdictional ambiguity",
    short: "Cross-council",
    category: "identity",
    weight: 0.25,
    description:
      "At least one PIN under this VEN sits inside another council's boundary. Two councils may have a claim on rating jurisdiction — surfaces for manual review and confirmation with the neighbouring council. Routes to a separate workflow queue (not standard recovery flow).",
    source: "Landgate restricted-tier × council boundary register",
  },

  // ---- Concession class signals (5) ----
  // All stack additively. Authority on eligibility is the Water Corporation
  // quarterly feed (Rates and Charges Rebates and Deferments Act 1992 WA).
  // `id.pensioner_not_at_property` is the more specific sibling of the
  // generic owner-occupier mismatch and takes precedence when both would
  // fire on the same property (dedupe handled in scoring.ts).
  {
    id: "id.pensioner_deceased_continued_rebate",
    name: "Pensioner rebate applied to a deceased holder",
    short: "Pensioner deceased",
    category: "identity",
    weight: 0.50,
    description:
      "Council is still applying the pensioner rebate on this assessment but a death notification has been recorded against the holder (Water Corp eligibility feed or proprietor-deceased register). Recoverable from the effective cancellation date forward; engage the executor before suspending.",
    source: "Water Corp Quarterly Eligibility Feed × council concession register",
  },
  {
    id: "id.pensioner_eligibility_cancelled",
    name: "Water Corp eligibility cancelled — rebate continuing",
    short: "Pensioner cancelled",
    category: "identity",
    weight: 0.40,
    description:
      "Water Corporation has cancelled the pensioner's eligibility (income test, card surrender, or property change) yet the council is still applying the rebate. Recoverable from the cancellation effective date forward.",
    source: "Water Corp Quarterly Eligibility Feed",
  },
  {
    id: "id.pensioner_card_expired",
    name: "Pensioner concession card expired",
    short: "Card expired",
    category: "identity",
    weight: 0.25,
    description:
      "The concession card on file has lapsed and has not been renewed. Eligibility cannot be confirmed without a current card — rebate should be suspended pending renewal or removed if the holder no longer qualifies.",
    source: "Council concession register (cardExpiry field)",
  },
  {
    id: "id.pensioner_not_at_property",
    name: "Pensioner proprietor postal differs from property address",
    short: "Pensioner off-site",
    category: "identity",
    weight: 0.40,
    description:
      "Pensioner concession applied to a property whose registered proprietor's postal address does not match the property address. Eligibility under the Rates and Charges Rebates and Deferments Act 1992 (WA) requires the holder to ordinarily reside at the property. Takes precedence over the generic `id.owner_occupier_concession_mismatch` when both would fire on the same property.",
    source: "Landgate restricted-tier × council concession register",
  },
  {
    id: "id.proprietor_deceased",
    name: "Registered proprietor recorded as deceased",
    short: "Proprietor deceased",
    category: "identity",
    weight: 0.50,
    description:
      "A death notification has been recorded against the registered proprietor on this title (Water Corp feed, council probate intake, or proprietor-deceased register), independent of concession state. Triggers an estate-and-executor workflow; rates correspondence routing must be reviewed.",
    source: "Water Corp / council probate register / proprietor-deceased references",
  },
];

/**
 * O(1) lookup index built once at module load. Avoids the linear find()
 * scan that ran on every call to getSignal() / computeComposite() — a hot
 * path during portfolio sweeps (PERF-004).
 */
export const SIGNAL_BY_ID: ReadonlyMap<string, SignalDef> = new Map(
  SIGNAL_CATALOGUE.map((s) => [s.id, s]),
);

export function getSignal(id: string): SignalDef | undefined {
  return SIGNAL_BY_ID.get(id);
}

/**
 * Severity bands. Bands are calibrated so a single register signal alone
 * (≥0.45) is medium; register + identity (≥0.60) is high; anything below
 * 0.15 is suppressed.
 */
export const SEVERITY_BANDS = {
  high: 0.6,
  medium: 0.35,
  low: 0.15,
} as const;

/**
 * Heuristic uplift ratios pending integration of per-council differential
 * rate tables. 8x ≈ general:mining ratio in WA Pilbara councils; 4x ≈ rural
 * → commercial; 1.5x soft uplift for review-only candidates.
 */
export const UPLIFT_MULTIPLIER = {
  high: 8,
  medium: 4,
  low: 1.5,
} as const;
