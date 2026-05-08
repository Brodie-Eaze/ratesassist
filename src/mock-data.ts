// Mock TechOne-style rates data. Schema mirrors typical OneCouncil Property & Rating fields.
// Real implementation will replace this with CiAnywhere REST API calls.

export type Property = {
  assessmentNumber: string;
  address: string;
  suburb: string;
  postcode: string;
  landUse: "Residential" | "Commercial" | "Industrial" | "Rural" | "Vacant";
  valuation: number;
  annualRates: number;
  balance: number;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
  paymentMethod: "Direct Debit" | "BPAY" | "Counter" | "Mail" | null;
  pensionerRebate: boolean;
  paymentArrangement: boolean;
  ownerIds: string[];
  notes: string[];
};

export type Owner = {
  ownerId: string;
  name: string;
  postalAddress: string;
  email: string | null;
  phone: string | null;
  ownerSince: string;
  previousOwners: { name: string; period: string }[];
};

export type Transaction = {
  date: string;
  type: "Rates Levy" | "Payment" | "Adjustment" | "Penalty Interest";
  amount: number;
  reference: string;
  balance: number;
};

export const PROPERTIES: Property[] = [
  {
    assessmentNumber: "4471-22",
    address: "14 Oak Avenue",
    suburb: "Croydon",
    postcode: "3136",
    landUse: "Residential",
    valuation: 820000,
    annualRates: 3420,
    balance: 0,
    lastPaymentDate: "2026-04-02",
    lastPaymentAmount: 855,
    paymentMethod: "Direct Debit",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-10841"],
    notes: ["Owner change registered 12 Mar 2026 (sale settled)."],
  },
  {
    assessmentNumber: "6622-19",
    address: "12 Boundary Road",
    suburb: "Mortdale",
    postcode: "2223",
    landUse: "Residential",
    valuation: 1140000,
    annualRates: 4280,
    balance: 847.5,
    lastPaymentDate: "2025-11-04",
    lastPaymentAmount: 1070,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-04412"],
    notes: ["Q1 2026 instalment overdue 23 days.", "Prior payment plan in 2024 (completed)."],
  },
  {
    assessmentNumber: "8814-03",
    address: "47 Smith Street",
    suburb: "Mortdale",
    postcode: "2223",
    landUse: "Residential",
    valuation: 690000,
    annualRates: 2980,
    balance: 745,
    lastPaymentDate: "2026-02-14",
    lastPaymentAmount: 745,
    paymentMethod: "Counter",
    pensionerRebate: true,
    paymentArrangement: false,
    ownerIds: ["O-09201"],
    notes: ["Pensioner rebate active (NSW $250 + council $200)."],
  },
  {
    assessmentNumber: "8821-07",
    address: "9 Smith Lane",
    suburb: "Mortdale",
    postcode: "2223",
    landUse: "Residential",
    valuation: 760000,
    annualRates: 3120,
    balance: 0,
    lastPaymentDate: "2026-04-15",
    lastPaymentAmount: 780,
    paymentMethod: "Direct Debit",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-11502"],
    notes: [],
  },
  {
    assessmentNumber: "2231-14",
    address: "203 Forest Road",
    suburb: "Hurstville",
    postcode: "2220",
    landUse: "Commercial",
    valuation: 2450000,
    annualRates: 18400,
    balance: 4600,
    lastPaymentDate: "2025-10-20",
    lastPaymentAmount: 4600,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: true,
    ownerIds: ["O-21105"],
    notes: ["12-month payment arrangement signed 2025-09-01.", "On track."],
  },
  // ----- WA MINING-AREA PROPERTIES (for RatesRecovery cross-reference) -----
  {
    assessmentNumber: "WA-1102-44",
    address: "Lot 1144 Great Northern Highway",
    suburb: "Tom Price",
    postcode: "6751",
    landUse: "Rural",
    valuation: 380000,
    annualRates: 1820,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 455,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Rural classification on file since 2014."],
  },
  {
    assessmentNumber: "WA-1102-47",
    address: "Lot 1147 Great Northern Highway",
    suburb: "Tom Price",
    postcode: "6751",
    landUse: "Rural",
    valuation: 410000,
    annualRates: 1960,
    balance: 0,
    lastPaymentDate: "2026-04-01",
    lastPaymentAmount: 490,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Rural classification on file since 2017."],
  },
  {
    assessmentNumber: "WA-1102-71",
    address: "Lot 1171 Karratha-Tom Price Road",
    suburb: "Karratha",
    postcode: "6714",
    landUse: "Vacant",
    valuation: 240000,
    annualRates: 980,
    balance: 0,
    lastPaymentDate: "2026-03-15",
    lastPaymentAmount: 245,
    paymentMethod: "Direct Debit",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-002"],
    notes: ["Listed as vacant — last inspection 2021."],
  },
  {
    assessmentNumber: "WA-2204-19",
    address: "Lot 219 Sandstone-Mount Magnet Road",
    suburb: "Sandstone",
    postcode: "6639",
    landUse: "Rural",
    valuation: 195000,
    annualRates: 720,
    balance: 0,
    lastPaymentDate: "2026-04-10",
    lastPaymentAmount: 180,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-003"],
    notes: ["Rural classification."],
  },
  {
    assessmentNumber: "WA-2204-31",
    address: "Lot 231 Sandstone-Mount Magnet Road",
    suburb: "Sandstone",
    postcode: "6639",
    landUse: "Rural",
    valuation: 175000,
    annualRates: 660,
    balance: 0,
    lastPaymentDate: "2026-04-10",
    lastPaymentAmount: 165,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-004"],
    notes: ["Rural."],
  },
  {
    assessmentNumber: "WA-1102-91",
    address: "Lot 1191 Tom Price Mining Road",
    suburb: "Tom Price",
    postcode: "6751",
    landUse: "Rural",
    valuation: 285000,
    annualRates: 1200,
    balance: 0,
    lastPaymentDate: "2026-03-20",
    lastPaymentAmount: 300,
    paymentMethod: "BPAY",
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: ["O-WA-001"],
    notes: ["Includes light infrastructure access road."],
  },
];

export const OWNERS: Owner[] = [
  {
    ownerId: "O-10841",
    name: "Lisa Chen",
    postalAddress: "14 Oak Avenue, Croydon VIC 3136",
    email: "lisa.chen@example.com",
    phone: "0412 555 081",
    ownerSince: "2026-03-12",
    previousOwners: [{ name: "K & S Patel", period: "2018-04-22 to 2026-03-12" }],
  },
  {
    ownerId: "O-04412",
    name: "Robert & Jane Smith",
    postalAddress: "12 Boundary Road, Mortdale NSW 2223",
    email: "rj.smith@example.com",
    phone: "0419 332 410",
    ownerSince: "2014-07-08",
    previousOwners: [],
  },
  {
    ownerId: "O-09201",
    name: "Margaret Smith",
    postalAddress: "47 Smith Street, Mortdale NSW 2223",
    email: null,
    phone: "0408 221 567",
    ownerSince: "2002-01-14",
    previousOwners: [],
  },
  {
    ownerId: "O-11502",
    name: "Aiden Smith",
    postalAddress: "9 Smith Lane, Mortdale NSW 2223",
    email: "aiden.s@example.com",
    phone: "0432 880 119",
    ownerSince: "2021-11-30",
    previousOwners: [],
  },
  {
    ownerId: "O-21105",
    name: "Hurstville Holdings Pty Ltd",
    postalAddress: "PO Box 1144, Hurstville NSW 1481",
    email: "accounts@hurstvilleholdings.example",
    phone: "02 9580 4400",
    ownerSince: "2010-06-01",
    previousOwners: [],
  },
  // ----- WA MINING-AREA OWNERS -----
  {
    ownerId: "O-WA-001",
    name: "Pilbara Iron Holdings Pty Ltd",
    postalAddress: "Level 12, 100 St Georges Terrace, Perth WA 6000",
    email: "rates@pilbara-iron.example",
    phone: "08 9200 7700",
    ownerSince: "2014-08-19",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-002",
    name: "Karratha Exploration Pty Ltd",
    postalAddress: "PO Box 5511, Karratha WA 6714",
    email: "admin@karratha-exploration.example",
    phone: "08 9144 2200",
    ownerSince: "2022-11-14",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-003",
    name: "Goldfields Resources Ltd",
    postalAddress: "Level 5, 50 Kings Park Road, West Perth WA 6005",
    email: "rates@goldfields-resources.example",
    phone: "08 9226 1100",
    ownerSince: "2009-06-22",
    previousOwners: [],
  },
  {
    ownerId: "O-WA-004",
    name: "Sandstone Prospecting Pty Ltd",
    postalAddress: "PO Box 88, Sandstone WA 6639",
    email: "info@sandstone-prospecting.example",
    phone: "0428 990 117",
    ownerSince: "2023-04-01",
    previousOwners: [],
  },
];

export const TRANSACTIONS: Record<string, Transaction[]> = {
  "6622-19": [
    { date: "2025-07-01", type: "Rates Levy", amount: 4280, reference: "LVY-2025-26", balance: 4280 },
    { date: "2025-08-12", type: "Payment", amount: -1070, reference: "BPAY-882104", balance: 3210 },
    { date: "2025-11-04", type: "Payment", amount: -1070, reference: "BPAY-901188", balance: 2140 },
    { date: "2026-02-01", type: "Penalty Interest", amount: 22.5, reference: "INT-Q3", balance: 1092.5 },
    { date: "2026-04-15", type: "Adjustment", amount: -245, reference: "ADJ-WAIVER", balance: 847.5 },
  ],
};

export function searchProperties(query: string): Property[] {
  const q = query.toLowerCase();
  return PROPERTIES.filter(
    (p) =>
      p.address.toLowerCase().includes(q) ||
      p.suburb.toLowerCase().includes(q) ||
      p.assessmentNumber.includes(q),
  );
}

export function searchByOwnerName(name: string, suburbFilter?: string): Property[] {
  const q = name.toLowerCase();
  const matchedOwners = OWNERS.filter((o) => o.name.toLowerCase().includes(q));
  const ownerIds = new Set(matchedOwners.map((o) => o.ownerId));
  return PROPERTIES.filter((p) => {
    const ownerMatch = p.ownerIds.some((id) => ownerIds.has(id));
    const suburbMatch = suburbFilter ? p.suburb.toLowerCase() === suburbFilter.toLowerCase() : true;
    return ownerMatch && suburbMatch;
  });
}

export function getOwnersForProperty(p: Property): Owner[] {
  return OWNERS.filter((o) => p.ownerIds.includes(o.ownerId));
}

export function getOverdueProperties(minDays: number = 1): Property[] {
  return PROPERTIES.filter((p) => p.balance > 0);
}

export function getTransactions(assessmentNumber: string): Transaction[] {
  return TRANSACTIONS[assessmentNumber] ?? [];
}
