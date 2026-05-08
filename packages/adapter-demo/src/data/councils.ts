/**
 * Seeded council (tenant) records for the demo adapter.
 *
 * The same eight councils are surfaced by the legacy web-app dataset: six in
 * WA, one each in NSW and QLD. Each entry is a `Council` from the contract
 * and carries the council's stable code, official name, demographics, and
 * map centroid for UI rendering.
 */

import type { Council } from "@ratesassist/contract";

/**
 * The full set of councils this adapter knows about. Ordered to match the
 * web app's existing presentation: WA councils first by population, then
 * interstate.
 */
export const COUNCILS: readonly Council[] = Object.freeze([
  {
    code: "TPS",
    name: "Shire of Tom Price",
    state: "WA",
    population: 8_200,
    rateableProperties: 3_450,
    rateRevenue: 18_400_000,
    centerLat: -22.694,
    centerLng: 117.7935,
  },
  {
    code: "ESH",
    name: "Shire of East Pilbara",
    state: "WA",
    population: 11_400,
    rateableProperties: 5_120,
    rateRevenue: 31_700_000,
    centerLat: -23.3556,
    centerLng: 119.7281,
  },
  {
    code: "SST",
    name: "Shire of Sandstone",
    state: "WA",
    population: 145,
    rateableProperties: 320,
    rateRevenue: 2_140_000,
    centerLat: -27.9881,
    centerLng: 119.2944,
  },
  {
    code: "KAL",
    name: "City of Kalgoorlie-Boulder",
    state: "WA",
    population: 30_700,
    rateableProperties: 14_800,
    rateRevenue: 92_300_000,
    centerLat: -30.7489,
    centerLng: 121.466,
  },
  {
    code: "MEK",
    name: "Shire of Meekatharra",
    state: "WA",
    population: 770,
    rateableProperties: 540,
    rateRevenue: 6_200_000,
    centerLat: -26.5897,
    centerLng: 118.4956,
  },
  {
    code: "ASH",
    name: "Shire of Ashburton",
    state: "WA",
    population: 12_700,
    rateableProperties: 4_900,
    rateRevenue: 41_500_000,
    centerLat: -22.6981,
    centerLng: 115.6444,
  },
  {
    code: "BRK",
    name: "Broken Hill City Council",
    state: "NSW",
    population: 17_500,
    rateableProperties: 9_400,
    rateRevenue: 22_100_000,
    centerLat: -31.9573,
    centerLng: 141.467,
  },
  {
    code: "MTI",
    name: "Shire of Mount Isa",
    state: "QLD",
    population: 18_400,
    rateableProperties: 7_800,
    rateRevenue: 28_400_000,
    centerLat: -20.7256,
    centerLng: 139.4927,
  },
]);
