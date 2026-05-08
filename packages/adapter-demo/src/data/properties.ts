/**
 * Seeded property records for the demo adapter.
 *
 * Two layers:
 *
 *  1. **Curated properties** — explicitly hand-authored fixtures that drive
 *     the recovery-engine signals. These properties are referenced by
 *     {@link import("./tenements.js").TENEMENT_INTERSECTIONS} and underpin
 *     every demo of mining-mismatch detection. Modifying them will move the
 *     `find_mining_mismatches` results.
 *
 *  2. **Generic properties** — a deterministic generator producing 90
 *     residential/vacant/commercial/rural fixtures that pad the dataset to
 *     realistic council population sizes. Pure function of a counter — the
 *     sequence is reproducible across processes.
 *
 * Every property carries a synthesised cadastral parcel (square around the
 * centroid). Real adapters source parcel geometry from the cadastre.
 */

import type { LandUse, PaymentMethod, Property } from "@ratesassist/contract";

import { parcelSquare } from "./geometry.js";

/** Annual rates as a fraction of valuation, used by the generic generator. */
const RATES_RATE_OF_VALUATION = 0.005;

/** Number of generic properties per locale. 9 locales × 10 = 90 fixtures. */
const GENERIC_PER_LOCALE = 10;

/** ID range for generic owners produced by the owners generator (`O-GEN-030` upward). */
const GENERIC_OWNER_BASE = 30;

/** Total generic owners generated; modular index into this set. */
const GENERIC_OWNER_POOL = 9;

/** Number of streets in the deterministic generator's name pool. */
const STREET_NAMES: readonly string[] = [
  "Acacia",
  "Banksia",
  "Coolibah",
  "Desert Pea",
  "Eucalyptus",
  "Frangipani",
  "Gumnut",
  "Hibiscus",
  "Iron Knob",
  "Jacaranda",
  "Kookaburra",
  "Lemongrass",
  "Mulga",
  "Nullarbor",
  "Outback",
  "Paperbark",
  "Quandong",
  "Redgum",
  "Saltbush",
  "Tea Tree",
  "Underwood",
  "Verticordia",
  "Wattle",
  "Xantorrhoea",
  "Yarra",
  "Zircon",
];

/** Street-type suffixes used by the generic generator. */
const STREET_TYPES: readonly string[] = [
  "Street",
  "Road",
  "Avenue",
  "Drive",
  "Lane",
  "Crescent",
  "Place",
];

/**
 * Internal seed shape — every field on `Property` except the synthesised
 * `parcel`, which we attach uniformly during finalisation.
 */
type PropertySeed = Omit<Property, "parcel">;

/**
 * Hand-curated properties driving the recovery-engine demonstrations. Owners
 * are referenced by their `O-WA-*` / `O-NSW-*` / `O-QLD-*` IDs from
 * {@link import("./owners.js")}.
 */
const CURATED: readonly PropertySeed[] = [
  // ---- TPS — Tom Price ----
  {
    assessmentNumber: "TPS-1102-44",
    council: "TPS",
    address: "Lot 1144 Great Northern Highway",
    suburb: "Tom Price",
    postcode: "6751",
    state: "WA",
    landUse: "Rural",
    valuation: 380_000,
    annualRates: 1_820,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 455,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Rural classification on file since 2014."],
    lat: -22.694,
    lng: 117.7935,
  },
  {
    assessmentNumber: "TPS-1102-47",
    council: "TPS",
    address: "Lot 1147 Great Northern Highway",
    suburb: "Tom Price",
    postcode: "6751",
    state: "WA",
    landUse: "Rural",
    valuation: 410_000,
    annualRates: 1_960,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 490,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Rural classification on file since 2017."],
    lat: -22.6982,
    lng: 117.7892,
  },
  {
    assessmentNumber: "TPS-1102-91",
    council: "TPS",
    address: "Lot 1191 Tom Price Mining Road",
    suburb: "Tom Price",
    postcode: "6751",
    state: "WA",
    landUse: "Rural",
    valuation: 285_000,
    annualRates: 1_200,
    balance: 0,
    lastPaymentDate: "2026-03-20",
    lastPaymentAmount: 300,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Includes light infrastructure access road."],
    lat: -22.7102,
    lng: 117.8011,
  },
  {
    assessmentNumber: "TPS-3041-12",
    council: "TPS",
    address: "12 Stadium Road",
    suburb: "Tom Price",
    postcode: "6751",
    state: "WA",
    landUse: "Residential",
    valuation: 420_000,
    annualRates: 2_140,
    balance: 535,
    lastPaymentDate: "2025-11-04",
    lastPaymentAmount: 535,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-010"],
    notes: ["Q1 2026 instalment overdue 28 days."],
    lat: -22.6885,
    lng: 117.795,
  },
  {
    assessmentNumber: "TPS-3041-44",
    council: "TPS",
    address: "44 Yampire Road",
    suburb: "Tom Price",
    postcode: "6751",
    state: "WA",
    landUse: "Residential",
    valuation: 385_000,
    annualRates: 1_960,
    balance: 0,
    lastPaymentDate: "2026-04-02",
    lastPaymentAmount: 490,
    paymentMethod: "Direct Debit",
    pensionerRebate: true,
    paymentArrangement: false,
    ownerIds: ["O-WA-011"],
    notes: ["Pensioner rebate active (WA $250 + council $200)."],
    lat: -22.6921,
    lng: 117.7903,
  },

  // ---- ESH — East Pilbara ----
  {
    assessmentNumber: "ESH-1102-71",
    council: "ESH",
    address: "Lot 1171 Karratha-Tom Price Road",
    suburb: "Karratha",
    postcode: "6714",
    state: "WA",
    landUse: "Vacant",
    valuation: 240_000,
    annualRates: 980,
    balance: 0,
    lastPaymentDate: "2026-03-15",
    lastPaymentAmount: 245,
    paymentMethod: "Direct Debit",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-002"],
    notes: ["Listed as vacant — last inspection 2021."],
    lat: -20.7364,
    lng: 116.8463,
  },
  {
    assessmentNumber: "ESH-1102-88",
    council: "ESH",
    address: "Lot 1188 Solar Farm Road",
    suburb: "Newman",
    postcode: "6753",
    state: "WA",
    landUse: "Vacant",
    valuation: 180_000,
    annualRates: 720,
    balance: 0,
    lastPaymentDate: "2026-03-15",
    lastPaymentAmount: 180,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-005"],
    notes: ["Vacant per latest revaluation."],
    lat: -23.3614,
    lng: 119.7349,
  },
  {
    assessmentNumber: "ESH-1102-92",
    council: "ESH",
    address: "Lot 1192 Auski Road",
    suburb: "Newman",
    postcode: "6753",
    state: "WA",
    landUse: "Rural",
    valuation: 510_000,
    annualRates: 2_240,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 560,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Rural — but tenement coverage growing."],
    lat: -23.3801,
    lng: 119.7461,
  },
  {
    assessmentNumber: "ESH-7011-08",
    council: "ESH",
    address: "8 Newman Drive",
    suburb: "Newman",
    postcode: "6753",
    state: "WA",
    landUse: "Commercial",
    valuation: 1_840_000,
    annualRates: 12_400,
    balance: 3_100,
    lastPaymentDate: "2025-10-15",
    lastPaymentAmount: 3_100,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: true,
    ownerIds: ["O-WA-012"],
    notes: [
      "12-month payment arrangement signed 2025-09-01.",
      "On track.",
    ],
    lat: -23.3556,
    lng: 119.7281,
  },

  // ---- SST — Sandstone ----
  {
    assessmentNumber: "SST-2204-19",
    council: "SST",
    address: "Lot 219 Sandstone-Mount Magnet Road",
    suburb: "Sandstone",
    postcode: "6639",
    state: "WA",
    landUse: "Rural",
    valuation: 195_000,
    annualRates: 720,
    balance: 0,
    lastPaymentDate: "2026-04-10",
    lastPaymentAmount: 180,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-003"],
    notes: ["Rural classification."],
    lat: -27.9881,
    lng: 119.2944,
  },
  {
    assessmentNumber: "SST-2204-31",
    council: "SST",
    address: "Lot 231 Sandstone-Mount Magnet Road",
    suburb: "Sandstone",
    postcode: "6639",
    state: "WA",
    landUse: "Rural",
    valuation: 175_000,
    annualRates: 660,
    balance: 0,
    lastPaymentDate: "2026-04-10",
    lastPaymentAmount: 165,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-004"],
    notes: ["Rural."],
    lat: -28.0042,
    lng: 119.3122,
  },
  {
    assessmentNumber: "SST-2204-58",
    council: "SST",
    address: "Lot 258 Murchison Highway",
    suburb: "Sandstone",
    postcode: "6639",
    state: "WA",
    landUse: "Vacant",
    valuation: 110_000,
    annualRates: 420,
    balance: 1_260,
    lastPaymentDate: "2024-12-01",
    lastPaymentAmount: 420,
    paymentMethod: "Mail",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-020"],
    notes: ["Out-of-state owner, mail returned twice."],
    lat: -27.976,
    lng: 119.2812,
  },

  // ---- KAL — Kalgoorlie-Boulder ----
  {
    assessmentNumber: "KAL-4401-12",
    council: "KAL",
    address: "Lot 4412 Goldfields Highway",
    suburb: "Kalgoorlie",
    postcode: "6430",
    state: "WA",
    landUse: "Rural",
    valuation: 540_000,
    annualRates: 2_800,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 700,
    paymentMethod: "Direct Debit",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-021"],
    notes: ["Rural; surrounded by active gold tenements."],
    lat: -30.7321,
    lng: 121.4855,
  },
  {
    assessmentNumber: "KAL-4401-45",
    council: "KAL",
    address: "Lot 4445 Boulder Block Road",
    suburb: "Boulder",
    postcode: "6432",
    state: "WA",
    landUse: "Rural",
    valuation: 490_000,
    annualRates: 2_460,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 615,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-021"],
    notes: [],
    lat: -30.7892,
    lng: 121.499,
  },
  {
    assessmentNumber: "KAL-4401-77",
    council: "KAL",
    address: "Lot 4477 Coolgardie Esplanade",
    suburb: "Kalgoorlie",
    postcode: "6430",
    state: "WA",
    landUse: "Vacant",
    valuation: 240_000,
    annualRates: 1_200,
    balance: 0,
    lastPaymentDate: "2026-03-22",
    lastPaymentAmount: 300,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-022"],
    notes: ["Vacant; recent aerial change detected."],
    lat: -30.7522,
    lng: 121.4555,
  },
  {
    assessmentNumber: "KAL-7777-01",
    council: "KAL",
    address: "Hannan Street 211",
    suburb: "Kalgoorlie",
    postcode: "6430",
    state: "WA",
    landUse: "Commercial",
    valuation: 2_100_000,
    annualRates: 14_800,
    balance: 0,
    lastPaymentDate: "2026-04-04",
    lastPaymentAmount: 3_700,
    paymentMethod: "Direct Debit",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-023"],
    notes: ["Heritage facade; CBD frontage."],
    lat: -30.746,
    lng: 121.4694,
  },

  // ---- MEK — Meekatharra ----
  {
    assessmentNumber: "MEK-3303-21",
    council: "MEK",
    address: "Lot 321 Meekatharra-Mount Magnet Road",
    suburb: "Meekatharra",
    postcode: "6642",
    state: "WA",
    landUse: "Rural",
    valuation: 220_000,
    annualRates: 880,
    balance: 0,
    lastPaymentDate: "2026-03-30",
    lastPaymentAmount: 220,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-024"],
    notes: [],
    lat: -26.5897,
    lng: 118.4956,
  },
  {
    assessmentNumber: "MEK-3303-58",
    council: "MEK",
    address: "Lot 358 Yulgan Road",
    suburb: "Meekatharra",
    postcode: "6642",
    state: "WA",
    landUse: "Vacant",
    valuation: 110_000,
    annualRates: 460,
    balance: 0,
    lastPaymentDate: "2026-03-30",
    lastPaymentAmount: 115,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-024"],
    notes: ["Adjacent to gold-rush era dump; tenement covers."],
    lat: -26.571,
    lng: 118.5102,
  },

  // ---- ASH — Ashburton ----
  {
    assessmentNumber: "ASH-9911-04",
    council: "ASH",
    address: "Lot 9914 Nanutarra-Wittenoom Road",
    suburb: "Onslow",
    postcode: "6710",
    state: "WA",
    landUse: "Industrial",
    valuation: 4_200_000,
    annualRates: 38_200,
    balance: 9_550,
    lastPaymentDate: "2025-09-15",
    lastPaymentAmount: 9_550,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: true,
    ownerIds: ["O-WA-025"],
    notes: [
      "Mineral processing facility.",
      "Active payment arrangement, 24-month term.",
    ],
    lat: -22.6981,
    lng: 115.6444,
  },
  {
    assessmentNumber: "ASH-9911-22",
    council: "ASH",
    address: "Lot 9922 Tom Price-Karratha Road",
    suburb: "Pannawonica",
    postcode: "6716",
    state: "WA",
    landUse: "Rural",
    valuation: 360_000,
    annualRates: 1_460,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 365,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Rural — but tenement coverage."],
    lat: -21.6431,
    lng: 116.3388,
  },

  // ---- BRK — Broken Hill ----
  {
    assessmentNumber: "BRK-5512-07",
    council: "BRK",
    address: "12 Argent Street",
    suburb: "Broken Hill",
    postcode: "2880",
    state: "NSW",
    landUse: "Commercial",
    valuation: 880_000,
    annualRates: 6_400,
    balance: 0,
    lastPaymentDate: "2026-04-05",
    lastPaymentAmount: 1_600,
    paymentMethod: "Direct Debit",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-NSW-001"],
    notes: [],
    lat: -31.9573,
    lng: 141.467,
  },
  {
    assessmentNumber: "BRK-5512-19",
    council: "BRK",
    address: "47 Iodide Street",
    suburb: "Broken Hill",
    postcode: "2880",
    state: "NSW",
    landUse: "Residential",
    valuation: 320_000,
    annualRates: 1_840,
    balance: 460,
    lastPaymentDate: "2025-11-15",
    lastPaymentAmount: 460,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-NSW-002"],
    notes: ["Q1 2026 overdue 18 days."],
    lat: -31.959,
    lng: 141.4612,
  },
  {
    assessmentNumber: "BRK-5512-44",
    council: "BRK",
    address: "Lot 4 Silver City Highway",
    suburb: "Broken Hill",
    postcode: "2880",
    state: "NSW",
    landUse: "Rural",
    valuation: 250_000,
    annualRates: 1_240,
    balance: 0,
    lastPaymentDate: "2026-03-25",
    lastPaymentAmount: 310,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-NSW-003"],
    notes: ["Rural; live tenement coverage."],
    lat: -31.9722,
    lng: 141.5102,
  },

  // ---- MTI — Mount Isa ----
  {
    assessmentNumber: "MTI-6601-08",
    council: "MTI",
    address: "Lot 8 Diamantina Drive",
    suburb: "Mount Isa",
    postcode: "4825",
    state: "QLD",
    landUse: "Rural",
    valuation: 290_000,
    annualRates: 1_220,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 305,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-QLD-001"],
    notes: ["Rural; copper-zinc tenement."],
    lat: -20.7256,
    lng: 139.4927,
  },
  {
    assessmentNumber: "MTI-6601-33",
    council: "MTI",
    address: "33 Camooweal Street",
    suburb: "Mount Isa",
    postcode: "4825",
    state: "QLD",
    landUse: "Commercial",
    valuation: 1_080_000,
    annualRates: 8_200,
    balance: 2_050,
    lastPaymentDate: "2025-10-01",
    lastPaymentAmount: 2_050,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-QLD-002"],
    notes: ["Q1 2026 instalment overdue 36 days."],
    lat: -20.7301,
    lng: 139.4894,
  },
];

/**
 * Locale anchors for the generic generator. Mirrors the real population
 * distribution across the eight tenants. Order is load-bearing — the
 * counter-driven generator threads through these in sequence.
 */
const GENERIC_LOCALES: ReadonlyArray<{
  readonly council: string;
  readonly suburb: string;
  readonly postcode: string;
  readonly state: Property["state"];
  readonly lat: number;
  readonly lng: number;
}> = [
  { council: "TPS", suburb: "Tom Price", postcode: "6751", state: "WA", lat: -22.69, lng: 117.792 },
  { council: "ESH", suburb: "Newman", postcode: "6753", state: "WA", lat: -23.357, lng: 119.737 },
  { council: "ESH", suburb: "Karratha", postcode: "6714", state: "WA", lat: -20.738, lng: 116.846 },
  { council: "KAL", suburb: "Kalgoorlie", postcode: "6430", state: "WA", lat: -30.749, lng: 121.469 },
  { council: "KAL", suburb: "Boulder", postcode: "6432", state: "WA", lat: -30.789, lng: 121.498 },
  { council: "MEK", suburb: "Meekatharra", postcode: "6642", state: "WA", lat: -26.589, lng: 118.495 },
  { council: "ASH", suburb: "Onslow", postcode: "6710", state: "WA", lat: -21.642, lng: 115.107 },
  { council: "BRK", suburb: "Broken Hill", postcode: "2880", state: "NSW", lat: -31.959, lng: 141.467 },
  { council: "MTI", suburb: "Mount Isa", postcode: "4825", state: "QLD", lat: -20.725, lng: 139.493 },
];

/**
 * Mathematical-but-deterministic land-use cycle. Indexing into this map
 * keeps the generator readable; the modular cycle preserves exact parity
 * with the legacy generator.
 */
const LANDUSE_CYCLE: readonly LandUse[] = [
  "Residential",
  "Residential",
  "Residential",
  "Residential",
  "Vacant",
  "Commercial",
  "Rural",
];

/**
 * Deterministic payment-method picker for the generator — three-way modular
 * cycle preserved from the legacy generator.
 */
function paymentMethodFor(counter: number): PaymentMethod {
  const r = counter % 3;
  if (r === 0) return "Direct Debit";
  if (r === 1) return "BPAY";
  return "Counter";
}

/**
 * Generate the 90 generic properties. Pure function of an internal counter;
 * the same call always produces the same array. Modifying this function will
 * shift every generic assessment number — DO NOT change its arithmetic
 * without revising downstream snapshots.
 */
function generateGeneric(): readonly PropertySeed[] {
  const out: PropertySeed[] = [];
  let counter = 5_000;
  for (const base of GENERIC_LOCALES) {
    for (let i = 0; i < GENERIC_PER_LOCALE; i++) {
      counter += 1;
      const idx = (counter * 7) % STREET_NAMES.length;
      const stIdx = (counter * 3) % STREET_TYPES.length;
      const ownerOffset = counter % GENERIC_OWNER_POOL;
      const ownerSuffix = (GENERIC_OWNER_BASE + ownerOffset)
        .toString()
        .padStart(3, "0");
      const houseNo = 4 + ((counter * 11) % 200);
      const overdue = counter % 11 === 0;
      const arr = counter % 23 === 0;
      const pens = counter % 17 === 0;
      const valuation = 220_000 + ((counter * 1_337) % 480_000);
      const rates = Math.round(valuation * RATES_RATE_OF_VALUATION);
      const balance = overdue
        ? Math.round(rates * (0.25 + (counter % 4) * 0.25))
        : 0;
      const lat = base.lat + (((counter % 17) - 8) * 0.0009);
      const lng = base.lng + (((counter % 19) - 9) * 0.0011);
      const landUseIndex = counter % LANDUSE_CYCLE.length;
      const landUse =
        LANDUSE_CYCLE[landUseIndex] ??
        // Defensive: the modulus guarantees membership, but
        // `noUncheckedIndexedAccess` requires the fallback.
        "Residential";
      const street = STREET_NAMES[idx] ?? "Acacia";
      const streetType = STREET_TYPES[stIdx] ?? "Street";

      out.push({
        assessmentNumber: `${base.council}-${5_000 + counter}`,
        council: base.council,
        address: `${houseNo} ${street} ${streetType}`,
        suburb: base.suburb,
        postcode: base.postcode,
        state: base.state,
        landUse,
        valuation,
        annualRates: rates,
        balance,
        lastPaymentDate: overdue ? "2025-12-01" : "2026-04-01",
        lastPaymentAmount: Math.round(rates / 4),
        paymentMethod: paymentMethodFor(counter),
        pensionerRebate: pens,
        paymentArrangement: arr && overdue,
        ownerIds: [`O-GEN-${ownerSuffix}`],
        notes: arr ? ["Active payment arrangement."] : [],
        lat,
        lng,
      });
    }
  }
  return out;
}

/**
 * The full property dataset, with synthesised parcel polygons attached.
 * Frozen — mutating callers must produce a new record (the dispatcher's
 * write handlers do this via spread).
 */
export const PROPERTIES: readonly Property[] = Object.freeze(
  [...CURATED, ...generateGeneric()].map((p) => ({
    ...p,
    parcel: parcelSquare(p.lat, p.lng),
  })),
);
