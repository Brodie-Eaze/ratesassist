// Domain types — shared across web app and tool layer

export type LandUse =
  | "Residential"
  | "Commercial"
  | "Industrial"
  | "Rural"
  | "Vacant"
  | "Mining";

export type AustralianState =
  | "WA"
  | "NSW"
  | "VIC"
  | "QLD"
  | "SA"
  | "TAS"
  | "ACT"
  | "NT";

export type Property = {
  assessmentNumber: string;
  council: string;
  address: string;
  suburb: string;
  postcode: string;
  state: AustralianState;
  landUse: LandUse;
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
  lat: number;
  lng: number;
  // Loose-fit polygon for cadastral overlay (4-6 points around the centroid)
  parcel?: [number, number][];
};

export type AbnStatus = "Active" | "Cancelled" | "Suspended" | null;

export type Owner = {
  ownerId: string;
  name: string;
  abn: string | null;
  abnStatus?: AbnStatus;
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

export type TenementType = "M" | "E" | "P" | "G" | "L";
export type TenementStatus = "Live" | "Pending" | "Surrendered" | "Cancelled";

export type Tenement = {
  tenementId: string;
  type: TenementType;
  status: TenementStatus;
  holder: string;
  holderAbn: string | null;
  commodity: string[];
  grantedDate: string;
  expiryDate: string;
  areaHectares: number;
  intersectsAssessmentNumbers: string[];
  isProducing: boolean;
  lastWorkProgramYear: number | null;
  // Polygon (lat,lng) — typically 4-6 points
  polygon: [number, number][];
};

export type MismatchSeverity = "high" | "medium" | "low";

export type SignalCategory =
  | "register"
  | "aerial"
  | "identity"
  | "spatial"
  | "behavioural"
  | "corporate";

export type SignalDef = {
  id: string;
  name: string;
  short: string;
  category: SignalCategory;
  weight: number;
  description: string;
  source: string;
  exclusiveGroup?: string;
};

export type SignalHit = {
  id: string;
  name: string;
  short: string;
  category: SignalCategory;
  weight: number;
  evidence: string;
  source: string;
};

export type MismatchCandidate = {
  assessmentNumber: string;
  property: Property;
  tenements: Tenement[];
  kind: string;
  severity: MismatchSeverity;
  reason: string;
  estAnnualRatesNew: number;
  estUplift: number;
  estArrears5y: number;
  confidence: number;
  /** New: per-candidate signal trail and weighted composite score (0..1) */
  signals: SignalHit[];
  compositeScore: number;
};

export type Council = {
  code: string;
  name: string;
  state: AustralianState;
  population: number;
  rateableProperties: number;
  rateRevenue: number;
  // Council seat coordinates for map centring
  centerLat: number;
  centerLng: number;
};

export type ChatRole = "user" | "assistant";

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  timestamp: string;
};

// ===== Connections / integrations =====

export type IntegrationStatus = "live" | "degraded" | "unconfigured" | "error";

export type Integration = {
  id: string;
  name: string;
  category:
    | "Rating system"
    | "Mining & cadastral"
    | "Imagery"
    | "Identity"
    | "Communications"
    | "Payments"
    | "Documents"
    | "Observability";
  description: string;
  status: IntegrationStatus;
  lastSync?: string;
  authType: "OAuth 2.0" | "API key" | "Public" | "SSO" | "Webhook" | "SMTP/SMS gateway";
  scope?: string;
  endpoint?: string;
  vendor?: string;
};

// ===== Activity / audit log =====

export type ActivityEvent = {
  id: string;
  ts: string;
  user: string;
  council: string;
  action: string;
  target?: string;
  detail: string;
  category: "lookup" | "write" | "comms" | "recovery" | "system" | "auth";
};

// ===== Reconciliation =====

export type BankDeposit = {
  id: string;
  date: string;
  amount: number;
  reference: string;
  source: string;
  matchAssessment?: string;
  matchConfidence?: number;
  status: "matched" | "suggested" | "unmatched";
};
