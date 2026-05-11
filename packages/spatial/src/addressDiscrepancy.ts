/**
 * Address-discrepancy classifier.
 *
 * Compares a council's rating-record view of a parcel (assessment number,
 * address, landuse, optional lot/plan) against the matching Landgate
 * cadastre record. If the two diverge in a way that suggests the council
 * is mis-rating the parcel, classify the divergence into one of five
 * kinds and emit a structured {@link AddressDiscrepancy}.
 *
 * Pure function over plain inputs — no I/O, no clock, no fetch. The
 * caller decides where the two records come from (TechOne export +
 * Landgate restricted-tier API in production; demo fixtures in the
 * mock pathway). See packages/spatial/src/__fixtures__/landgateMock.ts.
 *
 * The classifier is conservative: when the records match byte-for-byte
 * after normalisation, it returns `null`. The recovery engine then
 * silently does NOT fire the `reg.address_mismatch_landgate` signal —
 * no false positives.
 */

export type AddressDiscrepancyKind =
  /** Street number or street name changed (e.g. renumbering, amalgamation). */
  | "address_renumber"
  /** New child lots exist that the council doesn't yet rate separately. */
  | "subdivision"
  /** Landgate landuse classification differs from the council's landUse. */
  | "landuse_reclass"
  /** Rural / vacant parcel converted to industrial / commercial per Landgate. */
  | "industrial_reuse"
  /** Lot / plan reference revised after re-survey or boundary adjustment. */
  | "lot_plan_amend";

export type AddressDiscrepancySeverity = "high" | "medium" | "low";

export type AddressDiscrepancy = {
  readonly kind: AddressDiscrepancyKind;
  readonly assessmentNumber: string;
  readonly techoneAddress: string;
  readonly techoneLandUse: string;
  readonly landgateAddress: string;
  readonly landgateLandUse: string;
  readonly landgateLotPlan: string;
  /** ISO-8601 instant the comparison was made. */
  readonly detectedAt: string;
  readonly severityHint: AddressDiscrepancySeverity;
  /** Verbatim rationale that gets inlined into the evidence pack. */
  readonly reasoning: string;
};

const NORMALISE_RX = /\s+/g;

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(NORMALISE_RX, " ");
}

const INDUSTRIAL_TERMS: readonly string[] = [
  "industrial",
  "industry",
  "commercial",
  "mining",
  "infrastructure",
  "processing",
];

function isIndustrialLanduse(landuse: string): boolean {
  const lower = landuse.toLowerCase();
  return INDUSTRIAL_TERMS.some((t) => lower.includes(t));
}

function isPassiveLanduse(landuse: string): boolean {
  const lower = landuse.toLowerCase();
  return lower.includes("rural") || lower.includes("vacant") || lower.includes("residential");
}

/**
 * Classifier inputs. The TechOne side is whatever the council's rating
 * adapter surfaces today; the Landgate side is what the (restricted-tier)
 * cadastre API would return if the council had a Landgate subscription.
 */
export type CompareAddressRecordsInput = {
  readonly techone: {
    readonly assessmentNumber: string;
    readonly address: string;
    readonly landUse: string;
    readonly lotPlan?: string;
  };
  readonly landgate: {
    readonly address: string;
    readonly landuseDescription: string;
    readonly lotPlan: string;
  };
  /** ISO timestamp injection point so callers (and tests) can pin `detectedAt`. */
  readonly now?: () => string;
};

/**
 * Compare a TechOne rating record against a Landgate cadastre record.
 * Returns the highest-severity discrepancy class that fits, or `null` if
 * the records are equivalent after normalisation. Classification order
 * (highest → lowest severity):
 *
 *   1. industrial_reuse — rural/vacant in council, industrial in Landgate
 *   2. landuse_reclass  — landuse codes differ but neither is industrial
 *   3. subdivision      — Landgate address contains a child-lot suffix
 *      (e.g. "211A", "211B") not in the council's address
 *   4. address_renumber — street number or street name diverged
 *   5. lot_plan_amend   — lot/plan reference revised
 *
 * A record that disagrees on multiple axes returns only the top-ranked
 * class. The recovery engine treats one discrepancy per assessment as
 * one signal hit; if reality is messier, the reasoning string lists the
 * compounding facts.
 */
export function compareAddressRecords(
  input: CompareAddressRecordsInput,
): AddressDiscrepancy | null {
  const { techone, landgate } = input;
  const detectedAt = input.now ? input.now() : new Date().toISOString();

  const tAddr = normalise(techone.address);
  const lAddr = normalise(landgate.address);
  const tUse = normalise(techone.landUse);
  const lUse = normalise(landgate.landuseDescription);
  const tLot = techone.lotPlan ? normalise(techone.lotPlan) : "";
  const lLot = normalise(landgate.lotPlan);

  const addressDiffers = tAddr !== lAddr;
  const landuseDiffers = tUse !== lUse;
  const lotPlanDiffers = tLot !== "" && tLot !== lLot;

  if (!addressDiffers && !landuseDiffers && !lotPlanDiffers) {
    return null;
  }

  const base = {
    assessmentNumber: techone.assessmentNumber,
    techoneAddress: techone.address,
    techoneLandUse: techone.landUse,
    landgateAddress: landgate.address,
    landgateLandUse: landgate.landuseDescription,
    landgateLotPlan: landgate.lotPlan,
    detectedAt,
  } as const;

  // 1) industrial reuse — rural/vacant on council, industrial on Landgate
  if (
    landuseDiffers &&
    isPassiveLanduse(techone.landUse) &&
    isIndustrialLanduse(landgate.landuseDescription)
  ) {
    return {
      ...base,
      kind: "industrial_reuse",
      severityHint: "high",
      reasoning:
        `Landgate landuse "${landgate.landuseDescription}" indicates industrial reuse of a parcel ` +
        `the council still rates as "${techone.landUse}". Lot/plan ${landgate.lotPlan}. ` +
        `Reclassification to the commercial/industrial differential rate is likely warranted.`,
    };
  }

  // 2) generic landuse reclassification
  if (landuseDiffers) {
    return {
      ...base,
      kind: "landuse_reclass",
      severityHint: "medium",
      reasoning:
        `Landgate landuse code "${landgate.landuseDescription}" differs from council rating ` +
        `"${techone.landUse}" for assessment ${techone.assessmentNumber}. Reclassification review required.`,
    };
  }

  // 3) subdivision — Landgate address surfaces a child-lot suffix (211A, 211B)
  if (addressDiffers && /\b\d+[A-Za-z]\b/.test(landgate.address) && !/\b\d+[A-Za-z]\b/.test(techone.address)) {
    return {
      ...base,
      kind: "subdivision",
      severityHint: "high",
      reasoning:
        `Landgate cadastre records child-lot suffix in "${landgate.address}" that does not appear ` +
        `in the council's rated address "${techone.address}". Parent parcel ${techone.assessmentNumber} ` +
        `has been sub-divided; council is still rating the consolidated lot.`,
    };
  }

  // 4) address renumber
  if (addressDiffers) {
    return {
      ...base,
      kind: "address_renumber",
      severityHint: "medium",
      reasoning:
        `Landgate address "${landgate.address}" differs from council address "${techone.address}". ` +
        `Likely street renumbering / amalgamation. Confirm correct parcel attribution before next levy.`,
    };
  }

  // 5) lot/plan amendment (records agree on address+landuse, disagree on lot/plan)
  return {
    ...base,
    kind: "lot_plan_amend",
    severityHint: "low",
    reasoning:
      `Landgate lot/plan reference "${landgate.lotPlan}" differs from council record "${techone.lotPlan ?? "(none)"}". ` +
      `Likely post-survey boundary amendment. Records-only impact unless landuse also moves.`,
  };
}
