#!/usr/bin/env node

// src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// ../contract/src/schemas.ts
import { z } from "zod";
var tone = z.enum(["friendly", "firm", "final"]);
var severity = z.enum(["high", "medium", "low"]);
var australianState = z.enum(["WA", "NSW", "VIC", "QLD", "SA", "TAS", "ACT", "NT"]);
var assessmentNumber = z.string().min(3).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/i, "assessment numbers are alphanumeric with dashes");
var councilCode = z.string().min(2).max(8).regex(/^[A-Z]+$/);
var abn = z.string().regex(/^\d[\d\s]{9,}\d$/, "ABN must be 11 digits with optional spaces");
var inputs = {
  search_property: z.object({
    query: z.string().min(1).max(200)
  }),
  search_by_owner: z.object({
    name: z.string().min(1).max(200),
    suburb: z.string().max(80).optional()
  }),
  get_property_detail: z.object({
    assessmentNumber
  }),
  get_transaction_history: z.object({
    assessmentNumber
  }),
  list_overdue: z.object({
    council: councilCode.optional(),
    minDaysOverdue: z.number().int().min(0).max(3650).optional()
  }),
  list_properties: z.object({
    council: councilCode.optional(),
    limit: z.number().int().min(1).max(1e3).optional(),
    offset: z.number().int().min(0).optional()
  }),
  list_councils: z.object({}).strict(),
  get_owner: z.object({
    ownerId: z.string().min(1).max(80)
  }),
  draft_payment_reminder: z.object({
    assessmentNumber,
    tone: tone.default("friendly")
  }),
  draft_chase_all_overdue: z.object({
    tone: tone.default("friendly"),
    council: councilCode.optional()
  }),
  update_owner_contact: z.object({
    ownerId: z.string().min(1).max(80),
    newPhone: z.string().min(6).max(40).optional(),
    newEmail: z.string().email().max(200).optional(),
    /**
     * Two-phase commit. First call with confirm=false returns a preview
     * + a server-issued commit token. Second call with confirm=true and
     * the token actually applies the change.
     */
    confirm: z.boolean().default(false),
    commitToken: z.string().optional()
  }).refine(
    (v) => v.newPhone !== void 0 || v.newEmail !== void 0,
    "must provide newPhone and/or newEmail"
  ),
  add_property_note: z.object({
    assessmentNumber,
    note: z.string().min(1).max(4e3),
    confirm: z.boolean().default(false),
    commitToken: z.string().optional()
  }),
  generate_statutory_certificate: z.object({
    assessmentNumber,
    /** State-specific certificate type, e.g. "WA-6.76", "NSW-603", "QLD-95". */
    certificateType: z.string().min(2).max(40),
    requesterName: z.string().min(1).max(200),
    requesterEmail: z.string().email().max(200)
  }),
  get_tenement_for_property: z.object({
    assessmentNumber
  }),
  find_mining_mismatches: z.object({
    council: councilCode.optional(),
    minSeverity: severity.optional()
  }),
  generate_evidence_pack: z.object({
    assessmentNumber
  }),
  recovery_summary: z.object({
    council: councilCode.optional()
  }),
  daily_briefing: z.object({
    council: councilCode.optional()
  }),
  verify_abn: z.object({
    abn
  })
};
var toolResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    output: z.string(),
    /** Optional structured payload for the client to render rich UI. */
    data: z.unknown().optional(),
    /** Optional commit token for two-phase mutating operations. */
    commitToken: z.string().optional(),
    /** Whether this tool call mutated state. False for read-only tools and previews. */
    mutated: z.boolean().default(false)
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    /** Stable, machine-readable error code for clients to branch on. */
    code: z.enum([
      "not_found",
      "invalid_input",
      "unauthorized",
      "forbidden",
      "conflict",
      "rate_limited",
      "upstream_error",
      "timeout",
      "internal_error"
    ]),
    correlationId: z.string().optional(),
    retryable: z.boolean().default(false)
  })
]);
var adapterCapability = z.enum([
  "read.property",
  "read.owner",
  "read.transactions",
  "read.list_overdue",
  "write.update_owner_contact",
  "write.add_property_note",
  "write.payment_arrangement",
  "write.pensioner_rebate",
  "write.address_change",
  "generate.statutory_certificate"
]);
var adapterIdentity = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  vendor: z.string().min(1).max(200),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  contractVersion: z.string().regex(/^\d+\.\d+\.\d+/),
  capabilities: z.array(adapterCapability)
});

// ../contract/src/tools.ts
import { zodToJsonSchema } from "zod-to-json-schema";
var descriptions = {
  search_property: "Search properties by address fragment, suburb, postcode, or assessment number across the active tenant's portfolio.",
  search_by_owner: "Find properties by owner name (partial OK). Optional suburb filter.",
  get_property_detail: "Full record for one property \u2014 owner(s), valuation, balance, payment status, notes, intersecting tenements.",
  get_transaction_history: "Transaction history (levies, payments, adjustments, interest) for a property.",
  list_overdue: "List all properties with an outstanding rates balance.",
  list_properties: "Paginated property listing for the active tenant.",
  list_councils: "List councils accessible in the current session.",
  get_owner: "Get an owner record by ID, including ABN status if known.",
  draft_payment_reminder: "Draft a personalised payment reminder. Returns the draft only \u2014 does NOT send.",
  draft_chase_all_overdue: "Draft personalised reminders for all overdue properties not on a payment arrangement. Batch preview only \u2014 does NOT send.",
  update_owner_contact: "Update an owner's phone and/or email. Two-phase: first call returns preview + commit token; second call (confirm=true with token) actually applies. Never auto-commits.",
  add_property_note: "Add a note to a property's record. Two-phase: first call returns preview + commit token; second call applies.",
  generate_statutory_certificate: "Produce a state-specific statutory rates certificate (WA s.6.76, NSW s.603, QLD s.95) for a property.",
  get_tenement_for_property: "Look up mining tenements that intersect a specific property assessment.",
  find_mining_mismatches: "Cross-reference rated properties against active mining tenements and surface candidates whose rating classification appears mis-aligned with actual land use. Returns ranked list with composite confidence and estimated annual uplift.",
  generate_evidence_pack: "Produce a council-grade reclassification evidence pack for a mining-mismatch candidate. Includes property record, signal trail, statutory basis, draft notice text, and audit trail.",
  recovery_summary: "Aggregate recovery position: count and dollar value of candidates by severity, total estimated uplift and arrears.",
  daily_briefing: "Morning briefing for a rates officer: overdue, recovery candidates, action items.",
  verify_abn: "Verify an Australian Business Number via the ATO public ABN Lookup API. Returns entity name, status, type, GST registration."
};
function buildToolCatalogue() {
  return Object.entries(inputs).map(([name, schema]) => ({
    name,
    description: descriptions[name],
    inputSchema: zodToJsonSchema(schema, { target: "openApi3" })
  }));
}

// ../contract/src/index.ts
var CONTRACT_VERSION = "0.2.0";

// src/data/councils.ts
var COUNCILS = Object.freeze([
  {
    code: "TPS",
    name: "Shire of Tom Price",
    state: "WA",
    population: 8200,
    rateableProperties: 3450,
    rateRevenue: 184e5,
    centerLat: -22.694,
    centerLng: 117.7935
  },
  {
    code: "ESH",
    name: "Shire of East Pilbara",
    state: "WA",
    population: 11400,
    rateableProperties: 5120,
    rateRevenue: 317e5,
    centerLat: -23.3556,
    centerLng: 119.7281
  },
  {
    code: "SST",
    name: "Shire of Sandstone",
    state: "WA",
    population: 145,
    rateableProperties: 320,
    rateRevenue: 214e4,
    centerLat: -27.9881,
    centerLng: 119.2944
  },
  {
    code: "KAL",
    name: "City of Kalgoorlie-Boulder",
    state: "WA",
    population: 30700,
    rateableProperties: 14800,
    rateRevenue: 923e5,
    centerLat: -30.7489,
    centerLng: 121.466
  },
  {
    code: "MEK",
    name: "Shire of Meekatharra",
    state: "WA",
    population: 770,
    rateableProperties: 540,
    rateRevenue: 62e5,
    centerLat: -26.5897,
    centerLng: 118.4956
  },
  {
    code: "ASH",
    name: "Shire of Ashburton",
    state: "WA",
    population: 12700,
    rateableProperties: 4900,
    rateRevenue: 415e5,
    centerLat: -22.6981,
    centerLng: 115.6444
  },
  {
    code: "BRK",
    name: "Broken Hill City Council",
    state: "NSW",
    population: 17500,
    rateableProperties: 9400,
    rateRevenue: 221e5,
    centerLat: -31.9573,
    centerLng: 141.467
  },
  {
    code: "MTI",
    name: "Shire of Mount Isa",
    state: "QLD",
    population: 18400,
    rateableProperties: 7800,
    rateRevenue: 284e5,
    centerLat: -20.7256,
    centerLng: 139.4927
  }
]);

// src/data/owners.ts
var GENERIC_OWNER_BASE = 30;
var GENERIC_OWNER_COUNT = 60;
var FIRST_NAMES = [
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
  "Karen"
];
var LAST_NAMES = [
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
  "Walker"
];
var CURATED_OWNERS = [
  {
    ownerId: "O-WA-001",
    name: "Pilbara Iron Holdings Pty Ltd",
    abn: "32 614 882 110",
    postalAddress: "Level 12, 100 St Georges Terrace, Perth WA 6000",
    email: "rates@pilbara-iron.example",
    phone: "08 9200 7700",
    ownerSince: "2014-08-19",
    previousOwners: []
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
    previousOwners: []
  },
  {
    ownerId: "O-WA-003",
    name: "Goldfields Resources Ltd",
    abn: "18 552 117 884",
    postalAddress: "Level 5, 50 Kings Park Road, West Perth WA 6005",
    email: "rates@goldfields-resources.example",
    phone: "08 9226 1100",
    ownerSince: "2009-06-22",
    previousOwners: []
  },
  {
    ownerId: "O-WA-004",
    name: "Sandstone Prospecting Pty Ltd",
    abn: "82 144 029 561",
    postalAddress: "PO Box 88, Sandstone WA 6639",
    email: "info@sandstone-prospecting.example",
    phone: "0428 990 117",
    ownerSince: "2023-04-01",
    previousOwners: []
  },
  {
    ownerId: "O-WA-005",
    name: "Newman Solar Pty Ltd",
    abn: "55 220 901 477",
    postalAddress: "Level 3, 240 St Georges Terrace, Perth WA 6000",
    email: "info@newman-solar.example",
    phone: "08 9483 2200",
    ownerSince: "2024-01-15",
    previousOwners: []
  },
  {
    ownerId: "O-WA-010",
    name: "John & Sarah Wilkins",
    abn: null,
    postalAddress: "12 Stadium Road, Tom Price WA 6751",
    email: "j.wilkins@example.com",
    phone: "0408 121 884",
    ownerSince: "2018-09-04",
    previousOwners: []
  },
  {
    ownerId: "O-WA-011",
    name: "Margaret Thompson",
    abn: null,
    postalAddress: "44 Yampire Road, Tom Price WA 6751",
    email: null,
    phone: "0419 552 081",
    ownerSince: "1998-03-22",
    previousOwners: []
  },
  {
    ownerId: "O-WA-012",
    name: "Newman Trading Co Pty Ltd",
    abn: "29 008 442 119",
    postalAddress: "PO Box 401, Newman WA 6753",
    email: "accounts@newman-trading.example",
    phone: "08 9175 4400",
    ownerSince: "2010-07-12",
    previousOwners: []
  },
  {
    ownerId: "O-WA-020",
    name: "Estate of L. Marshall",
    abn: null,
    postalAddress: "C/- Henderson Lawyers, PO Box 22, Perth WA 6000",
    email: null,
    phone: null,
    ownerSince: "2024-08-01",
    previousOwners: [{ name: "Lillian Marshall", period: "1972-2024" }]
  },
  {
    ownerId: "O-WA-021",
    name: "Goldfields Pastoral Pty Ltd",
    abn: "61 005 998 220",
    postalAddress: "PO Box 442, Kalgoorlie WA 6430",
    email: "office@gf-pastoral.example",
    phone: "08 9021 7700",
    ownerSince: "2003-09-12",
    previousOwners: []
  },
  {
    ownerId: "O-WA-022",
    name: "Boulder Block Investments Pty Ltd",
    abn: "75 144 882 011",
    postalAddress: "PO Box 88, Boulder WA 6432",
    email: "ar@bbi.example",
    phone: "08 9093 8800",
    ownerSince: "2017-04-14",
    previousOwners: []
  },
  {
    ownerId: "O-WA-023",
    name: "Hannan Holdings Pty Ltd",
    abn: "98 220 991 003",
    postalAddress: "Hannan Street 211, Kalgoorlie WA 6430",
    email: "office@hannan.example",
    phone: "08 9021 1100",
    ownerSince: "1999-02-03",
    previousOwners: []
  },
  {
    ownerId: "O-WA-024",
    name: "Murchison Holdings Pty Ltd",
    abn: "12 003 882 770",
    postalAddress: "PO Box 11, Meekatharra WA 6642",
    email: "admin@murchison-h.example",
    phone: "08 9981 1100",
    ownerSince: "2011-05-14",
    previousOwners: []
  },
  {
    ownerId: "O-WA-025",
    name: "Pilbara Minerals Processing Ltd",
    abn: "44 882 011 559",
    postalAddress: "Level 8, 240 St Georges Terrace, Perth WA 6000",
    email: "ar@pmp.example",
    phone: "08 9483 7700",
    ownerSince: "2016-11-20",
    previousOwners: []
  },
  {
    ownerId: "O-NSW-001",
    name: "Argent Property Group Pty Ltd",
    abn: "55 122 880 044",
    postalAddress: "12 Argent Street, Broken Hill NSW 2880",
    email: "office@argent.example",
    phone: "08 8087 4400",
    ownerSince: "2010-03-15",
    previousOwners: []
  },
  {
    ownerId: "O-NSW-002",
    name: "Daniel & Emily Foster",
    abn: null,
    postalAddress: "47 Iodide Street, Broken Hill NSW 2880",
    email: "fosters@example.com",
    phone: "0418 221 887",
    ownerSince: "2019-08-22",
    previousOwners: []
  },
  {
    ownerId: "O-NSW-003",
    name: "Silver City Pastoral Co",
    abn: "08 880 442 119",
    postalAddress: "PO Box 1102, Broken Hill NSW 2880",
    email: "office@scpc.example",
    phone: "08 8087 9911",
    ownerSince: "1992-12-01",
    previousOwners: []
  },
  {
    ownerId: "O-QLD-001",
    name: "Diamantina Pastoral Pty Ltd",
    abn: "29 442 008 117",
    postalAddress: "PO Box 880, Mount Isa QLD 4825",
    email: "office@diamantina-p.example",
    phone: "07 4743 2200",
    ownerSince: "2014-06-10",
    previousOwners: []
  },
  {
    ownerId: "O-QLD-002",
    name: "Camooweal Holdings Pty Ltd",
    abn: "13 552 008 116",
    postalAddress: "33 Camooweal Street, Mount Isa QLD 4825",
    email: "ar@camooweal-h.example",
    phone: "07 4743 4400",
    ownerSince: "2008-04-22",
    previousOwners: []
  }
];
function generateGenericOwners() {
  return Array.from({ length: GENERIC_OWNER_COUNT }, (_, i) => {
    const idx = i + GENERIC_OWNER_BASE;
    const id = `O-GEN-${idx.toString().padStart(3, "0")}`;
    const fn = FIRST_NAMES[i % FIRST_NAMES.length] ?? "John";
    const ln = LAST_NAMES[i * 3 % LAST_NAMES.length] ?? "Smith";
    return {
      ownerId: id,
      name: `${fn} ${ln}`,
      abn: null,
      postalAddress: `PO Box ${100 + i * 7}, Perth WA 6000`,
      email: `${fn}.${ln}@example.com`.toLowerCase(),
      phone: `04${String(1e7 + i * 1331).slice(0, 8)}`,
      ownerSince: `${2e3 + i % 22}-${String(i % 12 + 1).padStart(2, "0")}-15`,
      previousOwners: []
    };
  });
}
var OWNERS = Object.freeze([
  ...CURATED_OWNERS,
  ...generateGenericOwners()
]);

// src/data/geometry.ts
var METRES_PER_DEGREE_LAT = 111111;
var DEFAULT_PARCEL_SIDE_M = 50;
var SQUARE_METRES_PER_HECTARE = 1e4;
function parcelSquare(lat, lng, sizeM = DEFAULT_PARCEL_SIDE_M) {
  const dLat = sizeM / METRES_PER_DEGREE_LAT;
  const dLng = sizeM / (METRES_PER_DEGREE_LAT * Math.cos(lat * Math.PI / 180));
  return [
    [lat - dLat, lng - dLng],
    [lat - dLat, lng + dLng],
    [lat + dLat, lng + dLng],
    [lat + dLat, lng - dLng]
  ];
}
function tenementHexagon(lat, lng, hectares) {
  const sideM = Math.sqrt(hectares * SQUARE_METRES_PER_HECTARE);
  const dLat = sideM / 2 / METRES_PER_DEGREE_LAT;
  const dLng = sideM / 2 / (METRES_PER_DEGREE_LAT * Math.cos(lat * Math.PI / 180));
  return [
    [lat - dLat, lng - dLng * 0.7],
    [lat - dLat * 0.7, lng + dLng * 0.9],
    [lat + dLat * 0.4, lng + dLng],
    [lat + dLat, lng + dLng * 0.5],
    [lat + dLat * 0.6, lng - dLng * 0.8],
    [lat - dLat * 0.3, lng - dLng]
  ];
}

// src/data/properties.ts
var RATES_RATE_OF_VALUATION = 5e-3;
var GENERIC_PER_LOCALE = 10;
var GENERIC_OWNER_BASE2 = 30;
var GENERIC_OWNER_POOL = 9;
var STREET_NAMES = [
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
  "Zircon"
];
var STREET_TYPES = [
  "Street",
  "Road",
  "Avenue",
  "Drive",
  "Lane",
  "Crescent",
  "Place"
];
var CURATED = [
  // ---- TPS — Tom Price ----
  {
    assessmentNumber: "TPS-1102-44",
    council: "TPS",
    address: "Lot 1144 Great Northern Highway",
    suburb: "Tom Price",
    postcode: "6751",
    state: "WA",
    landUse: "Rural",
    valuation: 38e4,
    annualRates: 1820,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 455,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Rural classification on file since 2014."],
    lat: -22.694,
    lng: 117.7935
  },
  {
    assessmentNumber: "TPS-1102-47",
    council: "TPS",
    address: "Lot 1147 Great Northern Highway",
    suburb: "Tom Price",
    postcode: "6751",
    state: "WA",
    landUse: "Rural",
    valuation: 41e4,
    annualRates: 1960,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 490,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Rural classification on file since 2017."],
    lat: -22.6982,
    lng: 117.7892
  },
  {
    assessmentNumber: "TPS-1102-91",
    council: "TPS",
    address: "Lot 1191 Tom Price Mining Road",
    suburb: "Tom Price",
    postcode: "6751",
    state: "WA",
    landUse: "Rural",
    valuation: 285e3,
    annualRates: 1200,
    balance: 0,
    lastPaymentDate: "2026-03-20",
    lastPaymentAmount: 300,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Includes light infrastructure access road."],
    lat: -22.7102,
    lng: 117.8011
  },
  {
    assessmentNumber: "TPS-3041-12",
    council: "TPS",
    address: "12 Stadium Road",
    suburb: "Tom Price",
    postcode: "6751",
    state: "WA",
    landUse: "Residential",
    valuation: 42e4,
    annualRates: 2140,
    balance: 535,
    lastPaymentDate: "2025-11-04",
    lastPaymentAmount: 535,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-010"],
    notes: ["Q1 2026 instalment overdue 28 days."],
    lat: -22.6885,
    lng: 117.795
  },
  {
    assessmentNumber: "TPS-3041-44",
    council: "TPS",
    address: "44 Yampire Road",
    suburb: "Tom Price",
    postcode: "6751",
    state: "WA",
    landUse: "Residential",
    valuation: 385e3,
    annualRates: 1960,
    balance: 0,
    lastPaymentDate: "2026-04-02",
    lastPaymentAmount: 490,
    paymentMethod: "Direct Debit",
    pensionerRebate: true,
    paymentArrangement: false,
    ownerIds: ["O-WA-011"],
    notes: ["Pensioner rebate active (WA $250 + council $200)."],
    lat: -22.6921,
    lng: 117.7903
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
    valuation: 24e4,
    annualRates: 980,
    balance: 0,
    lastPaymentDate: "2026-03-15",
    lastPaymentAmount: 245,
    paymentMethod: "Direct Debit",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-002"],
    notes: ["Listed as vacant \u2014 last inspection 2021."],
    lat: -20.7364,
    lng: 116.8463
  },
  {
    assessmentNumber: "ESH-1102-88",
    council: "ESH",
    address: "Lot 1188 Solar Farm Road",
    suburb: "Newman",
    postcode: "6753",
    state: "WA",
    landUse: "Vacant",
    valuation: 18e4,
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
    lng: 119.7349
  },
  {
    assessmentNumber: "ESH-1102-92",
    council: "ESH",
    address: "Lot 1192 Auski Road",
    suburb: "Newman",
    postcode: "6753",
    state: "WA",
    landUse: "Rural",
    valuation: 51e4,
    annualRates: 2240,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 560,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Rural \u2014 but tenement coverage growing."],
    lat: -23.3801,
    lng: 119.7461
  },
  {
    assessmentNumber: "ESH-7011-08",
    council: "ESH",
    address: "8 Newman Drive",
    suburb: "Newman",
    postcode: "6753",
    state: "WA",
    landUse: "Commercial",
    valuation: 184e4,
    annualRates: 12400,
    balance: 3100,
    lastPaymentDate: "2025-10-15",
    lastPaymentAmount: 3100,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: true,
    ownerIds: ["O-WA-012"],
    notes: [
      "12-month payment arrangement signed 2025-09-01.",
      "On track."
    ],
    lat: -23.3556,
    lng: 119.7281
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
    valuation: 195e3,
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
    lng: 119.2944
  },
  {
    assessmentNumber: "SST-2204-31",
    council: "SST",
    address: "Lot 231 Sandstone-Mount Magnet Road",
    suburb: "Sandstone",
    postcode: "6639",
    state: "WA",
    landUse: "Rural",
    valuation: 175e3,
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
    lng: 119.3122
  },
  {
    assessmentNumber: "SST-2204-58",
    council: "SST",
    address: "Lot 258 Murchison Highway",
    suburb: "Sandstone",
    postcode: "6639",
    state: "WA",
    landUse: "Vacant",
    valuation: 11e4,
    annualRates: 420,
    balance: 1260,
    lastPaymentDate: "2024-12-01",
    lastPaymentAmount: 420,
    paymentMethod: "Mail",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-020"],
    notes: ["Out-of-state owner, mail returned twice."],
    lat: -27.976,
    lng: 119.2812
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
    valuation: 54e4,
    annualRates: 2800,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 700,
    paymentMethod: "Direct Debit",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-021"],
    notes: ["Rural; surrounded by active gold tenements."],
    lat: -30.7321,
    lng: 121.4855
  },
  {
    assessmentNumber: "KAL-4401-45",
    council: "KAL",
    address: "Lot 4445 Boulder Block Road",
    suburb: "Boulder",
    postcode: "6432",
    state: "WA",
    landUse: "Rural",
    valuation: 49e4,
    annualRates: 2460,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 615,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-021"],
    notes: [],
    lat: -30.7892,
    lng: 121.499
  },
  {
    assessmentNumber: "KAL-4401-77",
    council: "KAL",
    address: "Lot 4477 Coolgardie Esplanade",
    suburb: "Kalgoorlie",
    postcode: "6430",
    state: "WA",
    landUse: "Vacant",
    valuation: 24e4,
    annualRates: 1200,
    balance: 0,
    lastPaymentDate: "2026-03-22",
    lastPaymentAmount: 300,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-022"],
    notes: ["Vacant; recent aerial change detected."],
    lat: -30.7522,
    lng: 121.4555
  },
  {
    assessmentNumber: "KAL-7777-01",
    council: "KAL",
    address: "Hannan Street 211",
    suburb: "Kalgoorlie",
    postcode: "6430",
    state: "WA",
    landUse: "Commercial",
    valuation: 21e5,
    annualRates: 14800,
    balance: 0,
    lastPaymentDate: "2026-04-04",
    lastPaymentAmount: 3700,
    paymentMethod: "Direct Debit",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-023"],
    notes: ["Heritage facade; CBD frontage."],
    lat: -30.746,
    lng: 121.4694
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
    valuation: 22e4,
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
    lng: 118.4956
  },
  {
    assessmentNumber: "MEK-3303-58",
    council: "MEK",
    address: "Lot 358 Yulgan Road",
    suburb: "Meekatharra",
    postcode: "6642",
    state: "WA",
    landUse: "Vacant",
    valuation: 11e4,
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
    lng: 118.5102
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
    valuation: 42e5,
    annualRates: 38200,
    balance: 9550,
    lastPaymentDate: "2025-09-15",
    lastPaymentAmount: 9550,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: true,
    ownerIds: ["O-WA-025"],
    notes: [
      "Mineral processing facility.",
      "Active payment arrangement, 24-month term."
    ],
    lat: -22.6981,
    lng: 115.6444
  },
  {
    assessmentNumber: "ASH-9911-22",
    council: "ASH",
    address: "Lot 9922 Tom Price-Karratha Road",
    suburb: "Pannawonica",
    postcode: "6716",
    state: "WA",
    landUse: "Rural",
    valuation: 36e4,
    annualRates: 1460,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 365,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Rural \u2014 but tenement coverage."],
    lat: -21.6431,
    lng: 116.3388
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
    valuation: 88e4,
    annualRates: 6400,
    balance: 0,
    lastPaymentDate: "2026-04-05",
    lastPaymentAmount: 1600,
    paymentMethod: "Direct Debit",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-NSW-001"],
    notes: [],
    lat: -31.9573,
    lng: 141.467
  },
  {
    assessmentNumber: "BRK-5512-19",
    council: "BRK",
    address: "47 Iodide Street",
    suburb: "Broken Hill",
    postcode: "2880",
    state: "NSW",
    landUse: "Residential",
    valuation: 32e4,
    annualRates: 1840,
    balance: 460,
    lastPaymentDate: "2025-11-15",
    lastPaymentAmount: 460,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-NSW-002"],
    notes: ["Q1 2026 overdue 18 days."],
    lat: -31.959,
    lng: 141.4612
  },
  {
    assessmentNumber: "BRK-5512-44",
    council: "BRK",
    address: "Lot 4 Silver City Highway",
    suburb: "Broken Hill",
    postcode: "2880",
    state: "NSW",
    landUse: "Rural",
    valuation: 25e4,
    annualRates: 1240,
    balance: 0,
    lastPaymentDate: "2026-03-25",
    lastPaymentAmount: 310,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-NSW-003"],
    notes: ["Rural; live tenement coverage."],
    lat: -31.9722,
    lng: 141.5102
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
    valuation: 29e4,
    annualRates: 1220,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 305,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-QLD-001"],
    notes: ["Rural; copper-zinc tenement."],
    lat: -20.7256,
    lng: 139.4927
  },
  {
    assessmentNumber: "MTI-6601-33",
    council: "MTI",
    address: "33 Camooweal Street",
    suburb: "Mount Isa",
    postcode: "4825",
    state: "QLD",
    landUse: "Commercial",
    valuation: 108e4,
    annualRates: 8200,
    balance: 2050,
    lastPaymentDate: "2025-10-01",
    lastPaymentAmount: 2050,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-QLD-002"],
    notes: ["Q1 2026 instalment overdue 36 days."],
    lat: -20.7301,
    lng: 139.4894
  }
];
var GENERIC_LOCALES = [
  { council: "TPS", suburb: "Tom Price", postcode: "6751", state: "WA", lat: -22.69, lng: 117.792 },
  { council: "ESH", suburb: "Newman", postcode: "6753", state: "WA", lat: -23.357, lng: 119.737 },
  { council: "ESH", suburb: "Karratha", postcode: "6714", state: "WA", lat: -20.738, lng: 116.846 },
  { council: "KAL", suburb: "Kalgoorlie", postcode: "6430", state: "WA", lat: -30.749, lng: 121.469 },
  { council: "KAL", suburb: "Boulder", postcode: "6432", state: "WA", lat: -30.789, lng: 121.498 },
  { council: "MEK", suburb: "Meekatharra", postcode: "6642", state: "WA", lat: -26.589, lng: 118.495 },
  { council: "ASH", suburb: "Onslow", postcode: "6710", state: "WA", lat: -21.642, lng: 115.107 },
  { council: "BRK", suburb: "Broken Hill", postcode: "2880", state: "NSW", lat: -31.959, lng: 141.467 },
  { council: "MTI", suburb: "Mount Isa", postcode: "4825", state: "QLD", lat: -20.725, lng: 139.493 }
];
var LANDUSE_CYCLE = [
  "Residential",
  "Residential",
  "Residential",
  "Residential",
  "Vacant",
  "Commercial",
  "Rural"
];
function paymentMethodFor(counter) {
  const r = counter % 3;
  if (r === 0) return "Direct Debit";
  if (r === 1) return "BPAY";
  return "Counter";
}
function generateGeneric() {
  const out = [];
  let counter = 5e3;
  for (const base of GENERIC_LOCALES) {
    for (let i = 0; i < GENERIC_PER_LOCALE; i++) {
      counter += 1;
      const idx = counter * 7 % STREET_NAMES.length;
      const stIdx = counter * 3 % STREET_TYPES.length;
      const ownerOffset = counter % GENERIC_OWNER_POOL;
      const ownerSuffix = (GENERIC_OWNER_BASE2 + ownerOffset).toString().padStart(3, "0");
      const houseNo = 4 + counter * 11 % 200;
      const overdue = counter % 11 === 0;
      const arr = counter % 23 === 0;
      const pens = counter % 17 === 0;
      const valuation = 22e4 + counter * 1337 % 48e4;
      const rates = Math.round(valuation * RATES_RATE_OF_VALUATION);
      const balance = overdue ? Math.round(rates * (0.25 + counter % 4 * 0.25)) : 0;
      const lat = base.lat + (counter % 17 - 8) * 9e-4;
      const lng = base.lng + (counter % 19 - 9) * 11e-4;
      const landUseIndex = counter % LANDUSE_CYCLE.length;
      const landUse = LANDUSE_CYCLE[landUseIndex] ?? // Defensive: the modulus guarantees membership, but
      // `noUncheckedIndexedAccess` requires the fallback.
      "Residential";
      const street = STREET_NAMES[idx] ?? "Acacia";
      const streetType = STREET_TYPES[stIdx] ?? "Street";
      out.push({
        assessmentNumber: `${base.council}-${5e3 + counter}`,
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
        lng
      });
    }
  }
  return out;
}
var PROPERTIES = Object.freeze(
  [...CURATED, ...generateGeneric()].map((p) => ({
    ...p,
    parcel: parcelSquare(p.lat, p.lng)
  }))
);

// src/data/tenements.ts
var TENEMENT_SEEDS = [
  // Tom Price — Pilbara iron
  {
    tenementId: "M70/1284",
    type: "M",
    holder: "Pilbara Iron Holdings Pty Ltd",
    holderAbn: "32 614 882 110",
    commodity: ["Iron Ore"],
    areaHectares: 4820,
    isProducing: true,
    intersects: ["TPS-1102-44"],
    lat: -22.694,
    lng: 117.7935,
    grantedDate: "2014-08-19",
    expiryDate: "2035-08-18",
    lastWorkProgramYear: 2025
  },
  {
    tenementId: "M70/1411",
    type: "M",
    holder: "Pilbara Iron Holdings Pty Ltd",
    holderAbn: "32 614 882 110",
    commodity: ["Iron Ore", "Manganese"],
    areaHectares: 2260,
    isProducing: true,
    intersects: ["TPS-1102-47"],
    lat: -22.6982,
    lng: 117.7892,
    grantedDate: "2017-03-04",
    expiryDate: "2038-03-03",
    lastWorkProgramYear: 2025
  },
  {
    tenementId: "L70/0177",
    type: "L",
    holder: "Pilbara Iron Holdings Pty Ltd",
    holderAbn: "32 614 882 110",
    commodity: ["Infrastructure"],
    areaHectares: 320,
    isProducing: false,
    intersects: ["TPS-1102-91"],
    lat: -22.7102,
    lng: 117.8011,
    grantedDate: "2016-01-30",
    expiryDate: "2037-01-29",
    lastWorkProgramYear: null
  },
  {
    tenementId: "M70/1502",
    type: "M",
    holder: "Pilbara Iron Holdings Pty Ltd",
    holderAbn: "32 614 882 110",
    commodity: ["Iron Ore"],
    areaHectares: 3140,
    isProducing: true,
    intersects: ["ESH-1102-92", "ASH-9911-22"],
    lat: -22.6981,
    lng: 115.6444,
    grantedDate: "2019-04-13",
    expiryDate: "2040-04-12",
    lastWorkProgramYear: 2025
  },
  // Karratha exploration
  {
    tenementId: "E45/5821",
    type: "E",
    holder: "Karratha Exploration Pty Ltd",
    holderAbn: "44 990 221 005",
    commodity: ["Lithium", "Rare Earths"],
    areaHectares: 18400,
    isProducing: false,
    intersects: ["ESH-1102-71"],
    lat: -20.7364,
    lng: 116.8463,
    grantedDate: "2022-11-14",
    expiryDate: "2027-11-13",
    lastWorkProgramYear: 2024
  },
  {
    tenementId: "E45/6011",
    type: "E",
    holder: "Karratha Exploration Pty Ltd",
    holderAbn: "44 990 221 005",
    commodity: ["Lithium"],
    areaHectares: 9200,
    isProducing: false,
    intersects: [],
    lat: -20.7501,
    lng: 116.88,
    grantedDate: "2023-07-20",
    expiryDate: "2028-07-19",
    lastWorkProgramYear: 2025
  },
  // Newman solar
  {
    tenementId: "G69/0044",
    type: "G",
    holder: "Newman Solar Pty Ltd",
    holderAbn: "55 220 901 477",
    commodity: ["Solar Infrastructure"],
    areaHectares: 180,
    isProducing: true,
    intersects: ["ESH-1102-88"],
    lat: -23.3614,
    lng: 119.7349,
    grantedDate: "2024-01-15",
    expiryDate: "2049-01-14",
    lastWorkProgramYear: 2025
  },
  // Sandstone gold
  {
    tenementId: "M52/0908",
    type: "M",
    holder: "Goldfields Resources Ltd",
    holderAbn: "18 552 117 884",
    commodity: ["Gold"],
    areaHectares: 740,
    isProducing: true,
    intersects: ["SST-2204-19"],
    lat: -27.9881,
    lng: 119.2944,
    grantedDate: "2009-06-22",
    expiryDate: "2030-06-21",
    lastWorkProgramYear: 2025
  },
  {
    tenementId: "P52/1701",
    type: "P",
    holder: "Sandstone Prospecting Pty Ltd",
    holderAbn: "82 144 029 561",
    commodity: ["Gold"],
    areaHectares: 90,
    isProducing: false,
    intersects: ["SST-2204-31"],
    lat: -28.0042,
    lng: 119.3122,
    grantedDate: "2023-04-01",
    expiryDate: "2027-03-31",
    lastWorkProgramYear: null
  },
  {
    tenementId: "M52/1112",
    type: "M",
    holder: "Goldfields Resources Ltd",
    holderAbn: "18 552 117 884",
    commodity: ["Gold"],
    areaHectares: 1280,
    isProducing: true,
    intersects: ["SST-2204-58"],
    lat: -27.976,
    lng: 119.2812,
    grantedDate: "2010-09-05",
    expiryDate: "2031-09-04",
    lastWorkProgramYear: 2024
  },
  // Kalgoorlie gold
  {
    tenementId: "M26/0444",
    type: "M",
    holder: "Goldfields Pastoral Pty Ltd",
    holderAbn: "61 005 998 220",
    commodity: ["Gold"],
    areaHectares: 2140,
    isProducing: true,
    intersects: ["KAL-4401-12"],
    lat: -30.7321,
    lng: 121.4855,
    grantedDate: "2012-11-09",
    expiryDate: "2033-11-08",
    lastWorkProgramYear: 2025
  },
  {
    tenementId: "M26/0511",
    type: "M",
    holder: "Goldfields Pastoral Pty Ltd",
    holderAbn: "61 005 998 220",
    commodity: ["Gold", "Silver"],
    areaHectares: 880,
    isProducing: true,
    intersects: ["KAL-4401-45"],
    lat: -30.7892,
    lng: 121.499,
    grantedDate: "2013-05-23",
    expiryDate: "2034-05-22",
    lastWorkProgramYear: 2025
  },
  {
    tenementId: "G26/0119",
    type: "G",
    holder: "Boulder Block Investments Pty Ltd",
    holderAbn: "75 144 882 011",
    commodity: ["Solar Infrastructure"],
    areaHectares: 240,
    isProducing: true,
    intersects: ["KAL-4401-77"],
    lat: -30.7522,
    lng: 121.4555,
    grantedDate: "2023-10-01",
    expiryDate: "2048-09-30",
    lastWorkProgramYear: 2025
  },
  // Meekatharra
  {
    tenementId: "P51/0822",
    type: "P",
    holder: "Murchison Holdings Pty Ltd",
    holderAbn: "12 003 882 770",
    commodity: ["Gold"],
    areaHectares: 75,
    isProducing: false,
    intersects: ["MEK-3303-21"],
    lat: -26.5897,
    lng: 118.4956,
    grantedDate: "2023-08-16",
    expiryDate: "2027-08-15",
    lastWorkProgramYear: null
  },
  {
    tenementId: "M51/0144",
    type: "M",
    holder: "Murchison Holdings Pty Ltd",
    holderAbn: "12 003 882 770",
    commodity: ["Gold"],
    areaHectares: 410,
    isProducing: true,
    intersects: ["MEK-3303-58"],
    lat: -26.571,
    lng: 118.5102,
    grantedDate: "2011-11-23",
    expiryDate: "2032-11-22",
    lastWorkProgramYear: 2025
  },
  // Onslow processing
  {
    tenementId: "M08/0211",
    type: "M",
    holder: "Pilbara Minerals Processing Ltd",
    holderAbn: "44 882 011 559",
    commodity: ["Mineral Sands"],
    areaHectares: 1640,
    isProducing: true,
    intersects: ["ASH-9911-04"],
    lat: -22.6981,
    lng: 115.6444,
    grantedDate: "2015-03-15",
    expiryDate: "2036-03-14",
    lastWorkProgramYear: 2025
  },
  // Broken Hill (NSW lead/zinc/silver)
  {
    tenementId: "ML 1234 (NSW)",
    type: "M",
    holder: "Silver City Pastoral Co",
    holderAbn: "08 880 442 119",
    commodity: ["Lead", "Zinc", "Silver"],
    areaHectares: 1220,
    isProducing: true,
    intersects: ["BRK-5512-44"],
    lat: -31.9722,
    lng: 141.5102,
    grantedDate: "2013-04-23",
    expiryDate: "2034-04-22",
    lastWorkProgramYear: 2025
  },
  // Mount Isa (QLD copper-zinc)
  {
    tenementId: "ML 9214 (QLD)",
    type: "M",
    holder: "Diamantina Pastoral Pty Ltd",
    holderAbn: "29 442 008 117",
    commodity: ["Copper", "Zinc"],
    areaHectares: 1910,
    isProducing: true,
    intersects: ["MTI-6601-08"],
    lat: -20.7256,
    lng: 139.4927,
    grantedDate: "2014-07-31",
    expiryDate: "2035-07-30",
    lastWorkProgramYear: 2025
  },
  // Floating tenements (no rated-land overlap — context demo)
  {
    tenementId: "E70/6101",
    type: "E",
    holder: "Karratha Exploration Pty Ltd",
    holderAbn: "44 990 221 005",
    commodity: ["Rare Earths"],
    areaHectares: 12400,
    isProducing: false,
    intersects: [],
    lat: -22.58,
    lng: 117.62,
    grantedDate: "2023-02-15",
    expiryDate: "2028-02-14",
    lastWorkProgramYear: 2024
  },
  {
    tenementId: "E26/4400",
    type: "E",
    holder: "Goldfields Pastoral Pty Ltd",
    holderAbn: "61 005 998 220",
    commodity: ["Lithium"],
    areaHectares: 14220,
    isProducing: false,
    intersects: [],
    lat: -30.69,
    lng: 121.53,
    grantedDate: "2022-05-05",
    expiryDate: "2027-05-04",
    lastWorkProgramYear: 2024
  }
];
var TENEMENTS = Object.freeze(
  TENEMENT_SEEDS.map((t) => ({
    tenementId: t.tenementId,
    type: t.type,
    status: "Live",
    holder: t.holder,
    holderAbn: t.holderAbn,
    commodity: t.commodity,
    grantedDate: t.grantedDate,
    expiryDate: t.expiryDate,
    areaHectares: t.areaHectares,
    intersectsAssessmentNumbers: t.intersects,
    isProducing: t.isProducing,
    lastWorkProgramYear: t.lastWorkProgramYear,
    polygon: tenementHexagon(t.lat, t.lng, t.areaHectares)
  }))
);

// src/data/transactions.ts
var TRANSACTIONS = Object.freeze({
  "TPS-3041-12": Object.freeze([
    { date: "2025-07-01", type: "Rates Levy", amount: 2140, reference: "LVY-2025-26", balance: 2140 },
    { date: "2025-08-12", type: "Payment", amount: -535, reference: "BPAY-882104", balance: 1605 },
    { date: "2025-11-04", type: "Payment", amount: -535, reference: "BPAY-901188", balance: 1070 },
    { date: "2026-02-04", type: "Payment", amount: -535, reference: "BPAY-918002", balance: 535 },
    { date: "2026-04-30", type: "Penalty Interest", amount: 12.5, reference: "INT-Q4", balance: 547.5 }
  ]),
  "ESH-7011-08": Object.freeze([
    { date: "2025-07-01", type: "Rates Levy", amount: 12400, reference: "LVY-2025-26", balance: 12400 },
    { date: "2025-09-01", type: "Adjustment", amount: -100, reference: "ARR-START", balance: 12300 },
    { date: "2025-10-15", type: "Payment", amount: -3100, reference: "BPAY-893221", balance: 9200 },
    { date: "2026-01-10", type: "Payment", amount: -3050, reference: "BPAY-910445", balance: 6150 },
    { date: "2026-04-10", type: "Payment", amount: -3050, reference: "BPAY-925910", balance: 3100 }
  ]),
  "TPS-1102-44": Object.freeze([
    { date: "2025-07-01", type: "Rates Levy", amount: 1820, reference: "LVY-2025-26", balance: 1820 },
    { date: "2025-09-01", type: "Payment", amount: -455, reference: "BPAY-885012", balance: 1365 },
    { date: "2025-12-01", type: "Payment", amount: -455, reference: "BPAY-905880", balance: 910 },
    { date: "2026-02-28", type: "Payment", amount: -455, reference: "BPAY-919221", balance: 455 },
    { date: "2026-04-01", type: "Payment", amount: -455, reference: "BPAY-925112", balance: 0 }
  ]),
  "ASH-9911-04": Object.freeze([
    { date: "2025-07-01", type: "Rates Levy", amount: 38200, reference: "LVY-2025-26", balance: 38200 },
    { date: "2025-09-15", type: "Payment", amount: -9550, reference: "EFT-COMM-118", balance: 28650 },
    { date: "2025-12-15", type: "Payment", amount: -9550, reference: "EFT-COMM-227", balance: 19100 },
    { date: "2026-03-15", type: "Payment", amount: -9550, reference: "EFT-COMM-309", balance: 9550 }
  ]),
  "MTI-6601-33": Object.freeze([
    { date: "2025-07-01", type: "Rates Levy", amount: 8200, reference: "LVY-2025-26", balance: 8200 },
    { date: "2025-09-01", type: "Payment", amount: -2050, reference: "BPAY-771101", balance: 6150 },
    { date: "2025-11-15", type: "Payment", amount: -2050, reference: "BPAY-790222", balance: 4100 },
    { date: "2026-02-15", type: "Payment", amount: -2050, reference: "BPAY-810115", balance: 2050 },
    { date: "2026-04-15", type: "Penalty Interest", amount: 41, reference: "INT-Q4", balance: 2091 }
  ])
});

// src/data/index.ts
var DataStore = class {
  /** Defensive copy of the property seed, mutable internally only. */
  properties;
  /** Defensive copy of the owner seed, mutable internally only. */
  owners;
  /**
   * Construct a store from the seeded data. Each instance is independent,
   * so tests can construct fresh stores without leakage. Production wiring
   * uses a single process-wide instance.
   */
  constructor() {
    this.properties = [...PROPERTIES];
    this.owners = [...OWNERS];
  }
  /** All councils (tenants) advertised by this adapter. */
  listCouncils() {
    return COUNCILS;
  }
  /** Look up a council by code. Returns `undefined` when unknown. */
  getCouncil(code) {
    return COUNCILS.find((c) => c.code === code);
  }
  /** All properties across all tenants. Optionally filtered by council code. */
  listProperties(councilCode2) {
    if (councilCode2 === void 0) return this.properties;
    return this.properties.filter((p) => p.council === councilCode2);
  }
  /** Snapshot copy of the property list — used to seed the EvaluationContext. */
  snapshotProperties() {
    return [...this.properties];
  }
  /** Get one property by assessment number. */
  getProperty(assessmentNumber2) {
    return this.properties.find(
      (p) => p.assessmentNumber === assessmentNumber2
    );
  }
  /**
   * Free-text search across address, suburb, postcode and assessment number.
   * Case-insensitive substring match. Empty queries are caller-responsibility
   * (the schema validates non-empty input upstream).
   */
  searchProperties(query) {
    const q = query.toLowerCase();
    return this.properties.filter(
      (p) => p.assessmentNumber.toLowerCase().includes(q) || p.address.toLowerCase().includes(q) || p.suburb.toLowerCase().includes(q) || p.postcode.includes(q)
    );
  }
  /**
   * Search by owner name (partial, case-insensitive), optionally restricted
   * to a single suburb (exact match, case-insensitive).
   */
  searchByOwner(name, suburb) {
    const q = name.toLowerCase();
    const matchedIds = new Set(
      this.owners.filter((o) => o.name.toLowerCase().includes(q)).map((o) => o.ownerId)
    );
    if (matchedIds.size === 0) return [];
    return this.properties.filter((p) => {
      if (!p.ownerIds.some((id) => matchedIds.has(id))) return false;
      if (suburb === void 0) return true;
      return p.suburb.toLowerCase() === suburb.toLowerCase();
    });
  }
  /** All overdue properties (positive outstanding balance). */
  listOverdue(councilCode2) {
    return this.listProperties(councilCode2).filter((p) => p.balance > 0);
  }
  /** All owners. */
  listOwners() {
    return this.owners;
  }
  /** Snapshot owners as a Map keyed by ownerId for the recovery EvaluationContext. */
  snapshotOwnersById() {
    return new Map(this.owners.map((o) => [o.ownerId, o]));
  }
  /** Get one owner by ID. */
  getOwner(ownerId) {
    return this.owners.find((o) => o.ownerId === ownerId);
  }
  /** Resolve all owners listed on a property. Order matches `property.ownerIds`. */
  ownersForProperty(p) {
    return p.ownerIds.map((id) => this.owners.find((o) => o.ownerId === id)).filter((o) => o !== void 0);
  }
  /** Transactions for one property. Empty array when none on file. */
  getTransactions(assessmentNumber2) {
    return TRANSACTIONS[assessmentNumber2] ?? [];
  }
  /** All live tenements that intersect the given assessment. */
  tenementsForAssessment(assessmentNumber2) {
    return TENEMENTS.filter(
      (t) => t.status === "Live" && t.intersectsAssessmentNumbers.includes(assessmentNumber2)
    );
  }
  /**
   * Snapshot tenements indexed by assessment number for the recovery
   * EvaluationContext. Includes only `Live` tenements (matches the
   * recovery engine's per-property branches).
   */
  snapshotTenementsByAssessment() {
    const out = /* @__PURE__ */ new Map();
    for (const t of TENEMENTS) {
      if (t.status !== "Live") continue;
      for (const an of t.intersectsAssessmentNumbers) {
        const list = out.get(an);
        if (list === void 0) {
          out.set(an, [t]);
        } else {
          list.push(t);
        }
      }
    }
    return new Map([...out.entries()].map(([k, v]) => [k, [...v]]));
  }
  /**
   * Replace an owner record with a new immutable record. Returns the new
   * record. No-op if the ownerId is not found.
   */
  replaceOwner(updated) {
    const idx = this.owners.findIndex((o) => o.ownerId === updated.ownerId);
    if (idx === -1) return void 0;
    const next = [...this.owners];
    next[idx] = updated;
    this.owners = next;
    return updated;
  }
  /**
   * Append a note to a property's `notes` array, returning the new property
   * record. No-op if the assessment is not found.
   */
  addNoteToProperty(assessmentNumber2, note) {
    const idx = this.properties.findIndex(
      (p) => p.assessmentNumber === assessmentNumber2
    );
    if (idx === -1) return void 0;
    const existing = this.properties[idx];
    if (existing === void 0) return void 0;
    const updated = {
      ...existing,
      notes: [...existing.notes, note]
    };
    const next = [...this.properties];
    next[idx] = updated;
    this.properties = next;
    return updated;
  }
};

// src/identity.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
function readManifest() {
  const manifestUrl = new URL("../package.json", import.meta.url);
  const raw = readFileSync(fileURLToPath(manifestUrl), "utf-8");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new Error("adapter-demo: package.json is missing name/version");
  }
  const cast = parsed;
  return { name: cast.name, version: cast.version };
}
var MANIFEST = readManifest();
var ADAPTER_IDENTITY = Object.freeze({
  id: "ratesassist-demo",
  name: "RatesAssist Demo Adapter",
  vendor: "RatesAssist",
  version: MANIFEST.version,
  contractVersion: CONTRACT_VERSION,
  capabilities: Object.freeze([
    "read.property",
    "read.owner",
    "read.transactions",
    "read.list_overdue",
    "write.update_owner_contact",
    "write.add_property_note",
    "generate.statutory_certificate"
  ])
});
var SERVER_DISPLAY_NAME = MANIFEST.name;

// src/runtime/commitTokens.ts
import { randomUUID } from "node:crypto";
var COMMIT_TOKEN_TTL_MS = 5 * 60 * 1e3;
var CommitTokenStore = class {
  entries;
  nowMs;
  ttlMs;
  /**
   * Construct a store. Inject `nowMs` for deterministic tests; defaults to
   * `Date.now`. `ttlMs` defaults to {@link COMMIT_TOKEN_TTL_MS}.
   */
  constructor(nowMs = () => Date.now(), ttlMs = COMMIT_TOKEN_TTL_MS) {
    this.entries = /* @__PURE__ */ new Map();
    this.nowMs = nowMs;
    this.ttlMs = ttlMs;
  }
  /**
   * Issue a new token for the given mutation. Returns the token string.
   * The mutation snapshot is captured by reference; callers must not mutate
   * the object after issuing.
   */
  issue(mutation) {
    this.gc();
    const token = randomUUID();
    this.entries.set(token, {
      token,
      mutation,
      expiresAtMs: this.nowMs() + this.ttlMs
    });
    return token;
  }
  /**
   * Consume a token. Returns the captured mutation if the token is valid
   * and matches the expected operation; otherwise returns a discriminated
   * failure describing why.
   *
   * On success, the token is removed from the store — single-use semantics.
   */
  consume(token, expectedOperation) {
    this.gc();
    const entry = this.entries.get(token);
    if (entry === void 0) {
      return { ok: false, reason: "unknown" };
    }
    if (entry.expiresAtMs <= this.nowMs()) {
      this.entries.delete(token);
      return { ok: false, reason: "expired" };
    }
    if (entry.mutation.operation !== expectedOperation) {
      return { ok: false, reason: "operation_mismatch" };
    }
    this.entries.delete(token);
    return { ok: true, mutation: entry.mutation };
  }
  /** Test helper: clear all tokens. */
  __resetForTests() {
    this.entries.clear();
  }
  /** Garbage-collect expired tokens. Cheap; called on every operation. */
  gc() {
    const now = this.nowMs();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAtMs <= now) this.entries.delete(token);
    }
  }
};

// src/runtime/context.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// ../identity/src/abn.ts
import { z as z2 } from "zod";
var DEFAULT_ABN_LOOKUP_BASE = "https://abr.business.gov.au/json";
var DEFAULT_TIMEOUT_MS = 5e3;
var MAX_RETRIES = 1;
var RETRY_BACKOFF_MS = 1500;
var RETRIABLE_STATUS_CODES = /* @__PURE__ */ new Set([429, 503, 504]);
var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var ABR_STATUS_NOT_FOUND = "0000000003";
var MOCK_ENTRIES = Object.freeze({
  "32614882110": {
    ok: true,
    abn: "32 614 882 110",
    entityName: "Pilbara Iron Holdings Pty Ltd",
    entityType: "Australian Private Company",
    status: "Active",
    gstRegistered: true,
    gstRegisteredFrom: "2014-08-19",
    address: "Level 12, 100 St Georges Terrace, Perth WA 6000"
  },
  "44990221005": {
    ok: true,
    abn: "44 990 221 005",
    entityName: "Karratha Exploration Pty Ltd",
    entityType: "Australian Private Company",
    status: "Active",
    gstRegistered: true,
    gstRegisteredFrom: "2022-11-14",
    address: "PO Box 5511, Karratha WA 6714"
  },
  "18552117884": {
    ok: true,
    abn: "18 552 117 884",
    entityName: "Goldfields Resources Ltd",
    entityType: "Australian Public Company",
    status: "Active",
    gstRegistered: true,
    gstRegisteredFrom: "2009-06-22",
    address: "Level 5, 50 Kings Park Road, West Perth WA 6005"
  }
});
var AbnSchema = z2.string().regex(/^\d{11}$/, "ABN must be 11 digits");
var AbrResponseSchema = z2.object({
  Abn: z2.string().optional(),
  AbnStatus: z2.string().optional(),
  EntityName: z2.string().optional(),
  EntityTypeName: z2.string().optional(),
  Gst: z2.string().optional(),
  GstFromDate: z2.string().optional(),
  AddressState: z2.string().optional(),
  AddressPostcode: z2.string().optional()
}).passthrough();
var _cache = /* @__PURE__ */ new Map();
function normaliseAbn(abn2) {
  return abn2.replace(/\s+/g, "").replace(/-/g, "");
}
function formatAbn(clean) {
  return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4");
}
function mapStatus(raw) {
  if (raw === void 0) return "Unknown";
  if (raw === "Active") return "Active";
  if (raw === "Cancelled") return "Cancelled";
  if (raw === "Suspended") return "Suspended";
  return "Unknown";
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      if (signal !== void 0) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    if (signal !== void 0) signal.addEventListener("abort", onAbort, { once: true });
  });
}
function failure(code, error, correlationId) {
  return correlationId === void 0 ? { ok: false, code, error } : { ok: false, code, error, correlationId };
}
function createAbnClient(config = {}) {
  const baseUrl = config.baseUrl ?? DEFAULT_ABN_LOOKUP_BASE;
  const guid = config.guid ?? "";
  const strict = config.strict ?? false;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetcher = config.fetcher ?? fetch;
  async function attemptLive(clean, signal, correlationId) {
    const url = `${baseUrl}/AbnDetails.aspx?abn=${clean}&guid=${encodeURIComponent(guid)}`;
    const ctrl = new AbortController();
    const onCallerAbort = () => ctrl.abort();
    if (signal !== void 0) {
      if (signal.aborted) {
        return { kind: "fail", result: failure("timeout", "aborted by caller", correlationId) };
      }
      signal.addEventListener("abort", onCallerAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetcher(url, { signal: ctrl.signal });
      if (RETRIABLE_STATUS_CODES.has(res.status)) {
        return { kind: "retry", status: res.status, message: `HTTP ${res.status}` };
      }
      if (!res.ok) {
        return { kind: "fail", result: failure("upstream_error", `HTTP ${res.status}`, correlationId) };
      }
      const text = await res.text();
      const stripped = text.replace(/^callback\(/, "").replace(/\);?\s*$/, "");
      let parsed;
      try {
        parsed = JSON.parse(stripped);
      } catch {
        return { kind: "fail", result: failure("upstream_error", "invalid JSON from ABR", correlationId) };
      }
      const validated = AbrResponseSchema.safeParse(parsed);
      if (!validated.success) {
        return { kind: "fail", result: failure("upstream_error", "unexpected ABR shape", correlationId) };
      }
      const json = validated.data;
      if (json.AbnStatus === ABR_STATUS_NOT_FOUND) {
        return { kind: "fail", result: failure("not_found", "ABN not found", correlationId) };
      }
      const formatted = formatAbn(clean);
      const value = {
        ok: true,
        source: "ato",
        abn: formatted,
        entityName: json.EntityName ?? "Unknown",
        ...json.EntityTypeName !== void 0 ? { entityType: json.EntityTypeName } : {},
        status: mapStatus(json.AbnStatus),
        gstRegistered: typeof json.Gst === "string" && json.Gst.length > 0,
        ...json.GstFromDate !== void 0 ? { gstRegisteredFrom: json.GstFromDate } : {},
        ...json.AddressPostcode !== void 0 ? { address: `${json.AddressState ?? ""} ${json.AddressPostcode}`.trim() } : {}
      };
      _cache.set(clean, { ts: Date.now(), value });
      return { kind: "ok", value };
    } catch (e) {
      const wasAbort = e instanceof Error && (e.name === "AbortError" || ctrl.signal.aborted);
      if (wasAbort && signal?.aborted === true) {
        return { kind: "fail", result: failure("timeout", "aborted by caller", correlationId) };
      }
      const message = e instanceof Error ? e.message : "fetch failed";
      return {
        kind: "fail",
        result: failure(wasAbort ? "timeout" : "upstream_error", message, correlationId)
      };
    } finally {
      clearTimeout(timer);
      if (signal !== void 0) signal.removeEventListener("abort", onCallerAbort);
    }
  }
  async function lookupAbn(abn2, opts = {}) {
    const { signal, correlationId } = opts;
    const clean = normaliseAbn(abn2);
    const validated = AbnSchema.safeParse(clean);
    if (!validated.success) {
      return failure(
        "invalid_input",
        validated.error.issues[0]?.message ?? "invalid ABN",
        correlationId
      );
    }
    const cached = _cache.get(clean);
    if (cached !== void 0 && Date.now() - cached.ts < CACHE_TTL_MS) {
      return { ...cached.value, source: "cache" };
    }
    if (guid.length > 0) {
      let lastFailure = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const outcome = await attemptLive(clean, signal, correlationId);
        if (outcome.kind === "ok") return outcome.value;
        if (outcome.kind === "fail") return outcome.result;
        lastFailure = failure("upstream_error", outcome.message, correlationId);
        if (attempt < MAX_RETRIES) {
          try {
            await sleep(RETRY_BACKOFF_MS, signal);
          } catch {
            return failure("timeout", "aborted by caller", correlationId);
          }
        }
      }
      return lastFailure ?? failure("upstream_error", "ABR retries exhausted", correlationId);
    }
    if (strict) {
      return failure(
        "unconfigured",
        "ABN_LOOKUP_GUID not configured and strict mode is enabled",
        correlationId
      );
    }
    const mock = MOCK_ENTRIES[clean];
    if (mock !== void 0) {
      return { ...mock, source: "mock" };
    }
    return {
      ok: true,
      source: "mock",
      abn: formatAbn(clean),
      entityName: "Unknown entity (no GUID configured for live lookup)",
      status: "Unknown",
      gstRegistered: false
    };
  }
  return {
    lookupAbn,
    __resetCacheForTests: () => _cache.clear()
  };
}
var KNOWN_MOCK_ABNS = Object.freeze(Object.keys(MOCK_ENTRIES));

// src/runtime/context.ts
var DEMO_TENANT_ID = "demo-tenant";
var DEMO_USER_ID = "demo-user";
var DEMO_USER_ROLE = "officer";
function createRequestContext(args) {
  const evaluationContext = {
    properties: args.store.snapshotProperties(),
    ownersById: args.store.snapshotOwnersById(),
    tenementsByAssessment: args.store.snapshotTenementsByAssessment()
  };
  return {
    tenantId: args.tenantId ?? DEMO_TENANT_ID,
    userId: args.userId ?? DEMO_USER_ID,
    userRole: args.userRole ?? DEMO_USER_ROLE,
    correlationId: args.correlationId ?? randomUUID2(),
    now: args.now ?? (() => /* @__PURE__ */ new Date()),
    evaluationContext,
    abnClient: args.abnClient,
    store: args.store,
    commitTokens: args.commitTokens
  };
}
function createDefaultAbnClient() {
  return createAbnClient({ strict: false });
}

// src/handlers/format.ts
var AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0
});
function aud(amount) {
  return AUD.format(Math.round(amount));
}
function intAu(n) {
  return Math.round(n).toLocaleString("en-AU");
}
function isoDate(d) {
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// src/handlers/search.ts
var MAX_RESULT_LINES = 25;
function lineForProperty(p) {
  return `${p.assessmentNumber} \u2014 ${p.address}, ${p.suburb} ${p.postcode} | ${p.landUse} | balance ${aud(p.balance)}`;
}
async function searchPropertyHandler(input, ctx) {
  const matches = ctx.store.searchProperties(input.query);
  if (matches.length === 0) {
    return {
      ok: true,
      output: `No properties found matching "${input.query}".`,
      data: { matches: [] },
      mutated: false
    };
  }
  const shown = matches.slice(0, MAX_RESULT_LINES);
  const overflow = matches.length - shown.length;
  const lines = shown.map(lineForProperty).join("\n");
  const trailer = overflow > 0 ? `
... and ${overflow} more (truncated)` : "";
  return {
    ok: true,
    output: `Found ${matches.length} match(es) for "${input.query}":
${lines}${trailer}`,
    data: { matches: [...matches] },
    mutated: false
  };
}
async function searchByOwnerHandler(input, ctx) {
  const matches = ctx.store.searchByOwner(input.name, input.suburb);
  if (matches.length === 0) {
    return {
      ok: true,
      output: `No properties found for owner matching "${input.name}".`,
      data: { matches: [] },
      mutated: false
    };
  }
  const shown = matches.slice(0, MAX_RESULT_LINES);
  const overflow = matches.length - shown.length;
  const lines = shown.map((p) => {
    const owners = ctx.store.ownersForProperty(p).map((o) => o.name).join(", ");
    return `${p.assessmentNumber} \u2014 ${p.address}, ${p.suburb} | owner: ${owners} | balance ${aud(p.balance)}`;
  }).join("\n");
  const trailer = overflow > 0 ? `
... and ${overflow} more (truncated)` : "";
  return {
    ok: true,
    output: `Found ${matches.length} property(ies) for owner "${input.name}":
${lines}${trailer}`,
    data: { matches: [...matches] },
    mutated: false
  };
}

// src/runtime/errors.ts
function failure2(code, error, correlationId, retryable = false) {
  return {
    ok: false,
    code,
    error,
    correlationId,
    retryable
  };
}
function notFound(what, correlationId) {
  return failure2("not_found", what, correlationId);
}
function invalidInput(message, correlationId) {
  return failure2("invalid_input", message, correlationId);
}
function forbidden(message, correlationId) {
  return failure2("forbidden", message, correlationId);
}
function conflict(message, correlationId) {
  return failure2("conflict", message, correlationId);
}

// src/handlers/property.ts
var DEFAULT_LIST_LIMIT = 50;
var MAX_LIST_LIMIT = 1e3;
async function getPropertyDetailHandler(input, ctx) {
  const property = ctx.store.getProperty(input.assessmentNumber);
  if (property === void 0) {
    return notFound(
      `No property with assessment number "${input.assessmentNumber}".`,
      ctx.correlationId
    );
  }
  const owners = ctx.store.ownersForProperty(property);
  const tenements = ctx.store.tenementsForAssessment(property.assessmentNumber);
  const ownerLines = owners.length > 0 ? owners.map(
    (o) => `  - ${o.name} | ${o.phone ?? "no phone"} | ${o.email ?? "no email"} | postal: ${o.postalAddress} | since ${o.ownerSince}`
  ).join("\n") : "  (no owner records resolved)";
  const tenementLines = tenements.length > 0 ? tenements.map(
    (t) => `  - ${t.tenementId} | ${t.type}-class ${t.status} | ${t.commodity.join(", ")} | holder: ${t.holder}${t.isProducing ? " | producing" : ""}`
  ).join("\n") : "  (no intersecting tenements on file)";
  const lastPaymentSegment = property.lastPaymentDate !== null ? `${property.lastPaymentDate}${property.lastPaymentAmount !== null ? ` (${aud(property.lastPaymentAmount)} via ${property.paymentMethod ?? "unknown method"})` : ""}` : "none";
  const text = [
    `Assessment ${property.assessmentNumber}`,
    `Address: ${property.address}, ${property.suburb} ${property.postcode} ${property.state}`,
    `Land use: ${property.landUse}`,
    `Valuation: ${aud(property.valuation)}`,
    `Annual rates: ${aud(property.annualRates)}`,
    `Outstanding balance: ${aud(property.balance)}`,
    `Last payment: ${lastPaymentSegment}`,
    `Pensioner rebate: ${property.pensionerRebate ? "yes" : "no"}`,
    `Payment arrangement: ${property.paymentArrangement ? "yes" : "no"}`,
    ``,
    `Owner(s):`,
    ownerLines,
    ``,
    `Intersecting mining tenements:`,
    tenementLines,
    ``,
    `Notes:`,
    property.notes.length > 0 ? property.notes.map((n) => `  - ${n}`).join("\n") : "  (none)"
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { property, owners: [...owners], tenements: [...tenements] },
    mutated: false
  };
}
async function getTransactionHistoryHandler(input, ctx) {
  const property = ctx.store.getProperty(input.assessmentNumber);
  if (property === void 0) {
    return notFound(
      `No property with assessment number "${input.assessmentNumber}".`,
      ctx.correlationId
    );
  }
  const txs = ctx.store.getTransactions(input.assessmentNumber);
  if (txs.length === 0) {
    return {
      ok: true,
      output: `No transactions on file for ${input.assessmentNumber}.`,
      data: { assessmentNumber: input.assessmentNumber, transactions: [] },
      mutated: false
    };
  }
  const lines = txs.map(
    (t) => `${t.date} | ${t.type.padEnd(18)} | ${aud(t.amount).padStart(12)} | ${t.reference} | bal ${aud(t.balance)}`
  ).join("\n");
  return {
    ok: true,
    output: `Transactions for ${input.assessmentNumber}:
${lines}`,
    data: { assessmentNumber: input.assessmentNumber, transactions: [...txs] },
    mutated: false
  };
}
async function listPropertiesHandler(input, ctx) {
  const all = ctx.store.listProperties(input.council);
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const offset = input.offset ?? 0;
  const page = all.slice(offset, offset + limit);
  if (page.length === 0) {
    const where = input.council ? ` for council "${input.council}"` : "";
    return {
      ok: true,
      output: `No properties found${where} at offset ${offset}.`,
      data: { total: all.length, offset, limit, properties: [] },
      mutated: false
    };
  }
  const text = [
    `Page of ${page.length} of ${all.length} properties${input.council ? ` for ${input.council}` : ""} (offset ${offset}, limit ${limit}):`,
    ...page.map(
      (p) => `  - ${p.assessmentNumber} | ${p.address}, ${p.suburb} | ${p.landUse} | balance ${aud(p.balance)}`
    )
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { total: all.length, offset, limit, properties: [...page] },
    mutated: false
  };
}

// src/handlers/owner.ts
async function getOwnerHandler(input, ctx) {
  const owner = ctx.store.getOwner(input.ownerId);
  if (owner === void 0) {
    return notFound(
      `No owner with id "${input.ownerId}".`,
      ctx.correlationId
    );
  }
  const previous = owner.previousOwners.length > 0 ? owner.previousOwners.map((p) => `  - ${p.name} (${p.period})`).join("\n") : "  (none on file)";
  const text = [
    `Owner ${owner.ownerId}: ${owner.name}`,
    `ABN: ${owner.abn ?? "not on record"}${owner.abnStatus ? ` (status: ${owner.abnStatus})` : ""}`,
    `Postal address: ${owner.postalAddress}`,
    `Phone: ${owner.phone ?? "not on record"}`,
    `Email: ${owner.email ?? "not on record"}`,
    `Owner since: ${owner.ownerSince}`,
    ``,
    `Previous owners:`,
    previous
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { owner },
    mutated: false
  };
}

// src/handlers/overdue.ts
function daysSinceLastPayment(p, now) {
  if (p.lastPaymentDate === null) return Infinity;
  const last = Date.parse(p.lastPaymentDate);
  if (Number.isNaN(last)) return Infinity;
  return Math.floor((now.getTime() - last) / (24 * 60 * 60 * 1e3));
}
async function listOverdueHandler(input, ctx) {
  const all = ctx.store.listOverdue(input.council);
  const now = ctx.now();
  const min = input.minDaysOverdue ?? 0;
  const filtered = min > 0 ? all.filter((p) => daysSinceLastPayment(p, now) >= min) : all;
  if (filtered.length === 0) {
    return {
      ok: true,
      output: input.council !== void 0 ? `No overdue properties for council "${input.council}".` : `No overdue properties at this time.`,
      data: { total: 0, totalOutstanding: 0, properties: [] },
      mutated: false
    };
  }
  const totalOutstanding = filtered.reduce((s, p) => s + p.balance, 0);
  const lines = filtered.map((p) => {
    const ownerNames = ctx.store.ownersForProperty(p).map((o) => o.name).join(", ");
    const arrSuffix = p.paymentArrangement ? " (arrangement)" : "";
    return `  - ${p.assessmentNumber} | ${p.address}, ${p.suburb} | ${ownerNames || "(no owner on file)"} | ${aud(p.balance)}${arrSuffix}`;
  }).join("\n");
  const text = [
    `${filtered.length} overdue propert${filtered.length === 1 ? "y" : "ies"}; total outstanding ${aud(totalOutstanding)}.`,
    lines
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: {
      total: filtered.length,
      totalOutstanding,
      properties: [...filtered]
    },
    mutated: false
  };
}

// ../recovery-engine/src/signals.ts
var SIGNAL_CATALOGUE = [
  // ---- REGISTER signals (authoritative state/federal mining + cadastral data) ----
  {
    id: "reg.tenement.producing.on_rural_or_vacant",
    name: "Producing tenement on rural/vacant rate",
    short: "Producing tenement",
    category: "register",
    weight: 0.55,
    exclusiveGroup: "tenement-class",
    description: "Property currently rated rural or vacant, but a producing mining lease intersects the parcel. Strongest single-source recovery signal.",
    source: "DMIRS MINEDEX (WA) / state mining registers"
  },
  {
    id: "reg.tenement.live_lease.on_rural_or_vacant",
    name: "Live mining lease on rural/vacant rate",
    short: "Live lease",
    category: "register",
    weight: 0.45,
    exclusiveGroup: "tenement-class",
    description: "Live mining lease (M-class) intersects parcel; production status unconfirmed but lease is granted, statutory basis for reclassification still applies.",
    source: "DMIRS MINEDEX"
  },
  {
    id: "reg.gpl.producing.on_vacant",
    name: "Producing general-purpose lease on vacant rate",
    short: "Producing GPL",
    category: "register",
    weight: 0.55,
    exclusiveGroup: "tenement-class",
    description: "Property listed as vacant but a producing general-purpose lease (typically solar farms or mining infrastructure) intersects the parcel.",
    source: "DMIRS MINEDEX"
  },
  {
    id: "reg.tenement.exploration_only.on_rural",
    name: "Exploration tenement only \u2014 review",
    short: "Exploration only",
    category: "register",
    weight: 0.2,
    exclusiveGroup: "tenement-class",
    description: "Only exploration / prospecting tenements intersect parcel. Reclassification depends on actual ground disturbance \u2014 flagged for officer review with aerial-imagery cross-check before action.",
    source: "DMIRS MINEDEX"
  },
  // ---- IDENTITY signals (ABN / ASIC) ----
  {
    id: "id.abn.cancelled_or_suspended",
    name: "Owner ABN cancelled or suspended",
    short: "ABN cancelled",
    category: "identity",
    weight: 0.3,
    description: "The corporate entity registered as ratepayer is no longer an active ABN. Rates correspondence may be uncollectable; ownership often shifted without title transfer being registered.",
    source: "ATO ABN Lookup"
  },
  {
    id: "id.holder_ne_owner",
    name: "Tenement holder differs from rated owner",
    short: "Holder \u2260 owner",
    category: "identity",
    weight: 0.3,
    description: "DMIRS-registered tenement holder is not the property's rated owner. Common after tenement transfer when council records were not updated.",
    source: "DMIRS + council rating record"
  },
  {
    id: "id.industry_indicator_in_owner_name",
    name: "Industry indicator in owner name vs rural rate",
    short: "Industry name",
    category: "corporate",
    weight: 0.2,
    description: "Registered owner name contains a mining-, resources- or industry-specific term (e.g. 'Iron', 'Resources', 'Mining', 'Solar') yet the parcel is rated rural / vacant. Soft signal; compounds with tenement coverage.",
    source: "ASIC company register + ABN Lookup"
  },
  // ---- BEHAVIOURAL / PORTFOLIO signals ----
  {
    id: "beh.owner_portfolio_tenement_majority",
    name: "Owner portfolio is mining-dominant",
    short: "Mining portfolio",
    category: "behavioural",
    weight: 0.2,
    description: "Owner holds \u22653 properties in the council portfolio AND \u226550% of those have tenement coverage. Suggests mining-business ratepayer; outliers in their portfolio rated rural deserve review.",
    source: "Internal portfolio analysis"
  },
  // ---- SPATIAL signals ----
  {
    id: "spat.outlier.high_value_rural",
    name: "High-value rural \u2014 outlier in suburb",
    short: "High-value rural",
    category: "spatial",
    weight: 0.15,
    description: "Property rated rural but valuation is in the top 10% of rural-rated parcels in the suburb. Often indicates undeclared improvements or commercial use.",
    source: "Internal spatial-pattern analysis"
  },
  // ---- AERIAL signals (Nearmap / Geoscape change detection) ----
  {
    id: "aerial.change_detected_recent",
    name: "Recent aerial change detected",
    short: "Aerial change",
    category: "aerial",
    weight: 0.3,
    description: "Nearmap AI change-detection feed flagged a structural or land-use change since last rates classification review (new structures, clearing, solar arrays, vehicle/equipment activity).",
    source: "Nearmap AI change feed"
  }
];
function getSignal(id) {
  return SIGNAL_CATALOGUE.find((s) => s.id === id);
}
var SEVERITY_BANDS = {
  high: 0.6,
  medium: 0.35,
  low: 0.15
};
var UPLIFT_MULTIPLIER = {
  high: 8,
  medium: 4,
  low: 1.5
};

// ../recovery-engine/src/scoring.ts
function hit(sig, evidence) {
  return {
    id: sig.id,
    name: sig.name,
    short: sig.short,
    category: sig.category,
    weight: sig.weight,
    source: sig.source,
    evidence
  };
}
var INDUSTRY_TERMS = [
  "iron",
  "mining",
  "resources",
  "minerals",
  "metals",
  "gold",
  "lithium",
  "copper",
  "zinc",
  "nickel",
  "rare earth",
  "exploration",
  "prospecting",
  "pastoral",
  "solar",
  "energy",
  "infrastructure"
];
function containsIndustryTerm(name) {
  const lower = name.toLowerCase();
  for (const term of INDUSTRY_TERMS) {
    if (lower.includes(term)) return term;
  }
  return null;
}
function ownerOf(p, ctx) {
  const ownerId = p.ownerIds[0];
  return ownerId ? ctx.ownersById.get(ownerId) : void 0;
}
function ownerPortfolio(ownerId, ctx) {
  const props = ctx.properties.filter((p) => p.ownerIds.includes(ownerId));
  const withTen = props.filter(
    (p) => (ctx.tenementsByAssessment.get(p.assessmentNumber) ?? []).length > 0
  );
  return {
    total: props.length,
    withTenements: withTen.length,
    pct: props.length > 0 ? withTen.length / props.length : 0
  };
}
function suburbRuralValuationPercentile(p, ctx) {
  const peers = ctx.properties.filter(
    (q) => q.suburb === p.suburb && q.landUse === "Rural" && q.assessmentNumber !== p.assessmentNumber
  );
  if (peers.length < 2) return 0.5;
  const lower = peers.filter((q) => q.valuation < p.valuation).length;
  return lower / peers.length;
}
function evaluateSignals(p, ctx) {
  const hits = [];
  const tenements = ctx.tenementsByAssessment.get(p.assessmentNumber) ?? [];
  const owner = ownerOf(p, ctx);
  if (tenements.length > 0 && (p.landUse === "Rural" || p.landUse === "Vacant")) {
    const live = tenements.filter((t) => t.status === "Live");
    const producing = live.filter((t) => t.isProducing);
    const gpls = live.filter((t) => t.type === "G");
    const miningLeases = live.filter((t) => t.type === "M");
    const explorationOnly = live.length > 0 && live.every((t) => t.type === "E" || t.type === "P");
    if (producing.some((t) => t.type === "M")) {
      const sig = getSignal("reg.tenement.producing.on_rural_or_vacant");
      hits.push(
        hit(
          sig,
          `${producing.length} producing mining lease(s) intersect this parcel: ${producing.map((t) => t.tenementId).join(", ")}.`
        )
      );
    } else if (gpls.some((t) => t.isProducing) && p.landUse === "Vacant") {
      const sig = getSignal("reg.gpl.producing.on_vacant");
      const gpl = gpls.find((t) => t.isProducing);
      hits.push(
        hit(
          sig,
          `Producing general-purpose lease ${gpl.tenementId} (${gpl.commodity.join(", ")}) on parcel listed as vacant.`
        )
      );
    } else if (miningLeases.length > 0) {
      const sig = getSignal("reg.tenement.live_lease.on_rural_or_vacant");
      hits.push(
        hit(
          sig,
          `Live mining lease(s) intersect this parcel: ${miningLeases.map((t) => t.tenementId).join(", ")}.`
        )
      );
    } else if (explorationOnly) {
      const sig = getSignal("reg.tenement.exploration_only.on_rural");
      hits.push(
        hit(
          sig,
          `Only exploration / prospecting tenement(s) intersect this parcel: ${live.map((t) => t.tenementId).join(", ")}.`
        )
      );
    }
  }
  if (owner?.abnStatus && owner.abnStatus !== "Active") {
    const sig = getSignal("id.abn.cancelled_or_suspended");
    hits.push(
      hit(
        sig,
        `Owner ${owner.name} (ABN ${owner.abn ?? "?"}) ABN status: ${owner.abnStatus}.`
      )
    );
  }
  if (owner && tenements.length > 0) {
    const ownerNameLower = owner.name.toLowerCase();
    const mismatch = tenements.find(
      (t) => t.status === "Live" && !t.holder.toLowerCase().includes(ownerNameLower) && !ownerNameLower.includes(t.holder.toLowerCase())
    );
    if (mismatch) {
      const sig = getSignal("id.holder_ne_owner");
      hits.push(
        hit(
          sig,
          `Tenement ${mismatch.tenementId} holder "${mismatch.holder}" differs from rated owner "${owner.name}".`
        )
      );
    }
  }
  if (owner && (p.landUse === "Rural" || p.landUse === "Vacant")) {
    const term = containsIndustryTerm(owner.name);
    if (term) {
      const sig = getSignal("id.industry_indicator_in_owner_name");
      hits.push(
        hit(
          sig,
          `Owner name "${owner.name}" contains industry term "${term}" but property rated ${p.landUse}.`
        )
      );
    }
  }
  if (owner) {
    const pf = ownerPortfolio(owner.ownerId, ctx);
    if (pf.total >= 3 && pf.pct >= 0.5) {
      const sig = getSignal("beh.owner_portfolio_tenement_majority");
      hits.push(
        hit(
          sig,
          `Owner ${owner.name} holds ${pf.total} properties; ${pf.withTenements} (${(pf.pct * 100).toFixed(0)}%) intersect tenements \u2014 mining-dominant portfolio.`
        )
      );
    }
  }
  if (p.landUse === "Rural") {
    const pct2 = suburbRuralValuationPercentile(p, ctx);
    if (pct2 >= 0.85) {
      const sig = getSignal("spat.outlier.high_value_rural");
      hits.push(
        hit(
          sig,
          `Valuation $${p.valuation.toLocaleString()} sits in the top ${((1 - pct2) * 100).toFixed(0)}% of rural-rated parcels in ${p.suburb} \u2014 investigate for undeclared improvements.`
        )
      );
    }
  }
  return hits;
}
function computeComposite(hits) {
  if (hits.length === 0) return 0;
  const byGroup = /* @__PURE__ */ new Map();
  const ungrouped = [];
  for (const h of hits) {
    const def = SIGNAL_CATALOGUE.find((s) => s.id === h.id);
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
  const sum = ungrouped.reduce((s, h) => s + h.weight, 0) + [...byGroup.values()].reduce((s, h) => s + h.weight, 0);
  return Math.min(1, sum);
}
function severityForScore(score) {
  if (score >= SEVERITY_BANDS.high) return "high";
  if (score >= SEVERITY_BANDS.medium) return "medium";
  return "low";
}
function estimateUplift(annualRatesNow, severity2) {
  const estAnnualRatesNew = Math.round(annualRatesNow * UPLIFT_MULTIPLIER[severity2]);
  const estUplift = estAnnualRatesNew - annualRatesNow;
  const estArrears3y = estUplift * 3;
  return { estAnnualRatesNew, estUplift, estArrears3y };
}

// ../recovery-engine/src/findMismatches.ts
var SEVERITY_RANK = {
  low: 0,
  medium: 1,
  high: 2
};
function describeHeadline(hits) {
  const sorted = [...hits].sort((a, b) => b.weight - a.weight);
  const top = sorted[0];
  if (!top) {
    return { kind: "no signal", reason: "" };
  }
  const others = hits.length - 1;
  const reason = others > 0 ? `${top.evidence} Plus ${others} additional signal(s) compound the case (composite breakdown below).` : top.evidence;
  return { kind: top.short, reason };
}
function findMismatches(ctx, options = {}) {
  const { council, minSeverity } = options;
  const minRank = SEVERITY_RANK[minSeverity ?? "low"];
  const out = [];
  for (const property of ctx.properties) {
    if (council !== void 0 && property.council !== council) {
      continue;
    }
    const signals = evaluateSignals(property, ctx);
    if (signals.length === 0) {
      continue;
    }
    const compositeScore = computeComposite(signals);
    const severity2 = severityForScore(compositeScore);
    if (SEVERITY_RANK[severity2] < minRank) {
      continue;
    }
    const { estAnnualRatesNew, estUplift, estArrears3y } = estimateUplift(
      property.annualRates,
      severity2
    );
    const { kind, reason } = describeHeadline(signals);
    const tenements = ctx.tenementsByAssessment.get(property.assessmentNumber) ?? [];
    out.push({
      assessmentNumber: property.assessmentNumber,
      property,
      tenements,
      kind,
      severity: severity2,
      reason,
      estAnnualRatesNew,
      estUplift,
      estArrears3y,
      compositeScore,
      // `confidence` is a backward-compatibility alias maintained on the
      // contract; new code should read `compositeScore`.
      confidence: compositeScore,
      signals
    });
  }
  out.sort((a, b) => b.estUplift - a.estUplift);
  return out;
}

// ../recovery-engine/src/evidencePack.ts
var DEFAULT_NOW = () => /* @__PURE__ */ new Date();
function buildEvidencePack(assessmentNumber2, ctx, options = {}) {
  const property = ctx.properties.find(
    (p) => p.assessmentNumber === assessmentNumber2
  );
  if (!property) {
    return { kind: "no_property" };
  }
  const signals = evaluateSignals(property, ctx);
  if (signals.length === 0) {
    return { kind: "no_signals", property };
  }
  const ownerId = property.ownerIds[0];
  const owner = ownerId ? ctx.ownersById.get(ownerId) : void 0;
  if (!owner) {
    return { kind: "no_owner", property };
  }
  const compositeScore = computeComposite(signals);
  const severity2 = severityForScore(compositeScore);
  const { estAnnualRatesNew, estUplift, estArrears3y } = estimateUplift(
    property.annualRates,
    severity2
  );
  const tenements = ctx.tenementsByAssessment.get(property.assessmentNumber) ?? [];
  const headline = describeHeadline2(signals);
  const candidate = {
    assessmentNumber: assessmentNumber2,
    property,
    tenements,
    kind: headline.kind,
    severity: severity2,
    reason: headline.reason,
    estAnnualRatesNew,
    estUplift,
    estArrears3y,
    compositeScore,
    confidence: compositeScore,
    signals
  };
  const now = (options.now ?? DEFAULT_NOW)();
  const generatedAt = formatIsoDate(now);
  const packId = `EP-${assessmentNumber2}-${generatedAt.replace(/-/g, "")}`;
  const markdown = renderMarkdown({
    packId,
    generatedAt,
    candidate,
    owner,
    tenements
  });
  return {
    kind: "ok",
    pack: { packId, generatedAt, candidate, markdown }
  };
}
function describeHeadline2(hits) {
  const sorted = [...hits].sort((a, b) => b.weight - a.weight);
  const top = sorted[0];
  if (!top) {
    return { kind: "no signal", reason: "" };
  }
  const others = hits.length - 1;
  const reason = others > 0 ? `${top.evidence} Plus ${others} additional signal(s) compound the case (composite breakdown below).` : top.evidence;
  return { kind: top.short, reason };
}
function formatIsoDate(d) {
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function aud2(n) {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}
function pct(score) {
  return `${Math.round(score * 100)}%`;
}
function renderSignalLine(s) {
  return `- **${s.short}** *(weight ${s.weight.toFixed(2)} \xB7 ${s.category})* \u2014 ${s.evidence}
  - Source: ${s.source}`;
}
function renderTenementLine(t) {
  const parts = [
    `**${t.tenementId}**`,
    `${t.type}-class`,
    t.status,
    t.commodity.length > 0 ? t.commodity.join(", ") : "no commodity listed",
    `holder: ${t.holder}`
  ];
  if (t.holderAbn) parts.push(`ABN ${t.holderAbn}`);
  if (t.isProducing) parts.push("producing");
  parts.push(`area ${t.areaHectares.toLocaleString("en-AU")} ha`);
  parts.push(`granted ${t.grantedDate}`);
  parts.push(`expires ${t.expiryDate}`);
  return `- ${parts.join(" \xB7 ")}`;
}
function proposedCategory(tenements, signals) {
  const hasTenementSignal = signals.some((s) => s.id.startsWith("reg.tenement.") || s.id.startsWith("reg.gpl."));
  if (hasTenementSignal && tenements.length > 0) return "Mining";
  return "Review \u2014 officer to determine appropriate category";
}
function statutoryBasis(property) {
  switch (property.state) {
    case "WA":
      return [
        "- *Local Government Act 1995* (WA), **s.6.16** \u2014 power of a local government to differentiate general rates by land-use category.",
        "- *Local Government Act 1995* (WA), **s.6.81** \u2014 backdating limit on rate adjustments (3 years rolled forward from current rating year, with strict notice requirements; this pack uses a 3-year conservative arrears estimate within that limit).",
        "- The council's adopted differential rates schedule for the relevant rating year."
      ].join("\n");
    case "NSW":
      return [
        "- *Local Government Act 1993* (NSW), Part 1 of Chapter 15 \u2014 categorisation of land for ordinary rates.",
        "- TODO: state-aware template \u2014 verify NSW backdating provisions and the council's rates resolution under s.514."
      ].join("\n");
    case "QLD":
      return [
        "- *Local Government Regulation 2012* (QLD), Part 4 \u2014 categorisation of rateable land and differential general rates.",
        "- TODO: state-aware template \u2014 verify QLD backdating provisions and the council's rates resolution under s.94 of the *Local Government Act 2009*."
      ].join("\n");
    case "VIC":
    case "SA":
    case "TAS":
    case "ACT":
    case "NT":
      return `- TODO: state-aware statutory template not yet drafted for ${property.state}. Council legal team to insert the relevant Local Government Act / Rates Act citations and backdating provisions before issuing the notice.`;
    default:
      return assertNever(property.state);
  }
}
function assertNever(x) {
  throw new Error(`Unexpected variant: ${String(x)}`);
}
function renderMarkdown(input) {
  const { packId, generatedAt, candidate, owner, tenements } = input;
  const { property, signals, severity: severity2, compositeScore, kind, reason } = candidate;
  const signalLines = [...signals].sort((a, b) => b.weight - a.weight).map(renderSignalLine).join("\n");
  const tenementLines = tenements.length > 0 ? tenements.map(renderTenementLine).join("\n") : "- (no tenement coverage on this parcel; signals derive from non-spatial sources)";
  const abnSuffix = owner.abn ? ` (ABN ${owner.abn}${owner.abnStatus && owner.abnStatus !== "Active" ? ` \u2014 ${owner.abnStatus}` : ""})` : "";
  const sources = Array.from(new Set(signals.map((s) => s.source))).join("; ");
  const proposed = proposedCategory(tenements, signals);
  return [
    `# Reclassification Evidence Pack`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| **Pack ID** | ${packId} |`,
    `| **Generated** | ${generatedAt} |`,
    `| **Composite confidence** | ${pct(compositeScore)} |`,
    `| **Severity** | ${severity2.toUpperCase()} |`,
    `| **Signals fired** | ${signals.length} |`,
    ``,
    `## 1. Property identification`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Assessment | ${property.assessmentNumber} |`,
    `| Address | ${property.address}, ${property.suburb} ${property.postcode} ${property.state} |`,
    `| Current classification | ${property.landUse} |`,
    `| Valuation | ${aud2(property.valuation)} |`,
    `| Current annual rates | ${aud2(property.annualRates)} |`,
    ``,
    `## 2. Owner of record`,
    ``,
    `- **Name:** ${owner.name}${abnSuffix}`,
    `- **Postal address:** ${owner.postalAddress}`,
    `- **Phone:** ${owner.phone ?? "not on record"}`,
    `- **Email:** ${owner.email ?? "not on record"}`,
    `- **Owner since:** ${owner.ownerSince}`,
    ``,
    `## 3. Detection signal trail`,
    ``,
    `Each signal below is sourced from an authoritative public or commercial dataset, weighted by historical reliability, and contributes to the composite confidence score. Signals are listed in descending order of weight.`,
    ``,
    signalLines,
    ``,
    `**Composite confidence:** ${pct(compositeScore)} \u2014 sum of contributing signal weights with mutually-exclusive groups deduplicated, capped at 100%.`,
    ``,
    `## 4. External evidence \u2014 DMIRS tenement records`,
    ``,
    `Source: DMIRS MINEDEX / GeoVIEW.WA (public mining tenement register)  `,
    `Retrieved: ${generatedAt}`,
    ``,
    tenementLines,
    ``,
    `## 5. Headline analysis`,
    ``,
    `- **Headline signal:** ${kind}`,
    `- **Reason:** ${reason}`,
    ``,
    `## 6. Statutory basis`,
    ``,
    statutoryBasis(property),
    ``,
    `## 7. Proposed reclassification`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Current category | ${property.landUse} |`,
    `| Proposed category | ${proposed} |`,
    `| Estimated annual rates | ${aud2(property.annualRates)} \u2192 ${aud2(candidate.estAnnualRatesNew)} |`,
    `| Estimated annual uplift | **${aud2(candidate.estUplift)}** |`,
    `| Estimated arrears (3-year conservative) | **${aud2(candidate.estArrears3y)}** |`,
    ``,
    `## 8. Draft notice to ratepayer`,
    ``,
    `> [Council letterhead]`,
    `>`,
    `> ${owner.name}  `,
    `> ${owner.postalAddress}`,
    `>`,
    `> **Re: Notice of proposed rate-category reclassification \u2014 Assessment ${property.assessmentNumber}**`,
    `>`,
    `> Following review of the rating classification applied to your property at ${property.address}, ${property.suburb}, the council proposes to reclassify the property from "${property.landUse}" to ${proposed === "Mining" ? '"Mining"' : "an appropriate alternative category"} with effect from the next rating year. The proposal is supported by evidence drawn from authoritative state and federal registers, summarised in the attached signal trail.`,
    `>`,
    `> The estimated annual rates under the proposed category are ${aud2(candidate.estAnnualRatesNew)}, an increase of ${aud2(candidate.estUplift)} over the current amount. Backdated adjustments may apply within the limits set by the relevant Local Government Act.`,
    `>`,
    `> You have the right to object to this proposed reclassification within the period prescribed by the council's rates resolution. Objections must be lodged in writing to the council's rates department.`,
    ``,
    `## 9. Audit trail`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Property record source | Council rating system (tenant adapter) |`,
    `| Signal sources | ${sources} |`,
    `| Cross-reference logic | RatesAssist multi-signal detection engine (deterministic, weighted-additive) |`,
    `| Severity scoring | Composite \u2265 0.60 high \xB7 \u2265 0.35 medium \xB7 \u2265 0.15 low |`,
    `| AI involvement | Narration only \u2014 scoring and uplift estimates are deterministic |`,
    `| Officer review required | Yes \u2014 statutory determination remains with the council |`,
    `| Pack retrieved | ${generatedAt} |`,
    ``,
    `---`,
    ``,
    `*Generated by RatesAssist. This pack is advisory; statutory determination remains with the council.*`
  ].join("\n");
}

// ../recovery-engine/src/stats.ts
var SEVERITIES = ["high", "medium", "low"];
function recoveryStats(candidates) {
  const bySeverity = {
    high: 0,
    medium: 0,
    low: 0
  };
  for (const s of SEVERITIES) {
    bySeverity[s] = bySeverity[s];
  }
  let totalUpliftAud = 0;
  let highSeverityUpliftAud = 0;
  let totalArrears3yAud = 0;
  const signalCounts = {};
  for (const c of candidates) {
    bySeverity[c.severity] += 1;
    totalUpliftAud += c.estUplift;
    totalArrears3yAud += c.estArrears3y;
    if (c.severity === "high") {
      highSeverityUpliftAud += c.estUplift;
    }
    for (const hit2 of c.signals) {
      signalCounts[hit2.id] = (signalCounts[hit2.id] ?? 0) + 1;
    }
  }
  return {
    total: candidates.length,
    bySeverity,
    totalUpliftAud,
    highSeverityUpliftAud,
    totalArrears3yAud,
    totalRecoveryAud: totalUpliftAud + totalArrears3yAud,
    signalCounts
  };
}

// src/handlers/recovery.ts
var MAX_MISMATCH_LINES = 25;
function tenementTypeLabel(type) {
  switch (type) {
    case "M":
      return "Mining Lease";
    case "E":
      return "Exploration Licence";
    case "P":
      return "Prospecting Licence";
    case "G":
      return "General-Purpose Lease";
    case "L":
      return "Misc / Infrastructure Licence";
    default:
      return type;
  }
}
async function findMiningMismatchesHandler(input, ctx) {
  const candidates = findMismatches(ctx.evaluationContext, {
    ...input.council !== void 0 ? { council: input.council } : {},
    ...input.minSeverity !== void 0 ? { minSeverity: input.minSeverity } : {}
  });
  if (candidates.length === 0) {
    const filterDesc = input.minSeverity ?? "low";
    return {
      ok: true,
      output: `No mining-classification mismatches found at severity >= ${filterDesc}.`,
      data: { candidates: [] },
      mutated: false
    };
  }
  const totalUplift = candidates.reduce((s, c) => s + c.estUplift, 0);
  const totalArrears = candidates.reduce((s, c) => s + c.estArrears3y, 0);
  const shown = candidates.slice(0, MAX_MISMATCH_LINES);
  const overflow = candidates.length - shown.length;
  const lines = shown.map((c, i) => {
    const tenList = c.tenements.map(
      (t) => `${t.tenementId} (${t.status}, ${t.commodity.join("/")}${t.isProducing ? ", producing" : ""})`
    ).join("; ");
    return [
      `${i + 1}. ${c.assessmentNumber} \u2014 ${c.property.address}, ${c.property.suburb}`,
      `   Current: ${c.property.landUse} \u2192 Proposed: Mining (${c.severity}, composite ${(c.compositeScore * 100).toFixed(0)}%)`,
      `   Tenements: ${tenList || "(none)"}`,
      `   Reason: ${c.reason}`,
      `   Est. annual uplift: ${aud(c.estUplift)} (${aud(c.property.annualRates)} \u2192 ${aud(c.estAnnualRatesNew)}); 3-yr arrears ${aud(c.estArrears3y)}`
    ].join("\n");
  });
  const trailer = overflow > 0 ? `
... and ${overflow} more (truncated; see structured data)` : "";
  const text = [
    `Mining-classification mismatch audit (severity >= ${input.minSeverity ?? "low"}${input.council ? `, council ${input.council}` : ""}):`,
    `${candidates.length} candidate(s). Estimated total annual uplift: ${aud(totalUplift)}; 3-year arrears window: ${aud(totalArrears)}.`,
    ``,
    ...lines,
    trailer,
    ``,
    `Use generate_evidence_pack with an assessment number to produce the council-grade reclassification case file.`
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { candidates: [...candidates] },
    mutated: false
  };
}
async function generateEvidencePackHandler(input, ctx) {
  const result = buildEvidencePack(input.assessmentNumber, ctx.evaluationContext, {
    now: ctx.now
  });
  switch (result.kind) {
    case "no_property":
      return notFound(
        `No property with assessment number "${input.assessmentNumber}".`,
        ctx.correlationId
      );
    case "no_signals":
      return {
        ok: true,
        output: `No signals fired against ${input.assessmentNumber} \u2014 no evidence pack required.`,
        data: { kind: "no_signals", property: result.property },
        mutated: false
      };
    case "no_owner":
      return {
        ok: true,
        output: `${input.assessmentNumber} has signals but no resolvable owner of record. Reconcile the rating system before drafting a reclassification notice.`,
        data: { kind: "no_owner", property: result.property },
        mutated: false
      };
    case "ok": {
      const pack = result.pack;
      return {
        ok: true,
        output: pack.markdown,
        data: {
          packId: pack.packId,
          generatedAt: pack.generatedAt,
          severity: pack.candidate.severity,
          compositeScore: pack.candidate.compositeScore,
          candidate: pack.candidate
        },
        mutated: false
      };
    }
    default:
      return {
        ok: false,
        code: "internal_error",
        error: "unhandled evidence pack outcome",
        correlationId: ctx.correlationId,
        retryable: false
      };
  }
}
async function recoverySummaryHandler(input, ctx) {
  const candidates = findMismatches(ctx.evaluationContext, {
    ...input.council !== void 0 ? { council: input.council } : {}
  });
  const stats = recoveryStats(candidates);
  const scope = input.council ? `council ${input.council}` : "all councils";
  const text = [
    `Recovery summary \u2014 ${scope}`,
    ``,
    `Total candidates: ${stats.total}`,
    `  High: ${stats.bySeverity.high}`,
    `  Medium: ${stats.bySeverity.medium}`,
    `  Low: ${stats.bySeverity.low}`,
    ``,
    `Estimated annual uplift: ${aud(stats.totalUpliftAud)} (high-severity only: ${aud(stats.highSeverityUpliftAud)})`,
    `Estimated 3-year arrears: ${aud(stats.totalArrears3yAud)}`,
    `Total recovery opportunity (uplift + arrears): ${aud(stats.totalRecoveryAud)}`,
    ``,
    `Top contributing signals: ${Object.entries(stats.signalCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => `${id}\xD7${intAu(n)}`).join(", ") || "(none)"}`
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { stats, candidates: [...candidates] },
    mutated: false
  };
}
async function getTenementForPropertyHandler(input, ctx) {
  const property = ctx.store.getProperty(input.assessmentNumber);
  if (property === void 0) {
    return notFound(
      `No property with assessment number "${input.assessmentNumber}".`,
      ctx.correlationId
    );
  }
  const tenements = ctx.store.tenementsForAssessment(input.assessmentNumber);
  if (tenements.length === 0) {
    return {
      ok: true,
      output: `No mining tenements intersect ${input.assessmentNumber}.`,
      data: { assessmentNumber: input.assessmentNumber, tenements: [] },
      mutated: false
    };
  }
  const lines = tenements.map(
    (t) => [
      `${t.tenementId} \u2014 ${tenementTypeLabel(t.type)}`,
      `  Status: ${t.status} | Holder: ${t.holder} (ABN ${t.holderAbn ?? "\u2014"})`,
      `  Commodity: ${t.commodity.join(", ")}`,
      `  Granted: ${t.grantedDate} | Expires: ${t.expiryDate}`,
      `  Area: ${intAu(t.areaHectares)} ha | Producing: ${t.isProducing ? "yes" : "no"}${t.lastWorkProgramYear !== null ? ` | Last work program: ${t.lastWorkProgramYear}` : ""}`
    ].join("\n")
  ).join("\n\n");
  return {
    ok: true,
    output: `Tenements intersecting ${input.assessmentNumber}:

${lines}`,
    data: { assessmentNumber: input.assessmentNumber, tenements: [...tenements] },
    mutated: false
  };
}

// src/handlers/briefing.ts
var TOP_OVERDUE_COUNT = 5;
async function dailyBriefingHandler(input, ctx) {
  const overdue = ctx.store.listOverdue(input.council);
  const totalOverdue = overdue.reduce((s, p) => s + p.balance, 0);
  const arrangements = overdue.filter((p) => p.paymentArrangement).length;
  const needingChase = overdue.length - arrangements;
  const candidates = findMismatches(ctx.evaluationContext, {
    ...input.council !== void 0 ? { council: input.council } : {}
  });
  const stats = recoveryStats(candidates);
  const topOverdue = [...overdue].sort((a, b) => b.balance - a.balance).slice(0, TOP_OVERDUE_COUNT);
  const scope = input.council ? `council ${input.council}` : "all councils";
  const date = isoDate(ctx.now());
  const text = [
    `Rates briefing \u2014 ${date} (${scope})`,
    ``,
    `Overdue accounts: ${overdue.length}`,
    `Total outstanding: ${aud(totalOverdue)}`,
    `On payment arrangements: ${arrangements}`,
    `Needing follow-up: ${needingChase}`,
    ``,
    `Recovery candidates: ${stats.total} (high: ${stats.bySeverity.high}, medium: ${stats.bySeverity.medium}, low: ${stats.bySeverity.low})`,
    `Estimated annual uplift: ${aud(stats.totalUpliftAud)}`,
    `Estimated recovery opportunity (3-year arrears + uplift): ${aud(stats.totalRecoveryAud)}`,
    ``,
    `Top ${Math.min(TOP_OVERDUE_COUNT, topOverdue.length)} overdue by balance:`,
    ...topOverdue.map(
      (p) => `  - ${p.assessmentNumber} | ${p.address}, ${p.suburb} | ${aud(p.balance)}`
    ),
    ``,
    `Suggested actions:`,
    `  - Run draft_chase_all_overdue for the friendly batch.`,
    `  - Review high-severity recovery candidates (find_mining_mismatches with minSeverity=high).`,
    `  - Generate evidence packs for the top three uplift candidates.`
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: {
      date,
      overdueCount: overdue.length,
      totalOverdue,
      arrangements,
      needingChase,
      recovery: stats
    },
    mutated: false
  };
}

// src/handlers/communications.ts
function firstName(owner) {
  const parts = owner.name.split(/\s+/);
  return parts[0] ?? owner.name;
}
function composeDraft(property, owner, tone2) {
  const subject = tone2 === "final" ? `FINAL NOTICE \u2014 Council rates ${property.assessmentNumber} (${aud(property.balance)} outstanding)` : tone2 === "firm" ? `Overdue council rates \u2014 ${property.assessmentNumber}` : `Friendly reminder \u2014 your council rates`;
  const greeting = tone2 === "final" ? "Notice" : `Hi ${firstName(owner)}`;
  const balance = aud(property.balance);
  const closing = tone2 === "final" ? `Failure to respond may result in legal recovery action under the Local Government Act applicable in ${property.state}. Contact the council's rates department immediately.` : tone2 === "firm" ? `Please arrange payment within 7 days to avoid further action. Payment plans are available on request.` : `You can pay via BPAY, online portal, or by contacting the council. Let us know if you'd like to set up a payment plan.`;
  const body = [
    `${greeting},`,
    ``,
    `Council rates of ${balance} for ${property.address}, ${property.suburb} (Assessment ${property.assessmentNumber}) are currently overdue.`,
    ``,
    closing,
    ``,
    `\u2014 Rates department`
  ].join("\n");
  return { subject, body };
}
async function draftPaymentReminderHandler(input, ctx) {
  const property = ctx.store.getProperty(input.assessmentNumber);
  if (property === void 0) {
    return notFound(
      `No property with assessment number "${input.assessmentNumber}".`,
      ctx.correlationId
    );
  }
  if (property.balance <= 0) {
    return {
      ok: true,
      output: `${input.assessmentNumber} has no outstanding balance \u2014 nothing to remind.`,
      data: { assessmentNumber: input.assessmentNumber, balance: property.balance },
      mutated: false
    };
  }
  const owner = ctx.store.ownersForProperty(property)[0];
  if (owner === void 0) {
    return {
      ok: true,
      output: `${input.assessmentNumber} has no owner of record \u2014 cannot draft a reminder.`,
      data: { assessmentNumber: input.assessmentNumber },
      mutated: false
    };
  }
  const { subject, body } = composeDraft(property, owner, input.tone);
  const draft = {
    assessmentNumber: property.assessmentNumber,
    recipient: owner.name,
    recipientPhone: owner.phone,
    recipientEmail: owner.email,
    tone: input.tone,
    subject,
    body,
    committed: false
  };
  const text = [
    `Draft (${input.tone}) for ${owner.name} \u2014 ${owner.phone ?? "no phone"} / ${owner.email ?? "no email"}:`,
    ``,
    `Subject: ${subject}`,
    ``,
    body,
    ``,
    `[NOT SENT \u2014 separate confirmation flow required]`
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { draft },
    mutated: false
  };
}
async function draftChaseAllOverdueHandler(input, ctx) {
  const overdue = ctx.store.listOverdue(input.council).filter((p) => !p.paymentArrangement);
  if (overdue.length === 0) {
    return {
      ok: true,
      output: `Nothing to chase \u2014 every overdue account is already on a payment arrangement.`,
      data: { drafts: [] },
      mutated: false
    };
  }
  const drafts = [];
  for (const property of overdue) {
    const owner = ctx.store.ownersForProperty(property)[0];
    if (owner === void 0) continue;
    const { subject, body } = composeDraft(property, owner, input.tone);
    drafts.push({
      assessmentNumber: property.assessmentNumber,
      recipient: owner.name,
      recipientPhone: owner.phone,
      recipientEmail: owner.email,
      tone: input.tone,
      subject,
      body,
      committed: false
    });
  }
  const summaryLines = drafts.map(
    (d) => `  - ${d.assessmentNumber} \u2192 ${d.recipient} | ${d.recipientPhone ?? "no phone"} / ${d.recipientEmail ?? "no email"}`
  ).join("\n");
  const text = [
    `Would draft ${drafts.length} ${input.tone} reminder${drafts.length === 1 ? "" : "s"}${input.council ? ` for council ${input.council}` : ""}:`,
    summaryLines,
    ``,
    `[NOT SENT \u2014 separate confirmation flow required to commit any individual draft]`
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { drafts },
    mutated: false
  };
}

// src/handlers/workflows.ts
function diffOwnerContact(owner, newPhone, newEmail) {
  const lines = [];
  const patch = {};
  if (newPhone !== void 0 && newPhone !== owner.phone) {
    lines.push(`  phone: ${owner.phone ?? "(none)"} \u2192 ${newPhone}`);
    patch.phone = newPhone;
  }
  if (newEmail !== void 0 && newEmail !== owner.email) {
    lines.push(`  email: ${owner.email ?? "(none)"} \u2192 ${newEmail}`);
    patch.email = newEmail;
  }
  return { lines, hasChanges: lines.length > 0, patch };
}
async function updateOwnerContactHandler(input, ctx) {
  const owner = ctx.store.getOwner(input.ownerId);
  if (owner === void 0) {
    return notFound(
      `No owner with id "${input.ownerId}".`,
      ctx.correlationId
    );
  }
  if (input.confirm) {
    if (input.commitToken === void 0) {
      return invalidInput(
        "confirm=true requires a commitToken from the preview call.",
        ctx.correlationId
      );
    }
    const consumed = ctx.commitTokens.consume(
      input.commitToken,
      "update_owner_contact"
    );
    if (!consumed.ok) {
      const reason = consumed.reason === "expired" ? "commitToken has expired (5 minute TTL); re-run the preview" : consumed.reason === "operation_mismatch" ? "commitToken was issued for a different operation" : "commitToken is unknown or already consumed";
      return conflict(reason, ctx.correlationId);
    }
    const mut = consumed.mutation;
    if (mut.operation !== "update_owner_contact") {
      return conflict("commitToken operation mismatch.", ctx.correlationId);
    }
    if (mut.ownerId !== input.ownerId) {
      return conflict(
        "commitToken was issued for a different ownerId.",
        ctx.correlationId
      );
    }
    const updated = {
      ...owner,
      ...mut.newPhone !== void 0 ? { phone: mut.newPhone } : {},
      ...mut.newEmail !== void 0 ? { email: mut.newEmail } : {}
    };
    const stored = ctx.store.replaceOwner(updated);
    if (stored === void 0) {
      return notFound(
        `Owner "${input.ownerId}" no longer exists.`,
        ctx.correlationId
      );
    }
    return {
      ok: true,
      output: `Updated contact for ${stored.name} (${stored.ownerId}).`,
      data: { owner: stored },
      mutated: true
    };
  }
  const { lines, hasChanges, patch } = diffOwnerContact(
    owner,
    input.newPhone,
    input.newEmail
  );
  if (!hasChanges) {
    return {
      ok: true,
      output: `No changes proposed for ${owner.name} (${owner.ownerId}); current values already match.`,
      data: { owner, changes: [] },
      mutated: false
    };
  }
  const token = ctx.commitTokens.issue({
    operation: "update_owner_contact",
    ownerId: owner.ownerId,
    ...patch.phone !== void 0 ? { newPhone: patch.phone } : {},
    ...patch.email !== void 0 ? { newEmail: patch.email } : {}
  });
  const text = [
    `Proposed change to ${owner.name} (${owner.ownerId}):`,
    ...lines,
    ``,
    `[NOT COMMITTED \u2014 re-run with confirm=true and commitToken=${token} within 5 minutes to apply.]`
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { owner, changes: lines },
    commitToken: token,
    mutated: false
  };
}
async function addPropertyNoteHandler(input, ctx) {
  const property = ctx.store.getProperty(input.assessmentNumber);
  if (property === void 0) {
    return notFound(
      `No property with assessment number "${input.assessmentNumber}".`,
      ctx.correlationId
    );
  }
  if (input.confirm) {
    if (input.commitToken === void 0) {
      return invalidInput(
        "confirm=true requires a commitToken from the preview call.",
        ctx.correlationId
      );
    }
    const consumed = ctx.commitTokens.consume(
      input.commitToken,
      "add_property_note"
    );
    if (!consumed.ok) {
      const reason = consumed.reason === "expired" ? "commitToken has expired (5 minute TTL); re-run the preview" : consumed.reason === "operation_mismatch" ? "commitToken was issued for a different operation" : "commitToken is unknown or already consumed";
      return conflict(reason, ctx.correlationId);
    }
    const mut = consumed.mutation;
    if (mut.operation !== "add_property_note") {
      return conflict("commitToken operation mismatch.", ctx.correlationId);
    }
    if (mut.assessmentNumber !== input.assessmentNumber) {
      return conflict(
        "commitToken was issued for a different assessment number.",
        ctx.correlationId
      );
    }
    const stored = ctx.store.addNoteToProperty(input.assessmentNumber, mut.note);
    if (stored === void 0) {
      return notFound(
        `Property "${input.assessmentNumber}" no longer exists.`,
        ctx.correlationId
      );
    }
    return {
      ok: true,
      output: `Note appended to ${stored.assessmentNumber}. Total notes on file: ${stored.notes.length}.`,
      data: { property: stored, addedNote: mut.note },
      mutated: true
    };
  }
  const token = ctx.commitTokens.issue({
    operation: "add_property_note",
    assessmentNumber: input.assessmentNumber,
    note: input.note
  });
  const text = [
    `Proposed note for ${property.assessmentNumber} (${property.address}):`,
    ``,
    `> ${input.note}`,
    ``,
    `[NOT COMMITTED \u2014 re-run with confirm=true and commitToken=${token} within 5 minutes to apply.]`
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { property, proposedNote: input.note },
    commitToken: token,
    mutated: false
  };
}
var CERTIFICATE_TYPES_BY_STATE = {
  WA: ["WA-6.76", "WA-S6.76"],
  NSW: ["NSW-603", "NSW-S603"],
  QLD: ["QLD-95", "QLD-S95"]
};
function certificateBodyFor(state, args) {
  const wa = `**Statutory rates certificate \u2014 Local Government Act 1995 (WA), s.6.76**

Issued under section 6.76 of the *Local Government Act 1995* (WA). This certificate states the amount of rates and service charges (if any) due and payable in respect of the land described, as at the date of issue.

| Field | Value |
|---|---|
| Assessment number | ${args.assessmentNumber} |
| Property address | ${args.address}, ${args.suburb} ${args.postcode} WA |
| Current land-use category | ${args.landUse} |
| Capital improved valuation | ${aud(args.valuation)} |
| Annual rates (current rating year) | ${aud(args.annualRates)} |
| Outstanding balance as at ${args.issuedDate} | ${aud(args.balance)} |
| Issued to | ${args.requesterName} (${args.requesterEmail}) |

This certificate does not include any amounts that may become due after the date of issue, nor any amounts under appeal. Backdating limits under s.6.81 of the *Local Government Act 1995* (WA) apply to subsequent rate adjustments.

\u2014 Issued by the council under delegated authority.`;
  const nsw = `**Section 603 certificate \u2014 Local Government Act 1993 (NSW)**

Issued under section 603 of the *Local Government Act 1993* (NSW). This certificate states the amount due in respect of the land described, as at the date of issue.

| Field | Value |
|---|---|
| Assessment number | ${args.assessmentNumber} |
| Property address | ${args.address}, ${args.suburb} ${args.postcode} NSW |
| Current categorisation | ${args.landUse} |
| Land valuation | ${aud(args.valuation)} |
| Annual ordinary rate | ${aud(args.annualRates)} |
| Outstanding balance as at ${args.issuedDate} | ${aud(args.balance)} |
| Issued to | ${args.requesterName} (${args.requesterEmail}) |

This certificate is issued for the purposes of section 603 of the *Local Government Act 1993* (NSW). It does not constitute a clearance certificate under any other legislation.

\u2014 Issued by the council under delegated authority.`;
  const qld = `**Section 95 rates certificate \u2014 Local Government Regulation 2012 (QLD)**

Issued under section 95 of the *Local Government Regulation 2012* (QLD). This certificate states rates and charges due in respect of the land described, as at the date of issue.

| Field | Value |
|---|---|
| Assessment number | ${args.assessmentNumber} |
| Property address | ${args.address}, ${args.suburb} ${args.postcode} QLD |
| Differential general rates category | ${args.landUse} |
| Statutory site value | ${aud(args.valuation)} |
| Annual differential general rate | ${aud(args.annualRates)} |
| Outstanding balance as at ${args.issuedDate} | ${aud(args.balance)} |
| Issued to | ${args.requesterName} (${args.requesterEmail}) |

This certificate does not include amounts that may become due after the date of issue. Refer to the council's separate utility-charges certificate for water, waste, and other service charges.

\u2014 Issued by the council under delegated authority.`;
  switch (state) {
    case "WA":
      return wa;
    case "NSW":
      return nsw;
    case "QLD":
      return qld;
    default:
      throw new Error(
        `certificateBodyFor invoked for unsupported state ${state}`
      );
  }
}
async function generateStatutoryCertificateHandler(input, ctx) {
  const property = ctx.store.getProperty(input.assessmentNumber);
  if (property === void 0) {
    return notFound(
      `No property with assessment number "${input.assessmentNumber}".`,
      ctx.correlationId
    );
  }
  const expected = CERTIFICATE_TYPES_BY_STATE[property.state];
  if (expected === void 0 || expected.length === 0) {
    return forbidden(
      `Statutory certificate generation for ${property.state} is not yet supported by this adapter (see README for the deferred-state list).`,
      ctx.correlationId
    );
  }
  if (!expected.includes(input.certificateType)) {
    return invalidInput(
      `certificateType "${input.certificateType}" is not valid for ${property.state}; expected one of: ${expected.join(", ")}.`,
      ctx.correlationId
    );
  }
  const issuedDate = isoDate(ctx.now());
  const body = certificateBodyFor(property.state, {
    assessmentNumber: property.assessmentNumber,
    address: property.address,
    suburb: property.suburb,
    postcode: property.postcode,
    landUse: property.landUse,
    valuation: property.valuation,
    annualRates: property.annualRates,
    balance: property.balance,
    requesterName: input.requesterName,
    requesterEmail: input.requesterEmail,
    issuedDate
  });
  const certificateId = `CERT-${property.assessmentNumber}-${issuedDate.replace(/-/g, "")}`;
  const text = [
    `# ${certificateId}`,
    ``,
    body,
    ``,
    `*Generated by RatesAssist on behalf of the council. The council retains statutory authority for the issued certificate.*`
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: {
      certificateId,
      certificateType: input.certificateType,
      state: property.state,
      issuedDate,
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail,
      property
    },
    mutated: false
  };
}

// src/handlers/identity.ts
async function verifyAbnHandler(input, ctx) {
  const result = await ctx.abnClient.lookupAbn(input.abn, {
    correlationId: ctx.correlationId
  });
  if (!result.ok) {
    switch (result.code) {
      case "invalid_input":
        return invalidInput(result.error, ctx.correlationId);
      case "not_found":
        return notFound(`ABN ${input.abn} was not found in the ABR.`, ctx.correlationId);
      case "timeout":
        return failure2("timeout", result.error, ctx.correlationId, true);
      case "upstream_error":
        return failure2("upstream_error", result.error, ctx.correlationId, true);
      case "unconfigured":
        return failure2(
          "internal_error",
          "ABN client is not configured for live lookups (no GUID).",
          ctx.correlationId,
          false
        );
      default:
        return failure2("internal_error", result.error, ctx.correlationId, false);
    }
  }
  const text = [
    `ABN ${result.abn} \u2014 ${result.entityName}`,
    `Status: ${result.status}`,
    `Type: ${result.entityType ?? "unspecified"}`,
    `GST registered: ${result.gstRegistered ? "yes" : "no"}${result.gstRegisteredFrom ? ` (since ${result.gstRegisteredFrom})` : ""}`,
    `Address (best effort): ${result.address ?? "not provided"}`,
    `Source: ${result.source}`
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { lookup: result },
    mutated: false
  };
}
async function listCouncilsHandler(_input, ctx) {
  const councils = ctx.store.listCouncils();
  const lines = councils.map(
    (c) => `  - ${c.code} | ${c.name} (${c.state}) | population ${intAu(c.population)} | rateable ${intAu(c.rateableProperties)}`
  ).join("\n");
  return {
    ok: true,
    output: `${councils.length} councils:
${lines}`,
    data: { councils: [...councils] },
    mutated: false
  };
}

// src/handlers/index.ts
var HANDLERS = {
  search_property: searchPropertyHandler,
  search_by_owner: searchByOwnerHandler,
  get_property_detail: getPropertyDetailHandler,
  get_transaction_history: getTransactionHistoryHandler,
  list_overdue: listOverdueHandler,
  list_properties: listPropertiesHandler,
  list_councils: listCouncilsHandler,
  get_owner: getOwnerHandler,
  draft_payment_reminder: draftPaymentReminderHandler,
  draft_chase_all_overdue: draftChaseAllOverdueHandler,
  update_owner_contact: updateOwnerContactHandler,
  add_property_note: addPropertyNoteHandler,
  generate_statutory_certificate: generateStatutoryCertificateHandler,
  get_tenement_for_property: getTenementForPropertyHandler,
  find_mining_mismatches: findMiningMismatchesHandler,
  generate_evidence_pack: generateEvidencePackHandler,
  recovery_summary: recoverySummaryHandler,
  daily_briefing: dailyBriefingHandler,
  verify_abn: verifyAbnHandler
};

// src/runtime/dispatcher.ts
var KNOWN_TOOLS = new Set(
  Object.keys(inputs)
);
function isToolName(name) {
  return KNOWN_TOOLS.has(name);
}
async function dispatch(args) {
  const { toolName, input, context } = args;
  if (!isToolName(toolName)) {
    return failure2(
      "invalid_input",
      `Unknown tool "${toolName}".`,
      context.correlationId
    );
  }
  const schema = inputs[toolName];
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") || "invalid input";
    return failure2("invalid_input", message, context.correlationId);
  }
  const handler = HANDLERS[toolName];
  let raw;
  try {
    raw = await handler(parsed.data, context);
  } catch (e) {
    const message = e instanceof Error ? e.message : "handler threw";
    return failure2("internal_error", message, context.correlationId);
  }
  const validatedResult = toolResult.safeParse(raw);
  if (!validatedResult.success) {
    return failure2(
      "internal_error",
      `handler "${toolName}" returned a result that did not match the contract: ${validatedResult.error.issues.map((i) => i.message).join("; ")}`,
      context.correlationId
    );
  }
  return validatedResult.data;
}

// src/server.ts
var ADAPTER_IDENTITY_URI = "adapter://identity";
var EXIT_OK = 0;
var EXIT_FATAL = 1;
async function main() {
  const server = new Server(
    {
      name: SERVER_DISPLAY_NAME,
      version: ADAPTER_IDENTITY.version
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );
  const store = new DataStore();
  const commitTokens = new CommitTokenStore();
  const abnClient = createDefaultAbnClient();
  const catalogue = buildToolCatalogue();
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: catalogue.map((t) => ({
        name: t.name,
        description: t.description,
        // The contract emits OpenAPI-3 JSON Schema. The MCP SDK's `tools.tool`
        // type asks for `Record<string, unknown>` — at runtime we hand it the
        // generated schema verbatim. SAFETY: the schema generator returns a
        // JSON Schema object; MCP clients tolerate unknown extensions.
        inputSchema: t.inputSchema
      }))
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const ctx = createRequestContext({ store, commitTokens, abnClient });
    const result = await dispatch({
      toolName: request.params.name,
      input: request.params.arguments ?? {},
      context: ctx
    });
    if (result.ok) {
      const meta = {};
      if (result.data !== void 0) meta["data"] = result.data;
      if (result.commitToken !== void 0) meta["commitToken"] = result.commitToken;
      meta["mutated"] = result.mutated;
      return {
        content: [{ type: "text", text: result.output }],
        isError: false,
        _meta: meta
      };
    }
    const errorPayload = {
      code: result.code,
      error: result.error,
      correlationId: result.correlationId,
      retryable: result.retryable
    };
    return {
      content: [
        { type: "text", text: `Error (${result.code}): ${result.error}` },
        { type: "text", text: JSON.stringify(errorPayload) }
      ],
      isError: true
    };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: ADAPTER_IDENTITY_URI,
        name: "Adapter identity",
        description: "RatesAssist adapter identity (id, version, contractVersion, capabilities). Used by the web app for audit logging and compatibility checking.",
        mimeType: "application/json"
      }
    ]
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== ADAPTER_IDENTITY_URI) {
      throw new Error(`Unknown resource URI: ${request.params.uri}`);
    }
    return {
      contents: [
        {
          uri: ADAPTER_IDENTITY_URI,
          mimeType: "application/json",
          text: JSON.stringify(ADAPTER_IDENTITY, null, 2)
        }
      ]
    };
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[${ADAPTER_IDENTITY.id}@${ADAPTER_IDENTITY.version}] connected via stdio (contract ${ADAPTER_IDENTITY.contractVersion}, ${catalogue.length} tools)`
  );
  return async () => {
    await server.close();
  };
}
function installSignalHandlers(disposer) {
  let shuttingDown = false;
  const handle = (signal) => {
    if (shuttingDown) {
      console.error(`[adapter-demo] received ${signal} during shutdown \u2014 exiting immediately`);
      process.exit(EXIT_OK);
      return;
    }
    shuttingDown = true;
    console.error(`[adapter-demo] received ${signal} \u2014 closing transport`);
    disposer().then(
      () => process.exit(EXIT_OK),
      (e) => {
        console.error(
          `[adapter-demo] error during shutdown: ${e instanceof Error ? e.message : String(e)}`
        );
        process.exit(EXIT_FATAL);
      }
    );
  };
  process.on("SIGTERM", handle);
  process.on("SIGINT", handle);
}
main().then(
  (disposer) => installSignalHandlers(disposer),
  (e) => {
    console.error(
      `[adapter-demo] fatal startup error: ${e instanceof Error ? e.message : String(e)}`
    );
    process.exit(EXIT_FATAL);
  }
);
