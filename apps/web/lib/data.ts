/**
 * In-memory data layer for `apps/web`.
 *
 * Mirrors the production schema in `RatesAssist.md` §9 and seeds 8 councils,
 * 120+ properties, 25+ tenements, owners, transactions, integration cards,
 * the activity log, and the bank-deposit reconciliation view.
 *
 * Domain types (`Property`, `Owner`, `Tenement`, etc.) come from
 * `@ratesassist/contract` via the local `@/lib/types` re-export module. The
 * web-app-only types (`Integration`, `ActivityEvent`, `BankDeposit`) remain
 * local until they are promoted to the contract.
 *
 * Phase 1B will retire this file and have the web app read the same dataset
 * over MCP from `@ratesassist/adapter-demo`. Until that lands, this module is
 * the single in-process data source for the UI.
 */

import type {
  ActivityEvent,
  BankDeposit,
  Council,
  Integration,
  Owner,
  Property,
  Tenement,
  Transaction,
} from "./types";

// ===== Councils =====

export const COUNCILS: Council[] = [
  { code: "TPS", name: "Shire of Tom Price",       state: "WA", population: 8_200,  rateableProperties: 3_450,  rateRevenue: 18_400_000, centerLat: -22.6940, centerLng: 117.7935 },
  { code: "ESH", name: "Shire of East Pilbara",    state: "WA", population: 11_400, rateableProperties: 5_120,  rateRevenue: 31_700_000, centerLat: -23.3556, centerLng: 119.7281 },
  { code: "SST", name: "Shire of Sandstone",       state: "WA", population: 145,    rateableProperties: 320,    rateRevenue: 2_140_000,  centerLat: -27.9881, centerLng: 119.2944 },
  { code: "KAL", name: "City of Kalgoorlie-Boulder",state: "WA", population: 30_700, rateableProperties: 14_800, rateRevenue: 92_300_000, centerLat: -30.7489, centerLng: 121.4660 },
  { code: "MEK", name: "Shire of Meekatharra",     state: "WA", population: 770,    rateableProperties: 540,    rateRevenue: 6_200_000,  centerLat: -26.5897, centerLng: 118.4956 },
  { code: "ASH", name: "Shire of Ashburton",       state: "WA", population: 12_700, rateableProperties: 4_900,  rateRevenue: 41_500_000, centerLat: -22.6981, centerLng: 115.6444 },
  { code: "BRK", name: "Broken Hill City Council", state: "NSW",population: 17_500, rateableProperties: 9_400,  rateRevenue: 22_100_000, centerLat: -31.9573, centerLng: 141.4670 },
  { code: "MTI", name: "Shire of Mount Isa",       state: "QLD",population: 18_400, rateableProperties: 7_800,  rateRevenue: 28_400_000, centerLat: -20.7256, centerLng: 139.4927 },
];

// Helper: square parcel around a centroid (~30m square, demo-friendly)
function parcel(lat: number, lng: number, sizeM: number = 50): [number, number][] {
  const dLat = sizeM / 111_111;
  const dLng = sizeM / (111_111 * Math.cos((lat * Math.PI) / 180));
  return [
    [lat - dLat, lng - dLng],
    [lat - dLat, lng + dLng],
    [lat + dLat, lng + dLng],
    [lat + dLat, lng - dLng],
  ];
}

// Helper: tenement polygon (rough rectangle around a centroid)
function tenementPolygon(
  lat: number,
  lng: number,
  hectares: number,
): [number, number][] {
  // 1 ha = 10,000 m². Approximate as a square ⇒ side = sqrt(area * 10_000)
  const sideM = Math.sqrt(hectares * 10_000);
  const dLat = sideM / 2 / 111_111;
  const dLng = sideM / 2 / (111_111 * Math.cos((lat * Math.PI) / 180));
  // Slightly irregular hexagon for visual interest
  return [
    [lat - dLat, lng - dLng * 0.7],
    [lat - dLat * 0.7, lng + dLng * 0.9],
    [lat + dLat * 0.4, lng + dLng],
    [lat + dLat, lng + dLng * 0.5],
    [lat + dLat * 0.6, lng - dLng * 0.8],
    [lat - dLat * 0.3, lng - dLng],
  ];
}

// ===== Properties =====
// Curated mining-mismatch and operational properties up front; bulk generic at end.

const CURATED: Omit<Property, "parcel">[] = [
  // ---- TPS — Tom Price ----
  { assessmentNumber: "TPS-1102-44", council: "TPS", address: "Lot 1144 Great Northern Highway", suburb: "Tom Price", postcode: "6751", state: "WA", landUse: "Rural",      valuation: 380_000, annualRates: 1_820, balance: 0, lastPaymentDate: "2026-04-01", lastPaymentAmount: 455, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-001"], notes: ["Rural classification on file since 2014."], lat: -22.6940, lng: 117.7935 },
  { assessmentNumber: "TPS-1102-47", council: "TPS", address: "Lot 1147 Great Northern Highway", suburb: "Tom Price", postcode: "6751", state: "WA", landUse: "Rural",      valuation: 410_000, annualRates: 1_960, balance: 0, lastPaymentDate: "2026-04-01", lastPaymentAmount: 490, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-001"], notes: ["Rural classification on file since 2017."], lat: -22.6982, lng: 117.7892 },
  { assessmentNumber: "TPS-1102-91", council: "TPS", address: "Lot 1191 Tom Price Mining Road",  suburb: "Tom Price", postcode: "6751", state: "WA", landUse: "Rural",      valuation: 285_000, annualRates: 1_200, balance: 0, lastPaymentDate: "2026-03-20", lastPaymentAmount: 300, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-001"], notes: ["Includes light infrastructure access road."], lat: -22.7102, lng: 117.8011 },
  { assessmentNumber: "TPS-3041-12", council: "TPS", address: "12 Stadium Road",                 suburb: "Tom Price", postcode: "6751", state: "WA", landUse: "Residential",valuation: 420_000, annualRates: 2_140, balance: 535, lastPaymentDate: "2025-11-04", lastPaymentAmount: 535, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-010"], notes: ["Q1 2026 instalment overdue 28 days."], lat: -22.6885, lng: 117.7950 },
  { assessmentNumber: "TPS-3041-44", council: "TPS", address: "44 Yampire Road",                 suburb: "Tom Price", postcode: "6751", state: "WA", landUse: "Residential",valuation: 385_000, annualRates: 1_960, balance: 0,   lastPaymentDate: "2026-04-02", lastPaymentAmount: 490, paymentMethod: "Direct Debit", pensionerRebate: true, paymentArrangement: false, ownerIds: ["O-WA-011"], notes: ["Pensioner rebate active (WA $250 + council $200)."], lat: -22.6921, lng: 117.7903 },

  // ---- ESH — East Pilbara ----
  { assessmentNumber: "ESH-1102-71", council: "ESH", address: "Lot 1171 Karratha-Tom Price Road",suburb: "Karratha",  postcode: "6714", state: "WA", landUse: "Vacant",     valuation: 240_000, annualRates: 980,   balance: 0,   lastPaymentDate: "2026-03-15", lastPaymentAmount: 245, paymentMethod: "Direct Debit", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-002"], notes: ["Listed as vacant — last inspection 2021."], lat: -20.7364, lng: 116.8463 },
  { assessmentNumber: "ESH-1102-88", council: "ESH", address: "Lot 1188 Solar Farm Road",        suburb: "Newman",    postcode: "6753", state: "WA", landUse: "Vacant",     valuation: 180_000, annualRates: 720,   balance: 0,   lastPaymentDate: "2026-03-15", lastPaymentAmount: 180, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-005"], notes: ["Vacant per latest revaluation."], lat: -23.3614, lng: 119.7349 },
  { assessmentNumber: "ESH-1102-92", council: "ESH", address: "Lot 1192 Auski Road",             suburb: "Newman",    postcode: "6753", state: "WA", landUse: "Rural",      valuation: 510_000, annualRates: 2_240, balance: 0,   lastPaymentDate: "2026-04-01", lastPaymentAmount: 560, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-001"], notes: ["Rural — but tenement coverage growing."], lat: -23.3801, lng: 119.7461 },
  { assessmentNumber: "ESH-7011-08", council: "ESH", address: "8 Newman Drive",                  suburb: "Newman",    postcode: "6753", state: "WA", landUse: "Commercial", valuation: 1_840_000, annualRates: 12_400, balance: 3_100, lastPaymentDate: "2025-10-15", lastPaymentAmount: 3_100, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: true,  ownerIds: ["O-WA-012"], notes: ["12-month payment arrangement signed 2025-09-01.", "On track."], lat: -23.3556, lng: 119.7281 },

  // ---- SST — Sandstone ----
  { assessmentNumber: "SST-2204-19", council: "SST", address: "Lot 219 Sandstone-Mount Magnet Road", suburb: "Sandstone", postcode: "6639", state: "WA", landUse: "Rural", valuation: 195_000, annualRates: 720, balance: 0, lastPaymentDate: "2026-04-10", lastPaymentAmount: 180, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-003"], notes: ["Rural classification."], lat: -27.9881, lng: 119.2944 },
  { assessmentNumber: "SST-2204-31", council: "SST", address: "Lot 231 Sandstone-Mount Magnet Road", suburb: "Sandstone", postcode: "6639", state: "WA", landUse: "Rural", valuation: 175_000, annualRates: 660, balance: 0, lastPaymentDate: "2026-04-10", lastPaymentAmount: 165, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-004"], notes: ["Rural."], lat: -28.0042, lng: 119.3122 },
  { assessmentNumber: "SST-2204-58", council: "SST", address: "Lot 258 Murchison Highway", suburb: "Sandstone", postcode: "6639", state: "WA", landUse: "Vacant", valuation: 110_000, annualRates: 420, balance: 1_260, lastPaymentDate: "2024-12-01", lastPaymentAmount: 420, paymentMethod: "Mail", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-020"], notes: ["Out-of-state owner, mail returned twice."], lat: -27.9760, lng: 119.2812 },

  // ---- KAL — Kalgoorlie-Boulder ----
  { assessmentNumber: "KAL-4401-12", council: "KAL", address: "Lot 4412 Goldfields Highway", suburb: "Kalgoorlie", postcode: "6430", state: "WA", landUse: "Rural", valuation: 540_000, annualRates: 2_800, balance: 0, lastPaymentDate: "2026-04-01", lastPaymentAmount: 700, paymentMethod: "Direct Debit", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-021"], notes: ["Rural; surrounded by active gold tenements."], lat: -30.7321, lng: 121.4855 },
  { assessmentNumber: "KAL-4401-45", council: "KAL", address: "Lot 4445 Boulder Block Road", suburb: "Boulder",    postcode: "6432", state: "WA", landUse: "Rural", valuation: 490_000, annualRates: 2_460, balance: 0, lastPaymentDate: "2026-04-01", lastPaymentAmount: 615, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-021"], notes: [], lat: -30.7892, lng: 121.4990 },
  { assessmentNumber: "KAL-4401-77", council: "KAL", address: "Lot 4477 Coolgardie Esplanade",suburb: "Kalgoorlie", postcode: "6430", state: "WA", landUse: "Vacant", valuation: 240_000, annualRates: 1_200, balance: 0, lastPaymentDate: "2026-03-22", lastPaymentAmount: 300, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-022"], notes: ["Vacant; recent aerial change detected."], lat: -30.7522, lng: 121.4555 },
  { assessmentNumber: "KAL-7777-01", council: "KAL", address: "Hannan Street 211",            suburb: "Kalgoorlie", postcode: "6430", state: "WA", landUse: "Commercial", valuation: 2_100_000, annualRates: 14_800, balance: 0, lastPaymentDate: "2026-04-04", lastPaymentAmount: 3_700, paymentMethod: "Direct Debit", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-023"], notes: ["Heritage façade; CBD frontage."], lat: -30.7460, lng: 121.4694 },

  // ---- MEK — Meekatharra ----
  { assessmentNumber: "MEK-3303-21", council: "MEK", address: "Lot 321 Meekatharra-Mount Magnet Road", suburb: "Meekatharra", postcode: "6642", state: "WA", landUse: "Rural", valuation: 220_000, annualRates: 880, balance: 0, lastPaymentDate: "2026-03-30", lastPaymentAmount: 220, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-024"], notes: [], lat: -26.5897, lng: 118.4956 },
  { assessmentNumber: "MEK-3303-58", council: "MEK", address: "Lot 358 Yulgan Road",                  suburb: "Meekatharra", postcode: "6642", state: "WA", landUse: "Vacant", valuation: 110_000, annualRates: 460, balance: 0, lastPaymentDate: "2026-03-30", lastPaymentAmount: 115, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-024"], notes: ["Adjacent to gold-rush era dump; tenement covers."], lat: -26.5710, lng: 118.5102 },

  // ---- ASH — Ashburton ----
  { assessmentNumber: "ASH-9911-04", council: "ASH", address: "Lot 9914 Nanutarra-Wittenoom Road", suburb: "Onslow", postcode: "6710", state: "WA", landUse: "Industrial", valuation: 4_200_000, annualRates: 38_200, balance: 9_550, lastPaymentDate: "2025-09-15", lastPaymentAmount: 9_550, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: true, ownerIds: ["O-WA-025"], notes: ["Mineral processing facility.", "Active payment arrangement, 24-month term."], lat: -22.6981, lng: 115.6444 },
  { assessmentNumber: "ASH-9911-22", council: "ASH", address: "Lot 9922 Tom Price-Karratha Road",  suburb: "Pannawonica", postcode: "6716", state: "WA", landUse: "Rural", valuation: 360_000, annualRates: 1_460, balance: 0, lastPaymentDate: "2026-04-01", lastPaymentAmount: 365, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-WA-001"], notes: ["Rural — but tenement coverage."], lat: -21.6431, lng: 116.3388 },

  // ---- BRK — Broken Hill ----
  { assessmentNumber: "BRK-5512-07", council: "BRK", address: "12 Argent Street",  suburb: "Broken Hill", postcode: "2880", state: "NSW", landUse: "Commercial", valuation: 880_000, annualRates: 6_400, balance: 0, lastPaymentDate: "2026-04-05", lastPaymentAmount: 1_600, paymentMethod: "Direct Debit", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-NSW-001"], notes: [], lat: -31.9573, lng: 141.4670 },
  { assessmentNumber: "BRK-5512-19", council: "BRK", address: "47 Iodide Street",  suburb: "Broken Hill", postcode: "2880", state: "NSW", landUse: "Residential",valuation: 320_000, annualRates: 1_840, balance: 460, lastPaymentDate: "2025-11-15", lastPaymentAmount: 460, paymentMethod: "BPAY",        pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-NSW-002"], notes: ["Q1 2026 overdue 18 days."], lat: -31.9590, lng: 141.4612 },
  { assessmentNumber: "BRK-5512-44", council: "BRK", address: "Lot 4 Silver City Highway", suburb: "Broken Hill", postcode: "2880", state: "NSW", landUse: "Rural", valuation: 250_000, annualRates: 1_240, balance: 0, lastPaymentDate: "2026-03-25", lastPaymentAmount: 310, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-NSW-003"], notes: ["Rural; live tenement coverage."], lat: -31.9722, lng: 141.5102 },

  // ---- MTI — Mount Isa ----
  { assessmentNumber: "MTI-6601-08", council: "MTI", address: "Lot 8 Diamantina Drive",      suburb: "Mount Isa", postcode: "4825", state: "QLD", landUse: "Rural",      valuation: 290_000, annualRates: 1_220, balance: 0, lastPaymentDate: "2026-04-01", lastPaymentAmount: 305, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-QLD-001"], notes: ["Rural; copper-zinc tenement."], lat: -20.7256, lng: 139.4927 },
  { assessmentNumber: "MTI-6601-33", council: "MTI", address: "33 Camooweal Street",         suburb: "Mount Isa", postcode: "4825", state: "QLD", landUse: "Commercial", valuation: 1_080_000, annualRates: 8_200, balance: 2_050, lastPaymentDate: "2025-10-01", lastPaymentAmount: 2_050, paymentMethod: "BPAY", pensionerRebate: false, paymentArrangement: false, ownerIds: ["O-QLD-002"], notes: ["Q1 2026 instalment overdue 36 days."], lat: -20.7301, lng: 139.4894 },
];

// Generic-population properties (no tenement coverage, used to fill out demos)
const GENERIC_BASE: Array<Pick<Property, "council" | "suburb" | "postcode" | "state" | "lat" | "lng">> = [
  { council: "TPS", suburb: "Tom Price",   postcode: "6751", state: "WA",  lat: -22.690, lng: 117.792 },
  { council: "ESH", suburb: "Newman",      postcode: "6753", state: "WA",  lat: -23.357, lng: 119.737 },
  { council: "ESH", suburb: "Karratha",    postcode: "6714", state: "WA",  lat: -20.738, lng: 116.846 },
  { council: "KAL", suburb: "Kalgoorlie",  postcode: "6430", state: "WA",  lat: -30.749, lng: 121.469 },
  { council: "KAL", suburb: "Boulder",     postcode: "6432", state: "WA",  lat: -30.789, lng: 121.498 },
  { council: "MEK", suburb: "Meekatharra", postcode: "6642", state: "WA",  lat: -26.589, lng: 118.495 },
  { council: "ASH", suburb: "Onslow",      postcode: "6710", state: "WA",  lat: -21.642, lng: 115.107 },
  { council: "BRK", suburb: "Broken Hill", postcode: "2880", state: "NSW", lat: -31.959, lng: 141.467 },
  { council: "MTI", suburb: "Mount Isa",   postcode: "4825", state: "QLD", lat: -20.725, lng: 139.493 },
];

const STREET_NAMES = [
  "Acacia", "Banksia", "Coolibah", "Desert Pea", "Eucalyptus", "Frangipani",
  "Gumnut", "Hibiscus", "Iron Knob", "Jacaranda", "Kookaburra", "Lemongrass",
  "Mulga", "Nullarbor", "Outback", "Paperbark", "Quandong", "Redgum",
  "Saltbush", "Tea Tree", "Underwood", "Verticordia", "Wattle", "Xantorrhoea",
  "Yarra", "Zircon",
];

const STREET_TYPES = ["Street", "Road", "Avenue", "Drive", "Lane", "Crescent", "Place"];

// Generate ~90 generic properties for population realism
function generateGeneric(): Omit<Property, "parcel">[] {
  const out: Omit<Property, "parcel">[] = [];
  let counter = 5_000;
  for (const base of GENERIC_BASE) {
    const n = 10; // 10 per locale ⇒ 9 × 10 = 90 generic
    for (let i = 0; i < n; i++) {
      counter++;
      const idx = (counter * 7) % STREET_NAMES.length;
      const stIdx = (counter * 3) % STREET_TYPES.length;
      const ownerIdx = (counter % 9) + 30;
      const houseNo = 4 + ((counter * 11) % 200);
      const overdue = counter % 11 === 0;
      const arr = counter % 23 === 0;
      const pens = counter % 17 === 0;
      const valuation = 220_000 + ((counter * 1_337) % 480_000);
      const rates = Math.round(valuation * 0.005);
      const balance = overdue ? Math.round(rates * (0.25 + ((counter % 4) * 0.25))) : 0;
      const lat = base.lat + (((counter % 17) - 8) * 0.0009);
      const lng = base.lng + (((counter % 19) - 9) * 0.0011);
      const useCycle = counter % 7;
      const landUse: Property["landUse"] =
        useCycle < 4 ? "Residential" : useCycle === 4 ? "Vacant" : useCycle === 5 ? "Commercial" : "Rural";
      out.push({
        assessmentNumber: `${base.council}-${5000 + counter}`,
        council: base.council,
        address: `${houseNo} ${STREET_NAMES[idx]} ${STREET_TYPES[stIdx]}`,
        suburb: base.suburb,
        postcode: base.postcode,
        state: base.state,
        landUse,
        valuation,
        annualRates: rates,
        balance,
        lastPaymentDate: overdue ? "2025-12-01" : "2026-04-01",
        lastPaymentAmount: Math.round(rates / 4),
        paymentMethod: counter % 3 === 0 ? "Direct Debit" : counter % 3 === 1 ? "BPAY" : "Counter",
        pensionerRebate: pens,
        paymentArrangement: arr && overdue,
        ownerIds: [`O-GEN-${ownerIdx.toString().padStart(3, "0")}`],
        notes: arr ? ["Active payment arrangement."] : [],
        lat,
        lng,
      });
    }
  }
  return out;
}

const ALL_PROPS = [...CURATED, ...generateGeneric()];

export const PROPERTIES: Property[] = ALL_PROPS.map((p) => ({
  ...p,
  parcel: parcel(p.lat, p.lng),
}));

// ===== Owners =====

const CURATED_OWNERS: Owner[] = [
  { ownerId: "O-WA-001", name: "Pilbara Iron Holdings Pty Ltd",   abn: "32 614 882 110", postalAddress: "Level 12, 100 St Georges Terrace, Perth WA 6000", email: "rates@pilbara-iron.example",       phone: "08 9200 7700", ownerSince: "2014-08-19", previousOwners: [] },
  { ownerId: "O-WA-002", name: "Karratha Exploration Pty Ltd",    abn: "44 990 221 005", abnStatus: "Cancelled", postalAddress: "PO Box 5511, Karratha WA 6714",                       email: "admin@karratha-exploration.example",phone: "08 9144 2200", ownerSince: "2022-11-14", previousOwners: [] },
  { ownerId: "O-WA-003", name: "Goldfields Resources Ltd",        abn: "18 552 117 884", postalAddress: "Level 5, 50 Kings Park Road, West Perth WA 6005",   email: "rates@goldfields-resources.example",phone: "08 9226 1100", ownerSince: "2009-06-22", previousOwners: [] },
  { ownerId: "O-WA-004", name: "Sandstone Prospecting Pty Ltd",   abn: "82 144 029 561", postalAddress: "PO Box 88, Sandstone WA 6639",                      email: "info@sandstone-prospecting.example",phone: "0428 990 117", ownerSince: "2023-04-01", previousOwners: [] },
  { ownerId: "O-WA-005", name: "Newman Solar Pty Ltd",            abn: "55 220 901 477", postalAddress: "Level 3, 240 St Georges Terrace, Perth WA 6000",   email: "info@newman-solar.example",          phone: "08 9483 2200", ownerSince: "2024-01-15", previousOwners: [] },
  { ownerId: "O-WA-010", name: "John & Sarah Wilkins",            abn: null,             postalAddress: "12 Stadium Road, Tom Price WA 6751",                email: "j.wilkins@example.com",              phone: "0408 121 884", ownerSince: "2018-09-04", previousOwners: [] },
  { ownerId: "O-WA-011", name: "Margaret Thompson",               abn: null,             postalAddress: "44 Yampire Road, Tom Price WA 6751",                email: null,                                  phone: "0419 552 081", ownerSince: "1998-03-22", previousOwners: [] },
  { ownerId: "O-WA-012", name: "Newman Trading Co Pty Ltd",       abn: "29 008 442 119", postalAddress: "PO Box 401, Newman WA 6753",                       email: "accounts@newman-trading.example",   phone: "08 9175 4400", ownerSince: "2010-07-12", previousOwners: [] },
  { ownerId: "O-WA-020", name: "Estate of L. Marshall",           abn: null,             postalAddress: "C/- Henderson Lawyers, PO Box 22, Perth WA 6000",  email: null,                                  phone: null,           ownerSince: "2024-08-01", previousOwners: [{ name: "Lillian Marshall", period: "1972-2024" }] },
  { ownerId: "O-WA-021", name: "Goldfields Pastoral Pty Ltd",     abn: "61 005 998 220", postalAddress: "PO Box 442, Kalgoorlie WA 6430",                   email: "office@gf-pastoral.example",          phone: "08 9021 7700", ownerSince: "2003-09-12", previousOwners: [] },
  { ownerId: "O-WA-022", name: "Boulder Block Investments Pty Ltd",abn: "75 144 882 011",postalAddress: "PO Box 88, Boulder WA 6432",                       email: "ar@bbi.example",                     phone: "08 9093 8800", ownerSince: "2017-04-14", previousOwners: [] },
  { ownerId: "O-WA-023", name: "Hannan Holdings Pty Ltd",         abn: "98 220 991 003", postalAddress: "Hannan Street 211, Kalgoorlie WA 6430",            email: "office@hannan.example",              phone: "08 9021 1100", ownerSince: "1999-02-03", previousOwners: [] },
  { ownerId: "O-WA-024", name: "Murchison Holdings Pty Ltd",      abn: "12 003 882 770", postalAddress: "PO Box 11, Meekatharra WA 6642",                   email: "admin@murchison-h.example",          phone: "08 9981 1100", ownerSince: "2011-05-14", previousOwners: [] },
  { ownerId: "O-WA-025", name: "Pilbara Minerals Processing Ltd", abn: "44 882 011 559", postalAddress: "Level 8, 240 St Georges Terrace, Perth WA 6000",   email: "ar@pmp.example",                     phone: "08 9483 7700", ownerSince: "2016-11-20", previousOwners: [] },
  { ownerId: "O-NSW-001", name: "Argent Property Group Pty Ltd",  abn: "55 122 880 044", postalAddress: "12 Argent Street, Broken Hill NSW 2880",            email: "office@argent.example",              phone: "08 8087 4400", ownerSince: "2010-03-15", previousOwners: [] },
  { ownerId: "O-NSW-002", name: "Daniel & Emily Foster",          abn: null,             postalAddress: "47 Iodide Street, Broken Hill NSW 2880",            email: "fosters@example.com",                phone: "0418 221 887", ownerSince: "2019-08-22", previousOwners: [] },
  { ownerId: "O-NSW-003", name: "Silver City Pastoral Co",        abn: "08 880 442 119", postalAddress: "PO Box 1102, Broken Hill NSW 2880",                 email: "office@scpc.example",                phone: "08 8087 9911", ownerSince: "1992-12-01", previousOwners: [] },
  { ownerId: "O-QLD-001", name: "Diamantina Pastoral Pty Ltd",    abn: "29 442 008 117", postalAddress: "PO Box 880, Mount Isa QLD 4825",                    email: "office@diamantina-p.example",        phone: "07 4743 2200", ownerSince: "2014-06-10", previousOwners: [] },
  { ownerId: "O-QLD-002", name: "Camooweal Holdings Pty Ltd",     abn: "13 552 008 116", postalAddress: "33 Camooweal Street, Mount Isa QLD 4825",           email: "ar@camooweal-h.example",             phone: "07 4743 4400", ownerSince: "2008-04-22", previousOwners: [] },
];

// Generate generic owners
const GENERIC_OWNERS: Owner[] = Array.from({ length: 60 }, (_, i) => {
  const idx = i + 30;
  const id = `O-GEN-${idx.toString().padStart(3, "0")}`;
  const firstNames = ["John","Mary","David","Sarah","Michael","Lisa","James","Anna","Robert","Emma","Andrew","Rachel","Brian","Karen"];
  const lastNames  = ["Smith","Jones","Brown","Williams","Taylor","Davis","Wilson","Anderson","Thompson","White","Harris","Martin","Walker"];
  const fn = firstNames[i % firstNames.length];
  const ln = lastNames[(i * 3) % lastNames.length];
  return {
    ownerId: id,
    name: `${fn} ${ln}`,
    abn: null,
    postalAddress: `PO Box ${100 + i * 7}, Perth WA 6000`,
    email: `${fn}.${ln}@example.com`.toLowerCase(),
    phone: `04${String(10000000 + i * 1331).slice(0, 8)}`,
    ownerSince: `${2000 + (i % 22)}-${String((i % 12) + 1).padStart(2, "0")}-15`,
    previousOwners: [],
  };
});

export const OWNERS: Owner[] = [...CURATED_OWNERS, ...GENERIC_OWNERS];

// ===== Tenements (DMIRS) =====

const TENEMENT_SEED = [
  // Tom Price (Pilbara iron)
  { id: "M70/1284", type: "M" as const, holder: "Pilbara Iron Holdings Pty Ltd",  abn: "32 614 882 110", commodity: ["Iron Ore"],          area: 4_820, prod: true,  intersects: ["TPS-1102-44"], lat: -22.6940, lng: 117.7935, expiry: "2035-08-18", granted: "2014-08-19", lastWP: 2025 },
  { id: "M70/1411", type: "M" as const, holder: "Pilbara Iron Holdings Pty Ltd",  abn: "32 614 882 110", commodity: ["Iron Ore","Manganese"], area: 2_260, prod: true, intersects: ["TPS-1102-47"], lat: -22.6982, lng: 117.7892, expiry: "2038-03-03", granted: "2017-03-04", lastWP: 2025 },
  { id: "L70/0177", type: "L" as const, holder: "Pilbara Iron Holdings Pty Ltd",  abn: "32 614 882 110", commodity: ["Infrastructure"],    area: 320,   prod: false, intersects: ["TPS-1102-91"], lat: -22.7102, lng: 117.8011, expiry: "2037-01-29", granted: "2016-01-30", lastWP: null },
  { id: "M70/1502", type: "M" as const, holder: "Pilbara Iron Holdings Pty Ltd",  abn: "32 614 882 110", commodity: ["Iron Ore"],          area: 3_140, prod: true,  intersects: ["ESH-1102-92","ASH-9911-22"], lat: -22.6981, lng: 115.6444, expiry: "2040-04-12", granted: "2019-04-13", lastWP: 2025 },
  // Karratha exploration
  { id: "E45/5821", type: "E" as const, holder: "Karratha Exploration Pty Ltd",   abn: "44 990 221 005", commodity: ["Lithium","Rare Earths"], area: 18_400, prod: false, intersects: ["ESH-1102-71"], lat: -20.7364, lng: 116.8463, expiry: "2027-11-13", granted: "2022-11-14", lastWP: 2024 },
  { id: "E45/6011", type: "E" as const, holder: "Karratha Exploration Pty Ltd",   abn: "44 990 221 005", commodity: ["Lithium"],            area: 9_200, prod: false, intersects: [], lat: -20.7501, lng: 116.8800, expiry: "2028-07-19", granted: "2023-07-20", lastWP: 2025 },
  // Newman solar
  { id: "G69/0044", type: "G" as const, holder: "Newman Solar Pty Ltd",           abn: "55 220 901 477", commodity: ["Solar Infrastructure"], area: 180,  prod: true,  intersects: ["ESH-1102-88"], lat: -23.3614, lng: 119.7349, expiry: "2049-01-14", granted: "2024-01-15", lastWP: 2025 },
  // Sandstone gold
  { id: "M52/0908", type: "M" as const, holder: "Goldfields Resources Ltd",       abn: "18 552 117 884", commodity: ["Gold"],               area: 740,   prod: true,  intersects: ["SST-2204-19"], lat: -27.9881, lng: 119.2944, expiry: "2030-06-21", granted: "2009-06-22", lastWP: 2025 },
  { id: "P52/1701", type: "P" as const, holder: "Sandstone Prospecting Pty Ltd",  abn: "82 144 029 561", commodity: ["Gold"],               area: 90,    prod: false, intersects: ["SST-2204-31"], lat: -28.0042, lng: 119.3122, expiry: "2027-03-31", granted: "2023-04-01", lastWP: null },
  { id: "M52/1112", type: "M" as const, holder: "Goldfields Resources Ltd",       abn: "18 552 117 884", commodity: ["Gold"],               area: 1_280, prod: true,  intersects: ["SST-2204-58"], lat: -27.9760, lng: 119.2812, expiry: "2031-09-04", granted: "2010-09-05", lastWP: 2024 },
  // Kalgoorlie gold
  { id: "M26/0444", type: "M" as const, holder: "Goldfields Pastoral Pty Ltd",    abn: "61 005 998 220", commodity: ["Gold"],               area: 2_140, prod: true,  intersects: ["KAL-4401-12"], lat: -30.7321, lng: 121.4855, expiry: "2033-11-08", granted: "2012-11-09", lastWP: 2025 },
  { id: "M26/0511", type: "M" as const, holder: "Goldfields Pastoral Pty Ltd",    abn: "61 005 998 220", commodity: ["Gold","Silver"],      area: 880,   prod: true,  intersects: ["KAL-4401-45"], lat: -30.7892, lng: 121.4990, expiry: "2034-05-22", granted: "2013-05-23", lastWP: 2025 },
  { id: "G26/0119", type: "G" as const, holder: "Boulder Block Investments Pty Ltd", abn: "75 144 882 011", commodity: ["Solar Infrastructure"], area: 240, prod: true, intersects: ["KAL-4401-77"], lat: -30.7522, lng: 121.4555, expiry: "2048-09-30", granted: "2023-10-01", lastWP: 2025 },
  // Meekatharra
  { id: "P51/0822", type: "P" as const, holder: "Murchison Holdings Pty Ltd",     abn: "12 003 882 770", commodity: ["Gold"],               area: 75,    prod: false, intersects: ["MEK-3303-21"], lat: -26.5897, lng: 118.4956, expiry: "2027-08-15", granted: "2023-08-16", lastWP: null },
  { id: "M51/0144", type: "M" as const, holder: "Murchison Holdings Pty Ltd",     abn: "12 003 882 770", commodity: ["Gold"],               area: 410,   prod: true,  intersects: ["MEK-3303-58"], lat: -26.5710, lng: 118.5102, expiry: "2032-11-22", granted: "2011-11-23", lastWP: 2025 },
  // Onslow processing
  { id: "M08/0211", type: "M" as const, holder: "Pilbara Minerals Processing Ltd",abn: "44 882 011 559", commodity: ["Mineral Sands"],     area: 1_640, prod: true,  intersects: ["ASH-9911-04"], lat: -22.6981, lng: 115.6444, expiry: "2036-03-14", granted: "2015-03-15", lastWP: 2025 },
  // Broken Hill (NSW lead/zinc/silver)
  { id: "ML 1234 (NSW)", type: "M" as const, holder: "Silver City Pastoral Co", abn: "08 880 442 119", commodity: ["Lead","Zinc","Silver"], area: 1_220, prod: true, intersects: ["BRK-5512-44"], lat: -31.9722, lng: 141.5102, expiry: "2034-04-22", granted: "2013-04-23", lastWP: 2025 },
  // Mount Isa (QLD copper-zinc)
  { id: "ML 9214 (QLD)", type: "M" as const, holder: "Diamantina Pastoral Pty Ltd", abn: "29 442 008 117", commodity: ["Copper","Zinc"], area: 1_910, prod: true, intersects: ["MTI-6601-08"], lat: -20.7256, lng: 139.4927, expiry: "2035-07-30", granted: "2014-07-31", lastWP: 2025 },
  // Floating tenements (no overlap with rated land — context demo)
  { id: "E70/6101", type: "E" as const, holder: "Karratha Exploration Pty Ltd", abn: "44 990 221 005", commodity: ["Rare Earths"], area: 12_400, prod: false, intersects: [], lat: -22.5800, lng: 117.6200, expiry: "2028-02-14", granted: "2023-02-15", lastWP: 2024 },
  { id: "E26/4400", type: "E" as const, holder: "Goldfields Pastoral Pty Ltd",  abn: "61 005 998 220", commodity: ["Lithium"], area: 14_220, prod: false, intersects: [], lat: -30.6900, lng: 121.5300, expiry: "2027-05-04", granted: "2022-05-05", lastWP: 2024 },
];

export const TENEMENTS: Tenement[] = TENEMENT_SEED.map((t) => ({
  tenementId: t.id,
  type: t.type,
  status: "Live" as const,
  holder: t.holder,
  holderAbn: t.abn,
  commodity: t.commodity,
  grantedDate: t.granted,
  expiryDate: t.expiry,
  areaHectares: t.area,
  intersectsAssessmentNumbers: t.intersects,
  isProducing: t.prod,
  lastWorkProgramYear: t.lastWP,
  polygon: tenementPolygon(t.lat, t.lng, t.area),
}));

// ===== Transactions (selected properties) =====

export const TRANSACTIONS: Record<string, Transaction[]> = {
  "TPS-3041-12": [
    { date: "2025-07-01", type: "Rates Levy",       amount: 2140,    reference: "LVY-2025-26", balance: 2140 },
    { date: "2025-08-12", type: "Payment",          amount: -535,    reference: "BPAY-882104", balance: 1605 },
    { date: "2025-11-04", type: "Payment",          amount: -535,    reference: "BPAY-901188", balance: 1070 },
    { date: "2026-02-04", type: "Payment",          amount: -535,    reference: "BPAY-918002", balance: 535 },
    { date: "2026-04-30", type: "Penalty Interest", amount: 12.5,    reference: "INT-Q4",      balance: 547.5 },
  ],
  "ESH-7011-08": [
    { date: "2025-07-01", type: "Rates Levy",  amount: 12400,  reference: "LVY-2025-26", balance: 12400 },
    { date: "2025-09-01", type: "Adjustment",  amount: -100,   reference: "ARR-START",   balance: 12300 },
    { date: "2025-10-15", type: "Payment",     amount: -3100,  reference: "BPAY-893221", balance: 9200 },
    { date: "2026-01-10", type: "Payment",     amount: -3050,  reference: "BPAY-910445", balance: 6150 },
    { date: "2026-04-10", type: "Payment",     amount: -3050,  reference: "BPAY-925910", balance: 3100 },
  ],
  "TPS-1102-44": [
    { date: "2025-07-01", type: "Rates Levy", amount: 1820, reference: "LVY-2025-26", balance: 1820 },
    { date: "2025-09-01", type: "Payment",    amount: -455, reference: "BPAY-885012", balance: 1365 },
    { date: "2025-12-01", type: "Payment",    amount: -455, reference: "BPAY-905880", balance: 910 },
    { date: "2026-02-28", type: "Payment",    amount: -455, reference: "BPAY-919221", balance: 455 },
    { date: "2026-04-01", type: "Payment",    amount: -455, reference: "BPAY-925112", balance: 0 },
  ],
  "ASH-9911-04": [
    { date: "2025-07-01", type: "Rates Levy", amount: 38200, reference: "LVY-2025-26", balance: 38200 },
    { date: "2025-09-15", type: "Payment",    amount: -9550, reference: "EFT-COMM-118",balance: 28650 },
    { date: "2025-12-15", type: "Payment",    amount: -9550, reference: "EFT-COMM-227",balance: 19100 },
    { date: "2026-03-15", type: "Payment",    amount: -9550, reference: "EFT-COMM-309",balance: 9550 },
  ],
  "MTI-6601-33": [
    { date: "2025-07-01", type: "Rates Levy",       amount: 8200,  reference: "LVY-2025-26", balance: 8200 },
    { date: "2025-09-01", type: "Payment",          amount: -2050, reference: "BPAY-771101", balance: 6150 },
    { date: "2025-11-15", type: "Payment",          amount: -2050, reference: "BPAY-790222", balance: 4100 },
    { date: "2026-02-15", type: "Payment",          amount: -2050, reference: "BPAY-810115", balance: 2050 },
    { date: "2026-04-15", type: "Penalty Interest", amount: 41,    reference: "INT-Q4",      balance: 2091 },
  ],
};

// ===== Integrations / connections =====

export const INTEGRATIONS: Integration[] = [
  { id: "techone-tps",    name: "TechnologyOne CiAnywhere — TPS", category: "Rating system",      description: "Property & Rating module. Live read; scoped writes via approval.", status: "live",         lastSync: "5 min ago",  authType: "OAuth 2.0", scope: "GET property, GET owner, GET transactions, PATCH owner contact", endpoint: "https://tps.cia.technologyone.com/api/v2", vendor: "TechnologyOne" },
  { id: "techone-esh",    name: "TechnologyOne CiAnywhere — ESH", category: "Rating system",      description: "Property & Rating module.",                                          status: "live",         lastSync: "8 min ago",  authType: "OAuth 2.0", scope: "GET property, GET owner, GET transactions",                          endpoint: "https://esh.cia.technologyone.com/api/v2", vendor: "TechnologyOne" },
  { id: "techone-kal",    name: "TechnologyOne CiAnywhere — KAL", category: "Rating system",      description: "Read-only mode pending council write authorisation.",                status: "degraded",     lastSync: "11 min ago", authType: "OAuth 2.0", scope: "GET property, GET owner",                                            endpoint: "https://kal.cia.technologyone.com/api/v2", vendor: "TechnologyOne" },
  { id: "civica-brk",     name: "Civica Authority — BRK",        category: "Rating system",      description: "NSW councils via Civica Authority REST API.",                          status: "live",         lastSync: "12 min ago", authType: "API key",   scope: "GET property, GET owner, GET transactions",                          endpoint: "https://brk.civica.com.au/authority/api",  vendor: "Civica" },
  { id: "dmirs-wfs",      name: "DMIRS MINEDEX / GeoVIEW.WA",    category: "Mining & cadastral", description: "WA Mining tenement register. Public WFS feed; daily ingest.",          status: "live",         lastSync: "2 hours ago",authType: "Public",    scope: "GetCapabilities, GetFeature (Mining_Tenements_DMIRS_001)",          endpoint: "https://services.slip.wa.gov.au/.../WFSServer", vendor: "DMIRS" },
  { id: "landgate-slip",  name: "Landgate SLIP",                 category: "Mining & cadastral", description: "WA cadastral parcels and addresses.",                                  status: "live",         lastSync: "1 day ago",  authType: "Public",    scope: "WFS — Cadastre_DCDB",                                                endpoint: "https://services.slip.wa.gov.au/.../Cadastre", vendor: "Landgate" },
  { id: "minview-nsw",    name: "MinView (NSW)",                 category: "Mining & cadastral", description: "NSW mining titles register.",                                          status: "unconfigured", authType: "Public", scope: "—",                                                                                  vendor: "Geoscience NSW" },
  { id: "geoview-qld",    name: "Geological Survey QLD",         category: "Mining & cadastral", description: "QLD mining tenement register.",                                        status: "unconfigured", authType: "Public", scope: "—",                                                                                  vendor: "Geoscience QLD" },
  { id: "nearmap",        name: "Nearmap AI",                    category: "Imagery",            description: "Aerial imagery + AI change detection (vacant→built, solar, mining).", status: "live",         lastSync: "Refreshed 18 Apr",authType: "API key", scope: "Image tiles, AI change feed",                                       endpoint: "https://api.nearmap.com",                  vendor: "Nearmap" },
  { id: "metromap",       name: "Metromap",                      category: "Imagery",            description: "Alternate aerial imagery provider.",                                   status: "unconfigured", authType: "API key", scope: "—",                                                                                  vendor: "Metromap" },
  { id: "geoscape",       name: "Geoscape Buildings + Surfaces", category: "Imagery",            description: "Derived buildings dataset (national).",                                status: "live",         lastSync: "1 week ago", authType: "API key",   scope: "Buildings, Surfaces",                                                endpoint: "https://api.geoscape.com.au",              vendor: "Geoscape Australia" },
  { id: "abn-lookup",     name: "ATO ABN Lookup",                category: "Identity",           description: "Australian Business Number register.",                                 status: "live",         lastSync: "3 min ago",  authType: "API key",   scope: "AbnDetails, NameSearch",                                             endpoint: "https://abr.business.gov.au/json",         vendor: "ATO" },
  { id: "asic-connect",   name: "ASIC Connect",                  category: "Identity",           description: "Company directors and registration details.",                          status: "live",         lastSync: "1 hour ago", authType: "API key",   scope: "Company search, director search",                                    endpoint: "https://asic.gov.au/api",                  vendor: "ASIC" },
  { id: "entra-sso",      name: "Microsoft Entra ID SSO",        category: "Identity",           description: "Council staff single sign-on. SCIM provisioning.",                     status: "live",         lastSync: "Live",       authType: "SSO",       scope: "OIDC + SCIM",                                                        endpoint: "https://login.microsoftonline.com/{tenant}", vendor: "Microsoft" },
  { id: "twilio",         name: "Twilio",                        category: "Communications",     description: "SMS + voice provider. Used for ratepayer reminders and confirmations.",status: "live",         lastSync: "20 min ago", authType: "API key",   scope: "Messages, Calls",                                                    endpoint: "https://api.twilio.com",                   vendor: "Twilio" },
  { id: "messagemedia",   name: "MessageMedia",                  category: "Communications",     description: "AU-based SMS provider (alternative).",                                 status: "unconfigured", authType: "API key", scope: "—",                                                                                  vendor: "MessageMedia" },
  { id: "sendgrid",       name: "SendGrid",                      category: "Communications",     description: "Transactional email.",                                                 status: "live",         lastSync: "Live",       authType: "API key",   scope: "Mail send, suppression",                                             endpoint: "https://api.sendgrid.com",                 vendor: "Twilio" },
  { id: "council-exchange",name: "Council Exchange / M365",      category: "Communications",     description: "Outbound mail via council Microsoft 365 tenant (per-council).",        status: "degraded",     lastSync: "1 day ago",  authType: "OAuth 2.0", scope: "Mail.Send (delegated)",                                              endpoint: "https://graph.microsoft.com",              vendor: "Microsoft" },
  { id: "bpay",           name: "BPAY (view)",                   category: "Payments",           description: "BPAY biller code + reference resolution. View-only.",                  status: "live",         lastSync: "Daily",      authType: "API key",   scope: "Reference resolution",                                               endpoint: "https://bpay.com.au/api",                  vendor: "BPAY" },
  { id: "stripe",         name: "Stripe",                        category: "Payments",           description: "RatesChat citizen payments (certificates, rebate fees).",              status: "live",         lastSync: "Live",       authType: "API key",   scope: "Payment intents, customers",                                         endpoint: "https://api.stripe.com",                   vendor: "Stripe" },
  { id: "edrms-cm",       name: "Council EDRMS — Content Manager",category: "Documents",         description: "Records management write-back.",                                       status: "unconfigured", authType: "API key", scope: "—",                                                                                  vendor: "Micro Focus" },
  { id: "docusign",       name: "DocuSign",                      category: "Documents",          description: "E-signature for arrangements + rebate forms.",                         status: "live",         lastSync: "1 hour ago", authType: "OAuth 2.0", scope: "Envelopes, Templates",                                               endpoint: "https://demo.docusign.net/restapi",        vendor: "DocuSign" },
  { id: "datadog",        name: "Datadog",                       category: "Observability",      description: "Metrics, logs, traces (AU region).",                                   status: "live",         lastSync: "Live",       authType: "API key",   scope: "Metrics + logs",                                                     endpoint: "https://api.ap1.datadoghq.com",            vendor: "Datadog" },
  { id: "sentry",         name: "Sentry",                        category: "Observability",      description: "Application error tracking.",                                          status: "live",         lastSync: "Live",       authType: "API key",   scope: "Error events",                                                       endpoint: "https://sentry.io",                        vendor: "Sentry" },
];

// ===== Activity log =====

export const ACTIVITY: ActivityEvent[] = [
  { id: "A-1024", ts: "2026-05-08 09:42", user: "Brodie",  council: "TPS", action: "find_mining_mismatches",  detail: "Returned 6 candidates · $37k uplift", category: "recovery" },
  { id: "A-1023", ts: "2026-05-08 09:38", user: "Brodie",  council: "TPS", action: "generate_evidence_pack",  target: "TPS-1102-47", detail: "Pack EP-TPS-1102-47-20260508 generated", category: "recovery" },
  { id: "A-1022", ts: "2026-05-08 09:35", user: "Brodie",  council: "TPS", action: "search_property",         detail: "Search: 'Boundary Road'", category: "lookup" },
  { id: "A-1021", ts: "2026-05-08 09:21", user: "S. Patel", council: "ESH", action: "list_overdue",            detail: "Returned 8 overdue · total $14,200", category: "lookup" },
  { id: "A-1020", ts: "2026-05-08 09:15", user: "S. Patel", council: "ESH", action: "draft_chase_all_overdue", detail: "Drafted 6 friendly reminders (preview only)", category: "comms" },
  { id: "A-1019", ts: "2026-05-08 08:50", user: "system",  council: "—",   action: "DMIRS sync",              detail: "21 tenements refreshed across 3 LGAs", category: "system" },
  { id: "A-1018", ts: "2026-05-08 08:45", user: "Brodie",  council: "KAL", action: "verify_abn",              target: "61 005 998 220", detail: "Active · Goldfields Pastoral Pty Ltd", category: "lookup" },
  { id: "A-1017", ts: "2026-05-08 08:32", user: "Brodie",  council: "KAL", action: "fetch_dmirs_tenements",   detail: "21 tenements (live)", category: "system" },
  { id: "A-1016", ts: "2026-05-08 08:15", user: "system",  council: "—",   action: "Nightly DMIRS refresh",   detail: "All states · 0 errors", category: "system" },
  { id: "A-1015", ts: "2026-05-08 08:01", user: "Brodie",  council: "—",   action: "auth.signin",             detail: "Microsoft Entra SSO", category: "auth" },
  { id: "A-1014", ts: "2026-05-07 17:22", user: "R. Davies", council: "ESH", action: "draft_payment_reminder",  target: "ESH-7011-08", detail: "Firm tone draft", category: "comms" },
  { id: "A-1013", ts: "2026-05-07 16:48", user: "Brodie",  council: "TPS", action: "generate_evidence_pack",  target: "TPS-1102-44", detail: "Pack EP-TPS-1102-44-20260507 generated", category: "recovery" },
  { id: "A-1012", ts: "2026-05-07 16:30", user: "Brodie",  council: "—",   action: "recovery_summary",        detail: "Cross-council audit · $149k recovery opp.", category: "recovery" },
];

// ===== Bank deposits (reconciliation) =====

export const BANK_DEPOSITS: BankDeposit[] = [
  { id: "BD-1001", date: "2026-05-07", amount: 535,   reference: "BPAY 882104 J WILKINS",         source: "CommBank EFTPOS", matchAssessment: "TPS-3041-12", matchConfidence: 0.99, status: "matched" },
  { id: "BD-1002", date: "2026-05-07", amount: 9550,  reference: "EFT-COMM-309 PILBARA MIN PROC", source: "CommBank Direct",  matchAssessment: "ASH-9911-04", matchConfidence: 0.97, status: "matched" },
  { id: "BD-1003", date: "2026-05-07", amount: 460,   reference: "BPAY 911887 D FOSTER",          source: "Westpac",          matchAssessment: "BRK-5512-19", matchConfidence: 0.92, status: "suggested" },
  { id: "BD-1004", date: "2026-05-07", amount: 2050,  reference: "BPAY 800221 CAMOOWEAL HLD",     source: "ANZ",              matchAssessment: "MTI-6601-33", matchConfidence: 0.88, status: "suggested" },
  { id: "BD-1005", date: "2026-05-07", amount: 305,   reference: "BPAY 770901 J SMITH",           source: "CommBank",         matchAssessment: undefined,     matchConfidence: undefined, status: "unmatched" },
  { id: "BD-1006", date: "2026-05-07", amount: 1240,  reference: "EFT GOLDFIELDS PASTORAL",       source: "ANZ",              matchAssessment: "KAL-4401-12", matchConfidence: 0.95, status: "matched" },
  { id: "BD-1007", date: "2026-05-07", amount: 720,   reference: "BPAY 882104 ANON",              source: "Westpac",          matchAssessment: undefined,     matchConfidence: undefined, status: "unmatched" },
];

// ===== Query helpers =====

export function getCouncil(code: string): Council | undefined {
  return COUNCILS.find((c) => c.code === code);
}

export function listProperties(councilCode?: string): Property[] {
  return councilCode
    ? PROPERTIES.filter((p) => p.council === councilCode)
    : PROPERTIES;
}

export function getProperty(assessmentNumber: string): Property | undefined {
  return PROPERTIES.find((p) => p.assessmentNumber === assessmentNumber);
}

export function searchProperties(query: string): Property[] {
  const q = query.toLowerCase();
  return PROPERTIES.filter(
    (p) =>
      p.address.toLowerCase().includes(q) ||
      p.suburb.toLowerCase().includes(q) ||
      p.assessmentNumber.toLowerCase().includes(q),
  );
}

export function searchByOwner(name: string, suburb?: string): Property[] {
  const q = name.toLowerCase();
  const matchedOwners = OWNERS.filter((o) => o.name.toLowerCase().includes(q));
  const ownerIds = new Set(matchedOwners.map((o) => o.ownerId));
  return PROPERTIES.filter((p) => {
    const ownerMatch = p.ownerIds.some((id) => ownerIds.has(id));
    const suburbMatch = suburb
      ? p.suburb.toLowerCase() === suburb.toLowerCase()
      : true;
    return ownerMatch && suburbMatch;
  });
}

export function getOwner(ownerId: string): Owner | undefined {
  return OWNERS.find((o) => o.ownerId === ownerId);
}

export function getOwnersForProperty(p: Property): Owner[] {
  return OWNERS.filter((o) => p.ownerIds.includes(o.ownerId));
}

export function getOverdueProperties(): Property[] {
  return PROPERTIES.filter((p) => p.balance > 0);
}

export function getTransactions(assessmentNumber: string): Transaction[] {
  return TRANSACTIONS[assessmentNumber] ?? [];
}

export function getTenementsForAssessment(
  assessmentNumber: string,
): Tenement[] {
  return TENEMENTS.filter((t) =>
    t.intersectsAssessmentNumbers.includes(assessmentNumber),
  );
}

export function getAllLiveTenements(): Tenement[] {
  return TENEMENTS.filter((t) => t.status === "Live");
}
