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
];

export function getSignal(id: string): SignalDef | undefined {
  return SIGNAL_CATALOGUE.find((s) => s.id === id);
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
