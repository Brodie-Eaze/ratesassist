/**
 * Seeded owner records for the demo adapter.
 *
 * Two layers, mirroring `properties.ts`:
 *
 *   1. **Curated owners** — explicit fixtures with realistic ABNs, contact
 *      details, and (where applicable) ABN status that drives the recovery
 *      engine's `id.abn.cancelled_or_suspended` and `id.holder_ne_owner`
 *      signals.
 *
 *   2. **Generic owners** — 60 deterministic individual owners (`O-GEN-030`
 *      through `O-GEN-089`). Of these, only the first nine are referenced
 *      by the generic property generator; the rest exist so that future
 *      data extensions can tag properties to a wider pool without changing
 *      the existing assessment-to-owner mapping.
 *
 * Pseudonyms are intentionally professional (no nicknames or in-jokes) so
 * the dataset is presentable to councils as part of a vendor demo.
 */

import type { Owner } from "@ratesassist/contract";

/** Generic-owner ID range start (inclusive). Matches the property generator. */
const GENERIC_OWNER_BASE = 30;

/** Number of generic owners to materialise. Range is [BASE, BASE + COUNT). */
const GENERIC_OWNER_COUNT = 60;

/**
 * Pool of first names used by the generic generator. Deliberately mainstream
 * AU names; no celebrities, no real council staff.
 */
const FIRST_NAMES: readonly string[] = [
  "John",
  "Mary",
  "David",
  "Sarah",
  "Michael",
  "Lisa",
  "James",
  "Anna",
  "Robert",
  "Emma",
  "Andrew",
  "Rachel",
  "Brian",
  "Karen",
];

/** Pool of surnames for the generic generator. */
const LAST_NAMES: readonly string[] = [
  "Smith",
  "Jones",
  "Brown",
  "Williams",
  "Taylor",
  "Davis",
  "Wilson",
  "Anderson",
  "Thompson",
  "White",
  "Harris",
  "Martin",
  "Walker",
];

/**
 * Hand-curated owners. Each entry mirrors the legacy fixture with two
 * professionalising changes preserved from the prior round:
 *   - "Mum" / "Brodie (demo)" pseudonyms removed in favour of consistent
 *     professional names like `S. Patel`, `R. Davies`.
 *   - ABN statuses on `O-WA-002` (cancelled) drive the identity signal.
 */
const CURATED_OWNERS: readonly Owner[] = [
  {
    ownerId: "O-WA-001",
    name: "Pilbara Iron Holdings Pty Ltd",
    abn: "32 614 882 110",
    postalAddress: "Level 12, 100 St Georges Terrace, Perth WA 6000",
    email: "rates@pilbara-iron.example",
    phone: "08 9200 7700",
    ownerSince: "2014-08-19",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-002",
    name: "Karratha Exploration Pty Ltd",
    abn: "44 990 221 005",
    abnStatus: "Cancelled",
    postalAddress: "PO Box 5511, Karratha WA 6714",
    email: "admin@karratha-exploration.example",
    phone: "08 9144 2200",
    ownerSince: "2022-11-14",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-003",
    name: "Goldfields Resources Ltd",
    abn: "18 552 117 884",
    postalAddress: "Level 5, 50 Kings Park Road, West Perth WA 6005",
    email: "rates@goldfields-resources.example",
    phone: "08 9226 1100",
    ownerSince: "2009-06-22",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-004",
    name: "Sandstone Prospecting Pty Ltd",
    abn: "82 144 029 561",
    postalAddress: "PO Box 88, Sandstone WA 6639",
    email: "info@sandstone-prospecting.example",
    phone: "0428 990 117",
    ownerSince: "2023-04-01",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-005",
    name: "Newman Solar Pty Ltd",
    abn: "55 220 901 477",
    postalAddress: "Level 3, 240 St Georges Terrace, Perth WA 6000",
    email: "info@newman-solar.example",
    phone: "08 9483 2200",
    ownerSince: "2024-01-15",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-010",
    name: "John & Sarah Wilkins",
    abn: null,
    postalAddress: "12 Stadium Road, Tom Price WA 6751",
    email: "j.wilkins@example.com",
    phone: "0408 121 884",
    ownerSince: "2018-09-04",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-011",
    name: "Margaret Thompson",
    abn: null,
    postalAddress: "44 Yampire Road, Tom Price WA 6751",
    email: null,
    phone: "0419 552 081",
    ownerSince: "1998-03-22",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-012",
    name: "Newman Trading Co Pty Ltd",
    abn: "29 008 442 119",
    postalAddress: "PO Box 401, Newman WA 6753",
    email: "accounts@newman-trading.example",
    phone: "08 9175 4400",
    ownerSince: "2010-07-12",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-020",
    name: "Estate of L. Marshall",
    abn: null,
    postalAddress: "C/- Henderson Lawyers, PO Box 22, Perth WA 6000",
    email: null,
    phone: null,
    ownerSince: "2024-08-01",
    previousOwners: [{ name: "Lillian Marshall", period: "1972-2024" }],
  },
  {
    ownerId: "O-WA-021",
    name: "Goldfields Pastoral Pty Ltd",
    abn: "61 005 998 220",
    postalAddress: "PO Box 442, Kalgoorlie WA 6430",
    email: "office@gf-pastoral.example",
    phone: "08 9021 7700",
    ownerSince: "2003-09-12",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-022",
    name: "Boulder Block Investments Pty Ltd",
    abn: "75 144 882 011",
    postalAddress: "PO Box 88, Boulder WA 6432",
    email: "ar@bbi.example",
    phone: "08 9093 8800",
    ownerSince: "2017-04-14",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-023",
    name: "Hannan Holdings Pty Ltd",
    abn: "98 220 991 003",
    postalAddress: "Hannan Street 211, Kalgoorlie WA 6430",
    email: "office@hannan.example",
    phone: "08 9021 1100",
    ownerSince: "1999-02-03",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-024",
    name: "Murchison Holdings Pty Ltd",
    abn: "12 003 882 770",
    postalAddress: "PO Box 11, Meekatharra WA 6642",
    email: "admin@murchison-h.example",
    phone: "08 9981 1100",
    ownerSince: "2011-05-14",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-025",
    name: "Pilbara Minerals Processing Ltd",
    abn: "44 882 011 559",
    postalAddress: "Level 8, 240 St Georges Terrace, Perth WA 6000",
    email: "ar@pmp.example",
    phone: "08 9483 7700",
    ownerSince: "2016-11-20",
    previousOwners: [],
  },
  {
    ownerId: "O-NSW-001",
    name: "Argent Property Group Pty Ltd",
    abn: "55 122 880 044",
    postalAddress: "12 Argent Street, Broken Hill NSW 2880",
    email: "office@argent.example",
    phone: "08 8087 4400",
    ownerSince: "2010-03-15",
    previousOwners: [],
  },
  {
    ownerId: "O-NSW-002",
    name: "Daniel & Emily Foster",
    abn: null,
    postalAddress: "47 Iodide Street, Broken Hill NSW 2880",
    email: "fosters@example.com",
    phone: "0418 221 887",
    ownerSince: "2019-08-22",
    previousOwners: [],
  },
  {
    ownerId: "O-NSW-003",
    name: "Silver City Pastoral Co",
    abn: "08 880 442 119",
    postalAddress: "PO Box 1102, Broken Hill NSW 2880",
    email: "office@scpc.example",
    phone: "08 8087 9911",
    ownerSince: "1992-12-01",
    previousOwners: [],
  },
  {
    ownerId: "O-QLD-001",
    name: "Diamantina Pastoral Pty Ltd",
    abn: "29 442 008 117",
    postalAddress: "PO Box 880, Mount Isa QLD 4825",
    email: "office@diamantina-p.example",
    phone: "07 4743 2200",
    ownerSince: "2014-06-10",
    previousOwners: [],
  },
  {
    ownerId: "O-QLD-002",
    name: "Camooweal Holdings Pty Ltd",
    abn: "13 552 008 116",
    postalAddress: "33 Camooweal Street, Mount Isa QLD 4825",
    email: "ar@camooweal-h.example",
    phone: "07 4743 4400",
    ownerSince: "2008-04-22",
    previousOwners: [],
  },
];

/**
 * Generate `GENERIC_OWNER_COUNT` deterministic individual owners. Pure;
 * always produces the same sequence.
 */
function generateGenericOwners(): readonly Owner[] {
  return Array.from({ length: GENERIC_OWNER_COUNT }, (_, i) => {
    const idx = i + GENERIC_OWNER_BASE;
    const id = `O-GEN-${idx.toString().padStart(3, "0")}`;
    const fn = FIRST_NAMES[i % FIRST_NAMES.length] ?? "John";
    const ln = LAST_NAMES[(i * 3) % LAST_NAMES.length] ?? "Smith";
    return {
      ownerId: id,
      name: `${fn} ${ln}`,
      abn: null,
      postalAddress: `PO Box ${100 + i * 7}, Perth WA 6000`,
      email: `${fn}.${ln}@example.com`.toLowerCase(),
      phone: `04${String(10_000_000 + i * 1_331).slice(0, 8)}`,
      ownerSince: `${2000 + (i % 22)}-${String((i % 12) + 1).padStart(2, "0")}-15`,
      previousOwners: [],
    };
  });
}

/**
 * The full owner dataset (curated then generic). Frozen — mutating handlers
 * (e.g. `update_owner_contact`) MUST replace records, never edit in place.
 */
export const OWNERS: readonly Owner[] = Object.freeze([
  ...CURATED_OWNERS,
  ...generateGenericOwners(),
]);
