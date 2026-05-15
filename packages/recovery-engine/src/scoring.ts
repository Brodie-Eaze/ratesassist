/**
 * Composite scoring engine. Pure functions over the contract's domain types.
 * Adapters call `evaluateSignals(property, ctx)` to get firing signals; the
 * host composes those into a candidate. Exclusive-group invariants are
 * enforced both in `evaluateSignals` and defensively in `computeComposite`.
 */

import type {
  Encumbrance,
  LandUseCategory,
  MismatchSeverity,
  Owner,
  Pin,
  Property,
  RateTable,
  SignalDef,
  SignalHit,
  StrataChild,
  Tenement,
  TitleSourceFreshness,
  WaterCorpEligibilityStatus,
} from "@ratesassist/contract";

import {
  SEVERITY_BANDS,
  SIGNAL_BY_ID,
  UPLIFT_MULTIPLIER,
  getSignal,
} from "./signals.js";

// Construct a SignalHit explicitly rather than spreading SignalDef — the
// contract forbids `description` and `exclusiveGroup` on hits.
function hit(sig: SignalDef, evidence: string): SignalHit {
  return {
    id: sig.id,
    name: sig.name,
    short: sig.short,
    category: sig.category,
    weight: sig.weight,
    source: sig.source,
    evidence,
  };
}

/**
 * Minimal lag-candidate shape consumed by the scoring engine. Mirrors
 * `@ratesassist/spatial`'s `LagCandidate` but the engine deliberately does
 * NOT depend on the spatial package (it would create a cycle through
 * adapter-demo). Callers map their richer LagCandidate down to this shape.
 */
export type LagCandidateForScoring = {
  readonly severityHint: "high" | "medium" | "low";
  readonly reasoning: string;
};

/**
 * Minimal address-discrepancy shape consumed by the scoring engine.
 * Structurally compatible with {@link AddressDiscrepancy} from
 * `@ratesassist/spatial`; the engine takes only the two fields it needs
 * to fire `reg.address_mismatch_landgate` so the package stays free of
 * the spatial dependency.
 */
export type AddressDiscrepancyForScoring = {
  readonly severityHint: "high" | "medium" | "low";
  readonly reasoning: string;
};

/**
 * Property-lifecycle change record consumed by the six `change.*` signals
 * and the accurate uplift calculator. `kind` selects which signal fires;
 * `correctLandUse` (when known) routes the accurate uplift path;
 * `detectedAt` drives backdating math.
 */
export type ChangeDetectionKind =
  | "subdivision_detected"
  | "construction_approved"
  | "construction_completed"
  | "renovation_detected"
  | "gru_revaluation_pending"
  | "commercial_use_observed";

export type ChangeDetectionEntry = {
  readonly kind: ChangeDetectionKind;
  readonly detectedAt: string;
  readonly reasoning: string;
  /** Hypothesised correct land-use category for the accurate uplift path. */
  readonly correctLandUse?: LandUseCategory;
};

export type EvaluationContext = {
  /** All properties in the active tenant — used for portfolio + outlier signals. */
  readonly properties: readonly Property[];
  /** Owner records keyed by ownerId. */
  readonly ownersById: ReadonlyMap<string, Owner>;
  /** Live tenements that intersect each assessment, keyed by assessmentNumber. */
  readonly tenementsByAssessment: ReadonlyMap<string, readonly Tenement[]>;
  /**
   * O(1) owner-to-properties index. Pre-computed at context construction so
   * `ownerPortfolio` does not re-scan ctx.properties for every property
   * evaluated (PERF-002). Optional for backwards compatibility — if absent
   * we fall back to the linear scan.
   */
  readonly propertiesByOwnerId?: ReadonlyMap<string, readonly Property[]>;
  /**
   * O(1) suburb→rural-properties index. Pre-computed so the
   * `spat.outlier.high_value_rural` percentile lookup does not scan
   * ctx.properties per rural parcel (PERF-003). Optional with linear-scan
   * fallback.
   */
  readonly ruralBySuburb?: ReadonlyMap<string, readonly Property[]>;
  /**
   * Optional cross-register lag-window join, keyed by assessmentNumber.
   * When present and the entry's severityHint is "medium" or "high", the
   * `reg.dmirs_ahead_of_landgate` signal fires for that property. Absent
   * map (or no entry) silently doesn't fire — no false positives if the
   * caller hasn't done the cross-register pull. Honest by construction.
   */
  readonly lagCandidatesByAssessment?: ReadonlyMap<string, readonly LagCandidateForScoring[]>;
  /**
   * Optional Landgate × rating-record address-discrepancy map, keyed by
   * assessmentNumber. When present and an entry has severityHint
   * "medium" or "high", the `reg.address_mismatch_landgate` signal fires
   * for that property. Absent map (or no entry) doesn't fire — no false
   * positives. Mirrors the {@link AddressDiscrepancy} shape in
   * `@ratesassist/spatial` but deliberately re-typed here to avoid a
   * package cycle.
   */
  readonly addressDiscrepanciesByAssessment?: ReadonlyMap<
    string,
    readonly AddressDiscrepancyForScoring[]
  >;
  /**
   * Optional EMITS environmental-approval index keyed by the raw DMIRS
   * tenement id (e.g. `"M  4701612"`). When present and at least one entry
   * for any tenement intersecting the property has `active: true`, the
   * `reg.environmental_approval_active` signal fires once for the property
   * — never multiple times per active approval, to avoid double-counting
   * compounding evidence. Absent map (or no active entry) doesn't fire —
   * honest by construction.
   */
  readonly emitsApprovalsByTenement?: ReadonlyMap<
    string,
    readonly { active: boolean; reasoning: string }[]
  >;
  /**
   * Property-lifecycle change-detection records keyed by assessment
   * number. Each entry carries a `kind` matching one of the six lifecycle
   * change signals plus a `detectedAt` ISO date the accurate uplift
   * calculator uses for backdating math. Absent map = lifecycle signals
   * don't fire.
   */
  readonly changeDetectionByAssessment?: ReadonlyMap<
    string,
    readonly ChangeDetectionEntry[]
  >;
  /**
   * Per-council rate tables keyed by council code. When present and a
   * candidate carries a `correctLandUse` hypothesis + matching change
   * record, `findMismatches` routes through the accurate uplift
   * calculator instead of the heuristic multiplier. Absent map =
   * heuristic-only path.
   */
  readonly rateTablesByCouncil?: ReadonlyMap<string, RateTable>;
  /**
   * Optional state-scope filter. When set, only properties whose
   * `state` matches this code are evaluated. Used to lock the WA-only
   * GTM scope while keeping multi-state fixtures intact. See
   * `TARGET_STATE_SCOPE` in `@ratesassist/contract`.
   */
  readonly targetStateScope?: string;
  /**
   * Wall clock injection point. Production callers can omit this and the
   * engine defaults to `Date.now`. Tests pin it to a fixed millisecond value
   * so time-relative signals (e.g. `reg.tenement.recently_granted`) are
   * deterministic.
   */
  readonly now?: () => number;
  /**
   * Landgate restricted-tier title records keyed by VEN. When present and
   * a property carries a `ven`, the engine cross-references the canonical
   * Landgate state against the council's rating record and fires the
   * VEN/PIN/CT class signals. Absent map (or no entry) = the VEN/PIN/CT
   * signals don't fire. No false positives without an explicit Landgate
   * pull.
   */
  readonly landgateRecordsByVen?: ReadonlyMap<string, {
    readonly ven: string;
    readonly ctVolume: string;
    readonly ctFolio: string;
    readonly ctIssuedDate?: string;
    readonly proprietorOnTitle: string;
    readonly proprietorPostalAddress?: string;
    readonly pins: ReadonlyArray<Pin>;
    readonly encumbrances: ReadonlyArray<Encumbrance>;
    readonly strataChildren?: ReadonlyArray<StrataChild>;
    readonly source: TitleSourceFreshness;
  }>;
  /**
   * Water Corporation eligibility records keyed by either the masked card
   * number or by the proprietor name (whichever the council uploaded as
   * the join key on the WC eligibility CSV). When present and a property's
   * pensioner concession references one of these keys, the concession
   * signals fire on the canonical WC state.
   */
  readonly waterCorpEligibilityByCardOrProprietor?: ReadonlyMap<string, {
    readonly status: WaterCorpEligibilityStatus;
    readonly validFrom?: string;
    readonly validTo?: string;
    readonly cancellationReason?: string;
    readonly cancellationDate?: string;
    readonly retrievedAt: string;
  }>;
  /**
   * Proprietor names known to be deceased — populated from the Water Corp
   * feed's `deceased` rows and/or council probate intake. Used to fire
   * `id.proprietor_deceased` independently of concession state and to
   * compound `id.pensioner_deceased_continued_rebate`.
   *
   * Comparison is done on a normalised form (uppercased, whitespace
   * collapsed, punctuation stripped) to absorb minor data-entry variance
   * between Water Corp and council systems.
   */
  readonly proprietorDeceasedReferences?: ReadonlySet<string>;
};

/** Window (in days) for the `reg.tenement.recently_granted` signal. */
export const RECENTLY_GRANTED_WINDOW_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const INDUSTRY_TERMS: readonly string[] = [
  "iron", "mining", "resources", "minerals", "metals", "gold", "lithium",
  "copper", "zinc", "nickel", "rare earth", "exploration", "prospecting",
  "pastoral", "solar", "energy", "infrastructure",
];

function containsIndustryTerm(name: string): string | null {
  const lower = name.toLowerCase();
  for (const term of INDUSTRY_TERMS) {
    if (lower.includes(term)) return term;
  }
  return null;
}

function ownerOf(p: Property, ctx: EvaluationContext): Owner | undefined {
  const ownerId = p.ownerIds[0];
  return ownerId ? ctx.ownersById.get(ownerId) : undefined;
}

function ownerPortfolio(
  ownerId: string,
  ctx: EvaluationContext,
): { total: number; withTenements: number; pct: number } {
  // PERF-002: prefer the pre-built index; fall back to a linear scan only
  // when the (optional) index is absent (legacy callers / tests).
  const props =
    ctx.propertiesByOwnerId?.get(ownerId) ??
    ctx.properties.filter((p) => p.ownerIds.includes(ownerId));
  let withTen = 0;
  for (const p of props) {
    if ((ctx.tenementsByAssessment.get(p.assessmentNumber) ?? []).length > 0) {
      withTen++;
    }
  }
  return {
    total: props.length,
    withTenements: withTen,
    pct: props.length > 0 ? withTen / props.length : 0,
  };
}

function suburbRuralValuationPercentile(
  p: Property,
  ctx: EvaluationContext,
): number {
  // PERF-003: lookup pre-filtered rural-by-suburb list; fall back to linear
  // scan if the index isn't on this context.
  const ruralPeersInSuburb =
    ctx.ruralBySuburb?.get(p.suburb) ??
    ctx.properties.filter(
      (q) => q.suburb === p.suburb && q.landUse === "Rural",
    );
  const peers = ruralPeersInSuburb.filter(
    (q) => q.assessmentNumber !== p.assessmentNumber,
  );
  // Insufficient peer set to establish percentile; suppress outlier signal
  // rather than risk false positive on lone-rural-parcel suburbs. A neutral
  // 0.5 keeps the property out of both the upper- and lower-decile triggers
  // that downstream signals key off.
  if (peers.length < 2) return 0.5;
  const lower = peers.filter((q) => q.valuation < p.valuation).length;
  return lower / peers.length;
}

// ===== VEN / PIN / CT / Concession helpers =====

/**
 * Normalise a person / entity / address string for equality comparison. Lower
 * cases, strips punctuation, collapses whitespace, and trims. Used so that
 * "Smith, John A." and "SMITH JOHN A" reconcile, and "12 Main St" matches
 * "12 MAIN STREET" once the street-suffix shim below has run.
 */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\.,'`’“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const STREET_SUFFIX_MAP: ReadonlyMap<string, string> = new Map<string, string>([
  ["st", "street"], ["str", "street"],
  ["rd", "road"],
  ["av", "avenue"], ["ave", "avenue"],
  ["bvd", "boulevard"], ["blv", "boulevard"], ["blvd", "boulevard"],
  ["cr", "crescent"], ["cres", "crescent"],
  ["ct", "court"],
  ["dr", "drive"], ["drv", "drive"],
  ["hwy", "highway"],
  ["ln", "lane"],
  ["pde", "parade"],
  ["pl", "place"],
  ["sq", "square"],
  ["tce", "terrace"], ["ter", "terrace"],
  ["wy", "way"],
]);

/**
 * Normalise an Australian property / postal address for equality comparison.
 * Lower-cases, strips punctuation, expands common street-suffix abbreviations,
 * collapses whitespace, and trims. Imperfect (no AS-4590 parse) but enough to
 * make obvious typographical and abbreviation differences reconcile.
 */
function normaliseAddress(address: string): string {
  const baseTokens = normaliseName(address).split(" ");
  const expanded = baseTokens.map((tok) => STREET_SUFFIX_MAP.get(tok) ?? tok);
  return expanded.join(" ");
}

/**
 * Normalise a landuse string to compare a council's rate code (which may be
 * a domain enum like "Industrial") against a Landgate landuse code (which
 * may be a short code like "IND" or a longer human-readable phrase). Two
 * landuse strings are considered equivalent if their normalised forms share
 * a token (e.g. "industrial" matches "ind" or "industrial use").
 *
 * Conservative on purpose: false-positive divergence is preferred to false-
 * negative reconciliation in the spirit of the engine — every hit is human-
 * reviewed and the audit pack carries the raw strings verbatim.
 */
const LANDUSE_CODE_ALIASES: ReadonlyMap<string, string> = new Map<string, string>([
  ["res", "residential"],
  ["resi", "residential"],
  ["com", "commercial"],
  ["comm", "commercial"],
  ["ind", "industrial"],
  ["indust", "industrial"],
  ["vac", "vacant"],
  ["rur", "rural"],
  ["past", "pastoral"],
  ["min", "mining"],
]);

function normaliseLanduse(code: string): string {
  const base = normaliseName(code);
  return LANDUSE_CODE_ALIASES.get(base) ?? base;
}

function landuseMatches(councilCode: string, landgateCode: string): boolean {
  const a = normaliseLanduse(councilCode);
  const b = normaliseLanduse(landgateCode);
  if (a === b) return true;
  // Token-overlap shim: treat as equivalent if either form contains the other
  // (covers "industrial use" matching "industrial" but not the looser
  // "residential industrial estate").
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * Build a freshness label for an evidence string from a TitleSourceFreshness
 * record. Mirrors the source-freshness pattern in the spec — every Landgate /
 * WC-sourced datum carries a `Source: <tier> retrieved <date> (<lag> ago).`
 * tail so the audit pack is self-contained.
 */
function freshnessLabel(source: TitleSourceFreshness, nowMs: number): string {
  const tierName: Record<TitleSourceFreshness["source"], string> = {
    landgate_restricted: "Landgate restricted-tier",
    wc_feed: "Water Corp Quarterly Eligibility Feed",
    slip: "Landgate SLIP (public)",
    council_uploaded_pdf: "council-uploaded CT search PDF",
    map_viewer_plus: "Landgate Map Viewer Plus",
  };
  const tier = tierName[source.source] ?? source.source;
  const retrievedDate = source.retrievedAt.slice(0, 10);
  const retrievedMs = Date.parse(source.retrievedAt);
  if (!Number.isFinite(retrievedMs)) {
    return `Source: ${tier} retrieved ${retrievedDate}.`;
  }
  const ageDays = Math.max(0, Math.floor((nowMs - retrievedMs) / MS_PER_DAY));
  const ageLabel = ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`;
  const caveat = source.lagWarning ? ` ${source.lagWarning}` : "";
  const staleness =
    ageDays > PRIMARY_STALENESS_DAYS
      ? ` Caveat: ${PRIMARY_SOURCE_STALE_CAVEAT}.`
      : "";
  return `Source: ${tier} retrieved ${retrievedDate} (${ageLabel}).${caveat}${staleness}`;
}

/**
 * True if a primary source is >7 days old AND a mismatch is firing. The
 * caveat string is documented in the spec's source-freshness pattern.
 */
const PRIMARY_STALENESS_DAYS = 7;

/** Primary-source-stale caveat string surfaced on candidates. */
export const PRIMARY_SOURCE_STALE_CAVEAT =
  "primary source >7 days old — verify against current source before lodging";

/**
 * True if a Landgate / WC source's `retrievedAt` is older than the staleness
 * threshold. Used by `findMismatches` to attach a `caveats` entry to any
 * candidate whose firing signals rest on stale primary data.
 */
export function isPrimarySourceStale(
  source: TitleSourceFreshness,
  nowMs: number,
): boolean {
  const retrievedMs = Date.parse(source.retrievedAt);
  if (!Number.isFinite(retrievedMs)) return false;
  return nowMs - retrievedMs > PRIMARY_STALENESS_DAYS * MS_PER_DAY;
}

/**
 * Evaluate the 12 VEN/PIN/CT + concession signals on a single property. Pure
 * function — no side effects, deterministic given identical input. Wired
 * into `evaluateSignals` below; exported standalone so adapters / tests can
 * exercise the class in isolation.
 *
 * Dedupe note: `id.pensioner_not_at_property` is the more specific sibling
 * of the (future) generic `id.owner_occupier_concession_mismatch`. When the
 * generic signal has already fired on the same property (i.e. it appears
 * in `existingHits`), we suppress it from the result and emit the pensioner-
 * specific version instead. When the generic signal has NOT fired, the
 * pensioner-specific signal stands alone. Either way the more-specific,
 * higher-relevance signal wins.
 */
export function evaluateVenCtConcessionSignals(
  p: Property,
  ctx: EvaluationContext,
  existingHits: readonly SignalHit[] = [],
): readonly SignalHit[] {
  const hits: SignalHit[] = [];
  const nowMs = (ctx.now ?? Date.now)();

  // ---- VEN/PIN/CT signals (require a Landgate record) ----
  const landgate =
    p.ven && ctx.landgateRecordsByVen
      ? ctx.landgateRecordsByVen.get(p.ven)
      : undefined;

  if (landgate !== undefined) {
    const source = freshnessLabel(landgate.source, nowMs);

    // 1. mismatch.proprietor — Landgate proprietor differs from council's
    // owner of record. Council's "owner of record" is the proprietorOnTitle
    // field if present, else falls back to the property's first owner's
    // name via ownersById.
    const councilProprietor =
      p.proprietorOnTitle ?? ownerOf(p, ctx)?.name ?? null;
    if (
      councilProprietor !== null &&
      normaliseName(councilProprietor) !==
        normaliseName(landgate.proprietorOnTitle)
    ) {
      const sig = getSignal("mismatch.proprietor")!;
      hits.push(
        hit(
          sig,
          `Landgate CT ${landgate.ctVolume}/${landgate.ctFolio} lists proprietor ${landgate.proprietorOnTitle} but council owner of record is ${councilProprietor}. ${source}`,
        ),
      );
    }

    // 2. mismatch.ct_number_changed — council CT volume/folio differs from
    // Landgate. Only fires when both council values are present.
    if (
      p.ctVolume !== undefined &&
      p.ctFolio !== undefined &&
      (p.ctVolume !== landgate.ctVolume || p.ctFolio !== landgate.ctFolio)
    ) {
      const sig = getSignal("mismatch.ct_number_changed")!;
      hits.push(
        hit(
          sig,
          `Council records CT ${p.ctVolume}/${p.ctFolio}; Landgate canonical CT for VEN ${landgate.ven} is ${landgate.ctVolume}/${landgate.ctFolio}. ${source}`,
        ),
      );
    }

    // 3. mismatch.strata_parent_still_rated — Landgate shows children
    // exist on this CT and council is still rating the parent.
    if (landgate.strataChildren && landgate.strataChildren.length > 0) {
      const sig = getSignal("mismatch.strata_parent_still_rated")!;
      const list = landgate.strataChildren
        .map((c) => `CT ${c.volume}/${c.folio}`)
        .join("; ");
      hits.push(
        hit(
          sig,
          `Landgate records ${landgate.strataChildren.length} strata-child CT(s) under parent CT ${landgate.ctVolume}/${landgate.ctFolio} (VEN ${landgate.ven}): ${list}. Council still rating the parent record. ${source}`,
        ),
      );
    }

    // 4. mismatch.encumbrance_added — encumbrances on Landgate not on
    // council. Compared by reference. Fires once per property; evidence
    // enumerates every new encumbrance.
    const councilRefs = new Set(
      (p.encumbrances ?? []).map((e) => e.reference),
    );
    const newEncumbrances = landgate.encumbrances.filter(
      (e) => !councilRefs.has(e.reference),
    );
    if (newEncumbrances.length > 0) {
      const sig = getSignal("mismatch.encumbrance_added")!;
      const list = newEncumbrances
        .map((e) => `${e.type} ${e.reference} (registered ${e.date})`)
        .join("; ");
      hits.push(
        hit(
          sig,
          `Landgate records ${newEncumbrances.length} encumbrance(s) on CT ${landgate.ctVolume}/${landgate.ctFolio} not on council record: ${list}. ${source}`,
        ),
      );
    }

    // 5. mismatch.pin_landuse_diverges — fires once per property if ANY
    // Landgate PIN's landuse differs from the council's rate code.
    const divergentPins = landgate.pins.filter(
      (pin) => !landuseMatches(p.landUse, pin.landuseCode),
    );
    if (divergentPins.length > 0) {
      const sig = getSignal("mismatch.pin_landuse_diverges")!;
      const list = divergentPins
        .map(
          (pin) =>
            `PIN ${pin.pin} (${pin.lotPlan}, ${pin.landuseCode}, ${pin.areaSquareMetres.toLocaleString()} m²)`,
        )
        .join("; ");
      hits.push(
        hit(
          sig,
          `Council rate code "${p.landUse}" diverges from Landgate landuse on ${divergentPins.length} of ${landgate.pins.length} PIN(s): ${list}. ${source}`,
        ),
      );
    }

    // 6. mismatch.pin_missing_from_record — council records fewer PINs
    // than Landgate has on the VEN.
    const councilPinIds = new Set((p.pins ?? []).map((pin) => pin.pin));
    if ((p.pins?.length ?? 0) < landgate.pins.length) {
      const missing = landgate.pins.filter(
        (pin) => !councilPinIds.has(pin.pin),
      );
      const sig = getSignal("mismatch.pin_missing_from_record")!;
      const list = missing
        .map(
          (pin) =>
            `PIN ${pin.pin} (${pin.lotPlan}, ${pin.landuseCode}, ${pin.areaSquareMetres.toLocaleString()} m²)`,
        )
        .join("; ");
      hits.push(
        hit(
          sig,
          `Landgate records ${landgate.pins.length} PIN(s) under VEN ${landgate.ven}; council records ${p.pins?.length ?? 0}. Missing: ${list}. ${source}`,
        ),
      );
    }

    // 7. id.cross_council_pin — VEN's PINs straddle council boundaries.
    const crossCouncilPins = landgate.pins.filter(
      (pin) => pin.councilCode !== undefined && pin.councilCode !== p.council,
    );
    if (crossCouncilPins.length > 0) {
      const sig = getSignal("id.cross_council_pin")!;
      const list = crossCouncilPins
        .map((pin) => `PIN ${pin.pin} (council ${pin.councilCode})`)
        .join("; ");
      hits.push(
        hit(
          sig,
          `${crossCouncilPins.length} of ${landgate.pins.length} PIN(s) under VEN ${landgate.ven} sit in another council's boundary: ${list}. Jurisdictional ambiguity — manual review required. ${source}`,
        ),
      );
    }
  }

  // ---- Concession class signals ----
  // Most key off `p.pensionerConcession?.applied === true`; the deceased-
  // proprietor signal fires independently.
  const concession = p.pensionerConcession;
  const conceSource = p.titleSource;
  const conceSourceLabel = conceSource
    ? freshnessLabel(conceSource, nowMs)
    : "Source: council concession register.";

  const deceasedRefs = ctx.proprietorDeceasedReferences;
  const normalisedProprietor = p.proprietorOnTitle
    ? normaliseName(p.proprietorOnTitle)
    : null;
  const proprietorIsDeceased =
    normalisedProprietor !== null &&
    deceasedRefs !== undefined &&
    [...deceasedRefs].some(
      (ref) => normaliseName(ref) === normalisedProprietor,
    );

  if (concession?.applied === true) {
    // 8. id.pensioner_deceased_continued_rebate
    const wcDeceased = concession.wcEligibilityStatus === "deceased";
    if (wcDeceased || proprietorIsDeceased) {
      const sig = getSignal("id.pensioner_deceased_continued_rebate")!;
      const reasonParts: string[] = [];
      if (wcDeceased) {
        const cancelDate = concession.wcCancellationDate
          ? ` (effective ${concession.wcCancellationDate})`
          : "";
        reasonParts.push(`Water Corp records eligibility status DECEASED${cancelDate}`);
      }
      if (proprietorIsDeceased && !wcDeceased) {
        reasonParts.push(
          `Proprietor ${p.proprietorOnTitle} is on the deceased-references register`,
        );
      }
      hits.push(
        hit(
          sig,
          `Pensioner rebate applied since ${concession.appliedAt} on assessment ${p.assessmentNumber}. ${reasonParts.join("; ")}. Recoverable from the effective cancellation date forward; engage the executor before suspending. ${conceSourceLabel}`,
        ),
      );
    }

    // 9. id.pensioner_eligibility_cancelled
    if (concession.wcEligibilityStatus === "cancelled") {
      const sig = getSignal("id.pensioner_eligibility_cancelled")!;
      const reason = concession.wcCancellationReason
        ? ` Reason: ${concession.wcCancellationReason}.`
        : "";
      const cancelDate = concession.wcCancellationDate
        ? ` Effective ${concession.wcCancellationDate}.`
        : "";
      hits.push(
        hit(
          sig,
          `Pensioner rebate applied since ${concession.appliedAt} but Water Corp records eligibility CANCELLED.${cancelDate}${reason} ${conceSourceLabel}`,
        ),
      );
    }

    // 10. id.pensioner_card_expired
    if (concession.cardExpiry !== undefined) {
      const expiryMs = Date.parse(concession.cardExpiry);
      if (Number.isFinite(expiryMs) && expiryMs < nowMs) {
        const sig = getSignal("id.pensioner_card_expired")!;
        hits.push(
          hit(
            sig,
            `Concession card on file for assessment ${p.assessmentNumber} expired ${concession.cardExpiry}; rebate continuing without a current card. ${conceSourceLabel}`,
          ),
        );
      }
    }

    // 11. id.pensioner_not_at_property — proprietor postal != property
    // address. Dedupe: if `id.owner_occupier_concession_mismatch` has
    // already fired on this property (in existingHits), suppress the
    // generic and emit only the pensioner-specific signal. The dedupe is
    // documented above the signal definition.
    if (
      p.proprietorPostalAddress !== undefined &&
      normaliseAddress(p.proprietorPostalAddress) !==
        normaliseAddress(p.address)
    ) {
      const sig = getSignal("id.pensioner_not_at_property")!;
      hits.push(
        hit(
          sig,
          `Pensioner concession applied to ${p.address} but registered proprietor's postal address is ${p.proprietorPostalAddress}. Eligibility under the Rates and Charges Rebates and Deferments Act 1992 (WA) requires the holder to ordinarily reside at the property. ${conceSourceLabel}`,
        ),
      );
    }
  }

  // 12. id.proprietor_deceased — fires independently of concession state.
  // Only requires the proprietor to appear in the deceased-references set.
  if (proprietorIsDeceased) {
    const sig = getSignal("id.proprietor_deceased")!;
    hits.push(
      hit(
        sig,
        `Registered proprietor ${p.proprietorOnTitle} of assessment ${p.assessmentNumber} is on the deceased-references register. Estate-and-executor workflow required; review rates correspondence routing. ${conceSourceLabel}`,
      ),
    );
  }

  // Dedupe pass: the pensioner-specific not-at-property signal supersedes
  // the generic owner-occupier mismatch when both would otherwise fire.
  // Implemented defensively against `existingHits` — we filter on the
  // returned `hits` only (the generic signal in `existingHits` is removed
  // by the caller in evaluateSignals below).
  return hits;
}

/**
 * Evaluate every signal against a property. Tenement-class signals
 * (`reg.tenement.*`) share an exclusive group — the if/else branching below
 * ensures only one fires; `computeComposite` enforces this defensively too.
 */
export function evaluateSignals(
  p: Property,
  ctx: EvaluationContext,
): readonly SignalHit[] {
  const hits: SignalHit[] = [];
  const tenements = ctx.tenementsByAssessment.get(p.assessmentNumber) ?? [];
  const owner = ownerOf(p, ctx);

  // ---- Tenement-class signals (mutually exclusive) ----
  if (tenements.length > 0 && (p.landUse === "Rural" || p.landUse === "Vacant")) {
    const live = tenements.filter((t) => t.status === "Live");
    const producing = live.filter((t) => t.isProducing);
    const gpls = live.filter((t) => t.type === "G");
    const miningLeases = live.filter((t) => t.type === "M");
    const explorationOnly =
      live.length > 0 && live.every((t) => t.type === "E" || t.type === "P");

    if (producing.some((t) => t.type === "M")) {
      const sig = getSignal("reg.tenement.producing.on_rural_or_vacant")!;
      hits.push(
        hit(
          sig,
          `${producing.length} producing mining lease(s) intersect this parcel: ${producing
            .map((t) => t.tenementId)
            .join(", ")}.`,
        ),
      );
    } else if (gpls.some((t) => t.isProducing) && p.landUse === "Vacant") {
      const sig = getSignal("reg.gpl.producing.on_vacant")!;
      const gpl = gpls.find((t) => t.isProducing)!;
      hits.push(
        hit(
          sig,
          `Producing general-purpose lease ${gpl.tenementId} (${gpl.commodity.join(", ")}) on parcel listed as vacant.`,
        ),
      );
    } else if (miningLeases.length > 0) {
      const sig = getSignal("reg.tenement.live_lease.on_rural_or_vacant")!;
      hits.push(
        hit(
          sig,
          `Live mining lease(s) intersect this parcel: ${miningLeases.map((t) => t.tenementId).join(", ")}.`,
        ),
      );
    } else if (explorationOnly) {
      const sig = getSignal("reg.tenement.exploration_only.on_rural")!;
      hits.push(
        hit(
          sig,
          `Only exploration / prospecting tenement(s) intersect this parcel: ${live
            .map((t) => t.tenementId)
            .join(", ")}.`,
        ),
      );
    }

    // Recently-granted (additive: NOT in tenement-class exclusive group).
    // Adds time-sensitivity on top of the class signal — a producing lease
    // granted last week is more urgent than one granted in 1985.
    const nowMs = (ctx.now ?? Date.now)();
    const windowMs = RECENTLY_GRANTED_WINDOW_DAYS * MS_PER_DAY;
    const recent = live.filter((t) => {
      const granted = Date.parse(t.grantedDate);
      if (Number.isNaN(granted)) return false;
      const ageMs = nowMs - granted;
      return ageMs >= 0 && ageMs <= windowMs;
    });
    if (recent.length > 0) {
      const sig = getSignal("reg.tenement.recently_granted")!;
      const parts = recent.map((t) => {
        const ageDays = Math.floor((nowMs - Date.parse(t.grantedDate)) / MS_PER_DAY);
        return `${t.tenementId} granted ${t.grantedDate} (${ageDays} day${ageDays === 1 ? "" : "s"} ago)`;
      });
      hits.push(
        hit(
          sig,
          `Tenement ${parts.join("; ")} — recently granted; review urgency elevated.`,
        ),
      );
    }
  }

  // ---- HEADLINE: DMIRS ahead of Landgate cadastre ----
  // Fires when the caller has done the cross-register pull and surfaced a
  // medium/high-severity lag candidate for this assessment. No false positives
  // without an explicit lag join, no exclusive group — stacks with everything.
  const lagEntries = ctx.lagCandidatesByAssessment?.get(p.assessmentNumber) ?? [];
  const lagWorth = lagEntries.find(
    (c) => c.severityHint === "high" || c.severityHint === "medium",
  );
  if (lagWorth !== undefined) {
    const sig = getSignal("reg.dmirs_ahead_of_landgate")!;
    hits.push(hit(sig, lagWorth.reasoning));
  }

  // ---- REGISTER: EMITS active environmental approval on intersecting tenement ----
  // Fires once per property when ANY tenement intersecting the property has
  // at least one active EMITS approval. Deliberately not once-per-approval —
  // compounding evidence is already captured by stacking with other signals
  // (cadastre lag, recent grant). Absent map = no firing. No false positives.
  if (ctx.emitsApprovalsByTenement !== undefined && tenements.length > 0) {
    let firedReasoning: string | null = null;
    for (const t of tenements) {
      const list = ctx.emitsApprovalsByTenement.get(t.tenementId) ?? [];
      const activeEntry = list.find((e) => e.active);
      if (activeEntry !== undefined) {
        firedReasoning = activeEntry.reasoning;
        break;
      }
    }
    if (firedReasoning !== null) {
      const sig = getSignal("reg.environmental_approval_active")!;
      hits.push(hit(sig, firedReasoning));
    }
  }

  // ---- HEADLINE: Landgate × rating-record address mismatch ----
  // Fires when the caller has done the Landgate × TechOne reconciliation
  // and surfaced a medium/high-severity address discrepancy. Stacks with
  // cadastre lag, recent grant, etc.
  const discrepancies =
    ctx.addressDiscrepanciesByAssessment?.get(p.assessmentNumber) ?? [];
  const discrepancyWorth = discrepancies.find(
    (d) => d.severityHint === "high" || d.severityHint === "medium",
  );
  if (discrepancyWorth !== undefined) {
    const sig = getSignal("reg.address_mismatch_landgate")!;
    hits.push(hit(sig, discrepancyWorth.reasoning));
  }

  // ---- PROPERTY-LIFECYCLE CHANGE signals ----
  // Each kind maps to one signal id; signals stack additively across
  // *distinct* kinds. Within a kind we deduplicate so duplicate upstream
  // change-detection feed entries cannot double-count the composite (C3).
  const changeEntries =
    ctx.changeDetectionByAssessment?.get(p.assessmentNumber) ?? [];
  const seenChangeKinds = new Set<ChangeDetectionKind>();
  for (const entry of changeEntries) {
    if (seenChangeKinds.has(entry.kind)) {
      // Duplicate upstream entry suppressed — protects composite score.
      continue;
    }
    const sigId = `change.${entry.kind}`;
    const sig = getSignal(sigId);
    if (sig !== undefined) {
      hits.push(hit(sig, entry.reasoning));
      seenChangeKinds.add(entry.kind);
    }
  }

  // ---- Identity: ABN cancelled / suspended ----
  if (owner?.abnCheck.kind === "checked" && owner.abnCheck.status !== "Active") {
    const sig = getSignal("id.abn.cancelled_or_suspended")!;
    hits.push(
      hit(
        sig,
        `Owner ${owner.name} (ABN ${owner.abn ?? "?"}) ABN status: ${owner.abnCheck.status} (checked ${owner.abnCheck.checkedAt}).`,
      ),
    );
  }

  // ---- Identity: tenement holder ≠ rated owner ----
  if (owner && tenements.length > 0) {
    const ownerNameLower = owner.name.toLowerCase();
    const mismatch = tenements.find(
      (t) =>
        t.status === "Live" &&
        !t.holder.toLowerCase().includes(ownerNameLower) &&
        !ownerNameLower.includes(t.holder.toLowerCase()),
    );
    if (mismatch) {
      const sig = getSignal("id.holder_ne_owner")!;
      hits.push(
        hit(
          sig,
          `Tenement ${mismatch.tenementId} holder "${mismatch.holder}" differs from rated owner "${owner.name}".`,
        ),
      );
    }
  }

  // ---- Corporate: industry indicator in owner name vs rural/vacant rate ----
  if (owner && (p.landUse === "Rural" || p.landUse === "Vacant")) {
    const term = containsIndustryTerm(owner.name);
    if (term) {
      const sig = getSignal("id.industry_indicator_in_owner_name")!;
      hits.push(
        hit(
          sig,
          `Owner name "${owner.name}" contains industry term "${term}" but property rated ${p.landUse}.`,
        ),
      );
    }
  }

  // ---- Behavioural: owner portfolio tenement majority ----
  if (owner) {
    const pf = ownerPortfolio(owner.ownerId, ctx);
    if (pf.total >= 3 && pf.pct >= 0.5) {
      const sig = getSignal("beh.owner_portfolio_tenement_majority")!;
      hits.push(
        hit(
          sig,
          `Owner ${owner.name} holds ${pf.total} properties; ${pf.withTenements} (${(pf.pct * 100).toFixed(0)}%) intersect tenements — mining-dominant portfolio.`,
        ),
      );
    }
  }

  // ---- Spatial: high-value rural outlier ----
  if (p.landUse === "Rural") {
    const pct = suburbRuralValuationPercentile(p, ctx);
    if (pct >= 0.85) {
      const sig = getSignal("spat.outlier.high_value_rural")!;
      hits.push(
        hit(
          sig,
          `Valuation $${p.valuation.toLocaleString()} sits in the top ${((1 - pct) * 100).toFixed(0)}% of rural-rated parcels in ${p.suburb} — investigate for undeclared improvements.`,
        ),
      );
    }
  }

  // ---- VEN/PIN/CT + concession signals ----
  // Run last so the dedupe step has access to anything earlier in the
  // pipeline that might fire `id.owner_occupier_concession_mismatch` (not
  // yet in catalogue but documented as the dedupe sibling of
  // `id.pensioner_not_at_property`).
  const venCtConcessionHits = evaluateVenCtConcessionSignals(p, ctx, hits);
  for (const h of venCtConcessionHits) {
    hits.push(h);
  }

  // Dedupe: the pensioner-specific `id.pensioner_not_at_property` signal
  // supersedes the generic `id.owner_occupier_concession_mismatch` when
  // both fire on the same property. Implemented as a post-pass so the
  // dedupe survives future re-ordering of the upstream signal sources.
  const hasPensionerNotAtProperty = hits.some(
    (h) => h.id === "id.pensioner_not_at_property",
  );
  if (hasPensionerNotAtProperty) {
    const idx = hits.findIndex(
      (h) => h.id === "id.owner_occupier_concession_mismatch",
    );
    if (idx >= 0) {
      hits.splice(idx, 1);
    }
  }

  return hits;
}

/**
 * Compose signal hits into a single composite confidence score (0..1),
 * enforcing exclusive-group constraints defensively. Among signals sharing
 * an exclusive group, only the highest-weight hit contributes; ungrouped
 * signals all contribute. Sum is capped at 1.0.
 */
export function computeComposite(hits: readonly SignalHit[]): number {
  if (hits.length === 0) return 0;

  const byGroup = new Map<string, SignalHit>();
  const ungrouped: SignalHit[] = [];

  for (const h of hits) {
    // PERF-004: O(1) Map lookup instead of linear find().
    const def = SIGNAL_BY_ID.get(h.id);
    const group = def?.exclusiveGroup;
    if (!group) {
      ungrouped.push(h);
      continue;
    }
    const existing = byGroup.get(group);
    if (!existing || h.weight > existing.weight) {
      byGroup.set(group, h);
    }
  }

  const sum =
    ungrouped.reduce((s, h) => s + h.weight, 0) +
    [...byGroup.values()].reduce((s, h) => s + h.weight, 0);
  return Math.min(1, sum);
}

export function severityForScore(score: number): MismatchSeverity {
  if (score >= SEVERITY_BANDS.high) return "high";
  if (score >= SEVERITY_BANDS.medium) return "medium";
  return "low";
}

/**
 * Heuristic uplift estimator — kept as a fallback for paths that don't have
 * a per-council rate table + change-detected date wired in. The accurate
 * path is `calculateUplift` in `./upliftCalculator.ts`.
 *
 * Multipliers (8x / 4x / 1.5x) approximate WA Pilbara general:mining,
 * rural:commercial, and review-only uplift ratios respectively. Honest
 * stand-in until rate-table provenance is verified for the council.
 */
export function estimateUpliftHeuristic(
  annualRatesNow: number,
  severity: MismatchSeverity,
): { estAnnualRatesNew: number; estUplift: number; estArrears3y: number } {
  const estAnnualRatesNew = Math.round(annualRatesNow * UPLIFT_MULTIPLIER[severity]);
  const estUplift = estAnnualRatesNew - annualRatesNow;
  const estArrears3y = estUplift * 3;
  return { estAnnualRatesNew, estUplift, estArrears3y };
}

/**
 * @deprecated Use {@link estimateUpliftHeuristic} (or the accurate path via
 * `calculateUplift`). Retained as an alias for backwards compatibility with
 * existing consumers.
 */
export const estimateUplift = estimateUpliftHeuristic;
