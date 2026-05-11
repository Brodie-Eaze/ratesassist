/**
 * Mock Landgate restricted-tier fixtures.
 *
 * 10 plausible parcels across the WA councils RatesAssist demos against:
 * Tom Price, East Pilbara (Newman), Kalgoorlie, Meekatharra, Ashburton
 * (Onslow / Pannawonica), and one Sandstone parcel. Used by the
 * `createMockLandgateClient` factory below and by the address-discrepancy
 * mock in `apps/web/lib/clients.ts`.
 *
 * The fixture is intentionally NOT exhaustive — it carries exactly the
 * parcels the address-mismatch demo entries reference, plus a handful of
 * matching-clean records so tests can verify the no-discrepancy path.
 */

import type {
  LandgateParcelDetail,
  LandgateRestrictedClient,
} from "../landgateRestricted.js";

export const LANDGATE_MOCK_PARCELS: readonly LandgateParcelDetail[] = Object.freeze([
  // ---- Tom Price ----
  {
    pin: "P-TP-1031",
    lotPlan: "Lot 1144 DP 230711",
    address: "Lot 1144 Great Northern Highway, Tom Price",
    landuseCode: "513",
    landuseDescription: "Industrial - mining-related infrastructure",
    areaSquareMetres: 412_000,
    notations: [
      { type: "tenement", reference: "M 47/1612", date: "2026-03-18" },
    ],
  },
  {
    pin: "P-TP-1042",
    lotPlan: "Lot 12 DP 191228",
    address: "14 Stadium Road, Tom Price",
    landuseCode: "211",
    landuseDescription: "Residential - single dwelling",
    areaSquareMetres: 768,
    notations: [],
  },
  // ---- East Pilbara (Newman) ----
  {
    pin: "P-ESH-7011",
    lotPlan: "Lot 8 DP 304221",
    address: "8 Newman Drive, Newman",
    landuseCode: "511",
    landuseDescription: "Industrial - heavy industry",
    areaSquareMetres: 4_800,
    notations: [
      { type: "DA-approval", reference: "DA-2025-184", date: "2025-11-08" },
    ],
  },
  // ---- Kalgoorlie-Boulder ----
  {
    pin: "P-KAL-7777",
    lotPlan: "Lot 211A DP 411902",
    address: "211A Hannan Street, Kalgoorlie",
    landuseCode: "412",
    landuseDescription: "Commercial - retail",
    areaSquareMetres: 320,
    notations: [
      { type: "subdivision", reference: "SUB-2025-722", date: "2025-09-12" },
    ],
  },
  {
    pin: "P-KAL-4401-12",
    lotPlan: "Lot 4412 DP 218043",
    address: "Lot 4412 Goldfields Highway, Kalgoorlie",
    landuseCode: "523",
    landuseDescription: "Mining - production lease",
    areaSquareMetres: 1_980_000,
    notations: [
      { type: "tenement", reference: "M 26/0987", date: "2026-04-02" },
    ],
  },
  // ---- Ashburton (Onslow / Pannawonica) ----
  {
    pin: "P-ASH-9914",
    lotPlan: "Lot 9914 DP 552108",
    address: "Lot 9914A Nanutarra-Wittenoom Road, Pannawonica",
    landuseCode: "511",
    landuseDescription: "Industrial - heavy industry",
    areaSquareMetres: 92_000,
    notations: [
      { type: "boundary-amendment", reference: "BA-2026-019", date: "2026-02-14" },
    ],
  },
  // ---- Tom Price — rural lot now industrial ----
  {
    pin: "P-TPS-1102-44",
    lotPlan: "Lot 1144 DP 230711",
    address: "Lot 1144 Great Northern Highway, Tom Price",
    landuseCode: "513",
    landuseDescription: "Industrial - mining-related infrastructure",
    areaSquareMetres: 514_000,
    notations: [
      { type: "tenement", reference: "M 47/1709", date: "2025-12-21" },
    ],
  },
  // ---- Meekatharra ----
  {
    pin: "P-MEK-3303-58",
    lotPlan: "Lot 358 DP 992014",
    address: "Lot 358 Yulgan Road, Meekatharra",
    landuseCode: "523",
    landuseDescription: "Mining - tailings reprocessing",
    areaSquareMetres: 88_400,
    notations: [
      { type: "tenement", reference: "M 51/0902", date: "2026-03-30" },
    ],
  },
  // ---- Sandstone — clean match (no discrepancy) ----
  {
    pin: "P-SST-2001",
    lotPlan: "Lot 21 DP 102333",
    address: "21 Hack Street, Sandstone",
    landuseCode: "211",
    landuseDescription: "Residential - single dwelling",
    areaSquareMetres: 1_012,
    notations: [],
  },
  // ---- East Pilbara — clean match ----
  {
    pin: "P-ESH-3300",
    lotPlan: "Lot 33 DP 410001",
    address: "33 Iron Ore Way, Newman",
    landuseCode: "211",
    landuseDescription: "Residential - single dwelling",
    areaSquareMetres: 880,
    notations: [],
  },
]);

/**
 * In-memory Landgate client used by tests and the demo fixture path.
 * Mirrors the {@link LandgateRestrictedClient} interface exactly so tests
 * can swap it in via dependency injection.
 */
export function createMockLandgateClient(
  parcels: readonly LandgateParcelDetail[] = LANDGATE_MOCK_PARCELS,
): LandgateRestrictedClient {
  const byPin = new Map(parcels.map((p) => [p.pin, p]));
  const byLotPlan = new Map(parcels.map((p) => [p.lotPlan.toLowerCase(), p]));

  return {
    async getParcelByPin(pin) {
      return byPin.get(pin) ?? null;
    },
    async getParcelByLot(lot, plan) {
      const key = `lot ${lot} ${plan}`.toLowerCase();
      // Loose match: any parcel whose lotPlan contains the lot+plan tokens.
      for (const p of parcels) {
        const lp = p.lotPlan.toLowerCase();
        if (lp === key || (lp.includes(`lot ${lot.toLowerCase()}`) && lp.includes(plan.toLowerCase()))) {
          return p;
        }
      }
      return null;
    },
    async searchByAddress(address) {
      const q = address.trim().toLowerCase();
      return parcels.filter((p) => p.address.toLowerCase().includes(q));
    },
  };
}
