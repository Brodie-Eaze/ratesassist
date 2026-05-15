/**
 * @ratesassist/contract — WA differential rate tables for FY 2025-26
 *
 * Per-council, per-landuse rate-in-dollar + minimum-payment schedules for
 * the 6 WA pilot councils. The recovery engine's accurate uplift calculator
 * (`packages/recovery-engine/src/upliftCalculator.ts`) reads these as the
 * authoritative formula input.
 *
 * Provenance & verified flag — IMPORTANT
 * --------------------------------------
 * Every line ships with a `verified` flag and a `sourceUrl` so the council
 * CFO who reviews this can audit every number. Three provenance tiers:
 *
 *   1. `verified: true` — pulled from the council's published annual budget
 *      / schedule of rates for the stated `financialYear`. Source URL +
 *      `retrievedAt` ISO timestamp on the rate-table record.
 *
 *   2. `verified: false` with `note` mentioning "carried forward" — the
 *      council's 2025-26 schedule was not retrievable in the build window;
 *      we use the most-recently-published year and flag `verified: false`
 *      so every downstream caveat string says so. We never silently
 *      backdate.
 *
 *   3. `verified: false` with `note` mentioning "regional average" — used
 *      only when no published schedule is available for any recent year.
 *      Numbers reflect the WA rural-shire average across the Pilbara /
 *      Goldfields belt. Surfaced to the user as "regional benchmark, not
 *      council-specific" so the CFO can correct it on the spot.
 *
 * The UI MUST surface the verified flag and source URL on every uplift
 * card. The evidence pack quotes both verbatim.
 *
 * Refresh status (retrieved 2026-05-14)
 * -------------------------------------
 * Six pilot councils were researched against their adopted 2025-26 annual
 * budget. The general-rate-and-minimum-payment table is the source of
 * truth for the published `rateInDollar` and `minimumPayment` values; the
 * "Objectives and Reasons for Differential Rating" prose is used to
 * confirm category mappings. Per-council provenance details and the
 * "analogue" rationale for categories the council does not separately
 * publish live in `internal/RATE-TABLES-PROVENANCE.md`.
 *
 * Background
 * ----------
 * WA Local Government Act 1995 s.6.32–6.36 governs how councils strike
 * differential rates against either GRV (urban / residential / commercial
 * / industrial) or UV (rural / mining / pastoral). The
 * `LandUseCategory` here is the rating category — NOT the property's
 * physical use. A property's correct category is determined by the
 * Valuer-General's RPDLU code on the cadastral record.
 *
 * Category coverage caveat
 * ------------------------
 * WA councils do NOT all publish a fully-disjoint 8-category schedule.
 * Most publish 4–6 categories and rely on the WA s.6.35 minimum-payment
 * mechanism plus the Valuer-General's classification to handle the rest.
 * Where a council does not publish a category we keep the schema-required
 * 8-category coverage by mapping to the closest published category
 * (documented in the council's `note` field) so the downstream
 * `findRateLine` lookup never returns `undefined` for a valid
 * `LandUseCategory`. The `note` discloses every analogue.
 */

// ===== Local rating-category union =====
//
// The contract's domain `LandUse` covers physical categories. Rating
// schedules in WA councils carve those further (e.g. "Mining other" for
// non-tenement industrial parcels owned by mining companies, "Pastoral"
// distinct from generic rural). We keep this rating-category union local
// to the rate-table module so the domain `LandUse` stays stable.

export type LandUseCategory =
  | "Residential"
  | "Commercial"
  | "Industrial"
  | "Rural"
  | "Vacant"
  | "Mining"
  | "MiningOther"
  | "Pastoral";

export type RateBasis = "GRV" | "UV";

export type DifferentialRateLine = {
  readonly landUse: LandUseCategory;
  /**
   * Rate in the dollar. Expressed as a decimal of $1 (e.g. 0.105 =
   * 10.5 cents per dollar of GRV). Matches the value councils publish
   * in their schedule of rates.
   */
  readonly rateInDollar: number;
  /** Minimum payment AUD per year (the floor). */
  readonly minimumPayment: number;
  readonly basis: RateBasis;
};

export type RateTable = {
  readonly councilCode: string;
  readonly financialYear: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly lines: ReadonlyArray<DifferentialRateLine>;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  /** True when pulled from the council's own published schedule for this FY. */
  readonly verified: boolean;
  /** True when these figures are carried forward from a previous FY. */
  readonly carriedForward?: boolean;
  /** Honest provenance note — surfaced to the UI. */
  readonly note?: string;
};

// ===== Source-of-truth tables =====
//
// Verified 2026-05-14 against each council's adopted 2025-26 annual
// budget. Where a category is not separately published the closest
// published category is used as a documented analogue, called out in the
// table-level `note`. See `internal/RATE-TABLES-PROVENANCE.md` for the
// per-council audit trail.

// ---- City of Kalgoorlie-Boulder (KAL) ----
// Source: 2025/26 Statutory Budget, Note 2(a) — General rates and
// minimum payments, p.7. Published categories: GRV Residential,
// GRV Mining, GRV Commercial/Industrial, GRV Accommodation,
// UV Mining Operations, UV Pastoral/Other.
// Schema-required analogues:
//   - "Industrial"  → GRV Commercial/Industrial (combined category)
//   - "Vacant"      → GRV Commercial/Industrial (vacant non-residential
//                     parcels are explicitly included in CKB's
//                     Commercial/Industrial rate per the differential
//                     rating objectives prose)
//   - "Rural"       → UV Pastoral/Other (no separate rural category)
//   - "MiningOther" → UV Mining Operations (CKB has no separate "Mining
//                     Other" surface; GRV Mining covers town-site
//                     improved leases)
const KAL_TABLE: RateTable = {
  councilCode: "KAL",
  financialYear: "2025-26",
  effectiveFrom: "2025-07-01",
  effectiveTo: "2026-06-30",
  lines: [
    // Verified — GRV Residential, p.7.
    { landUse: "Residential", rateInDollar: 0.053716, minimumPayment: 1169, basis: "GRV" },
    // Verified — GRV Commercial/Industrial, p.7.
    { landUse: "Commercial", rateInDollar: 0.080987, minimumPayment: 1169, basis: "GRV" },
    // Analogue — CKB's Commercial/Industrial is a combined category.
    { landUse: "Industrial", rateInDollar: 0.080987, minimumPayment: 1169, basis: "GRV" },
    // Analogue — vacant non-residential parcels are rated under
    // Commercial/Industrial per CKB's differential-rating objectives.
    { landUse: "Vacant", rateInDollar: 0.080987, minimumPayment: 1169, basis: "GRV" },
    // Verified — UV Pastoral/Other, p.7.
    { landUse: "Rural", rateInDollar: 0.096895, minimumPayment: 364, basis: "UV" },
    { landUse: "Pastoral", rateInDollar: 0.096895, minimumPayment: 364, basis: "UV" },
    // Verified — UV Mining Operations, p.7.
    { landUse: "Mining", rateInDollar: 0.193584, minimumPayment: 455, basis: "UV" },
    // Analogue — CKB does not publish a separate "Mining Other" UV
    // category; UV Mining Operations is the applicable rate.
    { landUse: "MiningOther", rateInDollar: 0.193584, minimumPayment: 455, basis: "UV" },
  ],
  sourceUrl:
    "https://www.ckb.wa.gov.au/Profiles/ckb/Assets/ClientData/2025-26-Statutory-Budget.pdf",
  retrievedAt: "2026-05-14",
  verified: true,
  carriedForward: false,
  note:
    "Verified from CKB 2025/26 Statutory Budget Note 2(a). KAL publishes six categories; Industrial/Vacant are rated under Commercial/Industrial and MiningOther under UV Mining Operations per CKB's differential rating prose.",
};

// ---- Shire of East Pilbara (ESH) ----
// Source: 2025/26 Statutory Budget, Note 2(a) — General rates and
// minimum payments, p.8. Adopted categories: GRV Residential,
// GRV Non-Residential, GRV Transient, UV Pastoral, UV Mining/Others,
// UV Mining Prospecting.
const ESH_TABLE: RateTable = {
  councilCode: "ESH",
  financialYear: "2025-26",
  effectiveFrom: "2025-07-01",
  effectiveTo: "2026-06-30",
  lines: [
    // Verified — GRV Residential 6.75c/$, min $1,185.
    { landUse: "Residential", rateInDollar: 0.067500, minimumPayment: 1185, basis: "GRV" },
    // Verified — GRV Non-Residential 6.75c/$, min $1,400.
    { landUse: "Commercial", rateInDollar: 0.067500, minimumPayment: 1400, basis: "GRV" },
    // Analogue — Non-Residential covers commercial + industrial in ESH.
    { landUse: "Industrial", rateInDollar: 0.067500, minimumPayment: 1400, basis: "GRV" },
    // Analogue — vacant non-residential land is rated under
    // Non-Residential per the differential-rating prose.
    { landUse: "Vacant", rateInDollar: 0.067500, minimumPayment: 1400, basis: "GRV" },
    // Verified — UV Pastoral 20.9c/$, min $1,400.
    { landUse: "Rural", rateInDollar: 0.209000, minimumPayment: 1400, basis: "UV" },
    { landUse: "Pastoral", rateInDollar: 0.209000, minimumPayment: 1400, basis: "UV" },
    // Verified — UV Mining/Others 37.9c/$, min $1,400.
    { landUse: "Mining", rateInDollar: 0.379000, minimumPayment: 1400, basis: "UV" },
    // Verified — UV Mining Prospecting 30.36c/$, min $915.
    { landUse: "MiningOther", rateInDollar: 0.303600, minimumPayment: 915, basis: "UV" },
  ],
  sourceUrl:
    "https://www.eastpilbara.wa.gov.au/documents/1439/202526-statutory-budget",
  retrievedAt: "2026-05-14",
  verified: true,
  carriedForward: false,
  note:
    "Verified from ESH 2025/26 Statutory Budget Note 2(a). GRV Non-Residential covers commercial, industrial and vacant non-residential in ESH; UV Pastoral covers rural land use.",
};

// ---- Shire of Ashburton (ASH) ----
// Source: 2025–2026 Annual Budget, Note 2(a) — General rates and
// minimum payments, p.7. Adopted categories: GRV Residential,
// GRV Commercial/Industrial, GRV Transient Workforce Accommodation,
// UV Pastoral, UV Non-Pastoral (mining). Minimum payment uniform $1,390.
const ASH_TABLE: RateTable = {
  councilCode: "ASH",
  financialYear: "2025-26",
  effectiveFrom: "2025-07-01",
  effectiveTo: "2026-06-30",
  lines: [
    // Verified — GRV Residential 0.06771, min $1,390.
    { landUse: "Residential", rateInDollar: 0.067710, minimumPayment: 1390, basis: "GRV" },
    // Verified — GRV Commercial/Industrial 0.08661, min $1,390.
    { landUse: "Commercial", rateInDollar: 0.086610, minimumPayment: 1390, basis: "GRV" },
    { landUse: "Industrial", rateInDollar: 0.086610, minimumPayment: 1390, basis: "GRV" },
    // Analogue — vacant land rated under Commercial/Industrial per the
    // shire's differential rating prose.
    { landUse: "Vacant", rateInDollar: 0.086610, minimumPayment: 1390, basis: "GRV" },
    // Verified — UV Pastoral 0.19250, min $1,390.
    { landUse: "Rural", rateInDollar: 0.192500, minimumPayment: 1390, basis: "UV" },
    { landUse: "Pastoral", rateInDollar: 0.192500, minimumPayment: 1390, basis: "UV" },
    // Verified — UV Non-Pastoral 0.37950, min $1,390.
    { landUse: "Mining", rateInDollar: 0.379500, minimumPayment: 1390, basis: "UV" },
    // Analogue — ASH publishes a single "Non-Pastoral" UV category that
    // includes mining tenements, refining and processing operations.
    { landUse: "MiningOther", rateInDollar: 0.379500, minimumPayment: 1390, basis: "UV" },
  ],
  sourceUrl:
    "https://www.ashburton.wa.gov.au/documents/410/2025-2026-annual-budget",
  retrievedAt: "2026-05-14",
  verified: true,
  carriedForward: false,
  note:
    "Verified from Shire of Ashburton 2025-2026 Annual Budget Note 2(a). UV Non-Pastoral is the single mining/refining UV category; vacant non-residential parcels are rated under GRV Commercial/Industrial.",
};

// ---- Shire of Tom Price (TPS) ----
// "Tom Price" is a town within the Shire of Ashburton, not a separate
// local government. The TPS code is retained as a deprecated alias so
// existing demo assessment numbers keep resolving — but it points at the
// Ashburton 2025-26 schedule with explicit provenance disclosure. New
// adapter wiring should prefer ASH directly.
const TPS_TABLE: RateTable = {
  ...ASH_TABLE,
  councilCode: "TPS",
  note:
    "TPS is a deprecated alias — Tom Price is a town within the Shire of Ashburton. Rates mirror ASH 2025-26 schedule. New adapter wiring should use ASH directly.",
};

// ---- Shire of Meekatharra (MEK) ----
// Source: 2025-26 Statutory Budget, Annual Budget Notes — Objects and
// Reasons for Differential Rating, p.15-16. Adopted categories: GRV
// (single uniform rate), UV Pastoral, UV Non-Pastoral.
// MEK does NOT carve GRV into residential vs commercial; a single GRV
// rate applies to all townsite assessments per the differential-rating
// prose: "applicable to GRV property assessments having a predominant
// land use of residential, commercial, industrial, community benefit, or
// other use which are located within the townsite".
const MEK_TABLE: RateTable = {
  councilCode: "MEK",
  financialYear: "2025-26",
  effectiveFrom: "2025-07-01",
  effectiveTo: "2026-06-30",
  lines: [
    // Verified — GRV 0.098325, min $414. Single GRV category covers
    // residential, commercial, industrial, community-benefit, vacant.
    { landUse: "Residential", rateInDollar: 0.098325, minimumPayment: 414, basis: "GRV" },
    { landUse: "Commercial", rateInDollar: 0.098325, minimumPayment: 414, basis: "GRV" },
    { landUse: "Industrial", rateInDollar: 0.098325, minimumPayment: 414, basis: "GRV" },
    { landUse: "Vacant", rateInDollar: 0.098325, minimumPayment: 414, basis: "GRV" },
    // Verified — UV Pastoral 0.087975, min $518.
    { landUse: "Rural", rateInDollar: 0.087975, minimumPayment: 518, basis: "UV" },
    { landUse: "Pastoral", rateInDollar: 0.087975, minimumPayment: 518, basis: "UV" },
    // Verified — UV Non-Pastoral 0.250000, min $650.
    { landUse: "Mining", rateInDollar: 0.250000, minimumPayment: 650, basis: "UV" },
    { landUse: "MiningOther", rateInDollar: 0.250000, minimumPayment: 650, basis: "UV" },
  ],
  sourceUrl:
    "https://www.meekashire.wa.gov.au/documents/594/2025-26-statutory-budget",
  retrievedAt: "2026-05-14",
  verified: true,
  carriedForward: false,
  note:
    "Verified from Shire of Meekatharra 2025-26 Statutory Budget Notes (Objects and Reasons for Differential Rating). MEK applies a single GRV rate to all townsite uses (residential/commercial/industrial/vacant) and a single UV Non-Pastoral rate to all mining-related land.",
};

// ---- Shire of Sandstone (SST) ----
// Source: Rating Strategy Objectives & Reasons 2025-2026 + 2025-26
// Statutory Budget (adopted 1 September 2025). Tiny shire (pop. ~80);
// only 4 published rating categories: GRV Townsite, GRV Transient
// Workers Facilities, UV Pastoral, UV Mining.
const SST_TABLE: RateTable = {
  councilCode: "SST",
  financialYear: "2025-26",
  effectiveFrom: "2025-07-01",
  effectiveTo: "2026-06-30",
  lines: [
    // Verified — GRV Townsite 7.2852c/$, min $200.
    { landUse: "Residential", rateInDollar: 0.072852, minimumPayment: 200, basis: "GRV" },
    // Analogue — Sandstone has no separate commercial/industrial GRV
    // category; all townsite uses share the GRV Townsite rate.
    { landUse: "Commercial", rateInDollar: 0.072852, minimumPayment: 200, basis: "GRV" },
    { landUse: "Industrial", rateInDollar: 0.072852, minimumPayment: 200, basis: "GRV" },
    { landUse: "Vacant", rateInDollar: 0.072852, minimumPayment: 200, basis: "GRV" },
    // Verified — UV Pastoral 6.724c/$, min $400.
    { landUse: "Rural", rateInDollar: 0.067240, minimumPayment: 400, basis: "UV" },
    { landUse: "Pastoral", rateInDollar: 0.067240, minimumPayment: 400, basis: "UV" },
    // Verified — UV Mining 29.682c/$, min $400.
    { landUse: "Mining", rateInDollar: 0.296820, minimumPayment: 400, basis: "UV" },
    // Analogue — SST has no Mining Other UV; UV Mining is the only
    // mining-related UV rate per the Rating Strategy.
    { landUse: "MiningOther", rateInDollar: 0.296820, minimumPayment: 400, basis: "UV" },
  ],
  sourceUrl:
    "https://www.sandstone.wa.gov.au/repository/libraries/id:2pgaygvvh17q9smi2m5z/hierarchy/Documents/Council%20Documents/Rating%20Strategy%20Objectives%20%20Reasons%202025-2026.pdf",
  retrievedAt: "2026-05-14",
  verified: true,
  carriedForward: false,
  note:
    "Verified from Shire of Sandstone Rating Strategy Objectives & Reasons 2025-2026 (4 published categories). Schema-required Commercial/Industrial/Vacant fall under GRV Townsite; MiningOther under UV Mining per the Rating Strategy prose.",
};

export const WA_RATE_TABLES: Readonly<Record<string, RateTable>> = Object.freeze({
  TPS: TPS_TABLE,
  ESH: ESH_TABLE,
  SST: SST_TABLE,
  KAL: KAL_TABLE,
  MEK: MEK_TABLE,
  ASH: ASH_TABLE,
});

/** Find a rate line by category. Returns undefined if the table does not
 * carry that category — the calculator surfaces this as a `no_rate_line`
 * error rather than guessing. */
export function findRateLine(
  table: RateTable,
  category: LandUseCategory,
): DifferentialRateLine | undefined {
  return table.lines.find((line) => line.landUse === category);
}

/** Look up a council's rate table by code. */
export function getRateTable(councilCode: string): RateTable | undefined {
  return WA_RATE_TABLES[councilCode];
}
