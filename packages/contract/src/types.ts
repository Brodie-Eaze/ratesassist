/**
 * @ratesassist/contract — domain types
 *
 * Canonical TypeScript types shared across every package and every adapter.
 * No package re-declares these. No package extends them with platform-specific
 * fields without first proposing a contract change.
 *
 * Stability: every change here is a breaking change for every adapter. Treat
 * this file as the public API of the platform.
 */

// ===== Geographic + spatial primitives =====

/** Leaflet's coordinate order: latitude first, then longitude. */
export type LatLng = readonly [lat: number, lng: number];

/** GeoJSON's coordinate order: longitude first, then latitude. */
export type LngLat = readonly [lng: number, lat: number];

/**
 * Bounding box in GeoJSON order [minLng, minLat, maxLng, maxLat].
 * Used for spatial queries; matches the WFS / ArcGIS REST envelope convention.
 */
export type BoundingBox = readonly [minLng: number, minLat: number, maxLng: number, maxLat: number];

// ===== Australian jurisdictions =====

export type AustralianState =
  | "WA"
  | "NSW"
  | "VIC"
  | "QLD"
  | "SA"
  | "TAS"
  | "ACT"
  | "NT";

// ===== Council / tenant =====

/**
 * A tenant in RatesAssist is one council. Each tenant maps to exactly one
 * rating-system adapter; multiple tenants may use the same adapter type
 * (e.g. several councils all on TechOne CiAnywhere) but each tenant has its
 * own credentials and instance.
 */
export type Council = {
  /** Stable internal code, e.g. "TPS" — used as the tenant identifier. */
  readonly code: string;
  /** Council name as registered with the relevant state Local Government dept. */
  readonly name: string;
  readonly state: AustralianState;
  readonly population: number;
  readonly rateableProperties: number;
  /** Annual rates revenue (AUD). Approximate; sourced from public council reports. */
  readonly rateRevenue: number;
  /** Council seat / chambers latitude (for map centring). */
  readonly centerLat: number;
  /** Council seat / chambers longitude. */
  readonly centerLng: number;
};

// ===== Land use + property =====

export type LandUse =
  | "Residential"
  | "Commercial"
  | "Industrial"
  | "Rural"
  | "Vacant"
  | "Mining";

export type PaymentMethod = "Direct Debit" | "BPAY" | "Counter" | "Mail";

/**
 * A rateable property as represented in the council's rating system.
 *
 * `assessmentNumber` is the council's primary key. It is unique within a
 * tenant but not necessarily across tenants.
 */
export type Property = {
  readonly assessmentNumber: string;
  readonly council: string;
  readonly address: string;
  readonly suburb: string;
  readonly postcode: string;
  readonly state: AustralianState;
  readonly landUse: LandUse;
  readonly valuation: number;
  readonly annualRates: number;
  /** Outstanding balance in AUD. Negative balances (credits) are valid. */
  readonly balance: number;
  readonly lastPaymentDate: string | null;
  readonly lastPaymentAmount: number | null;
  readonly paymentMethod: PaymentMethod | null;
  readonly pensionerRebate: boolean;
  readonly paymentArrangement: boolean;
  readonly ownerIds: readonly string[];
  readonly notes: readonly string[];
  /** Property centroid (Leaflet order). */
  readonly lat: number;
  readonly lng: number;
  /**
   * Rough cadastral parcel polygon (Leaflet order). Optional; some
   * tenants do not expose parcel geometry through their rating system.
   * Real parcel geometry should come from the cadastral service (Landgate
   * SLIP etc.) when available.
   */
  readonly parcel?: readonly LatLng[];
};

// ===== Owner / ABN =====

export type AbnStatus = "Active" | "Cancelled" | "Suspended";

export type PreviousOwner = { readonly name: string; readonly period: string };

export type Owner = {
  readonly ownerId: string;
  readonly name: string;
  readonly abn: string | null;
  /** Undefined means "ABN status not yet looked up", not "Active by default". */
  readonly abnStatus?: AbnStatus;
  readonly postalAddress: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly ownerSince: string;
  readonly previousOwners: readonly PreviousOwner[];
};

// ===== Transaction history =====

export type TransactionType =
  | "Rates Levy"
  | "Payment"
  | "Adjustment"
  | "Penalty Interest";

export type Transaction = {
  readonly date: string;
  readonly type: TransactionType;
  /** Signed AUD: positive = charge, negative = credit / payment. */
  readonly amount: number;
  readonly reference: string;
  /** Running balance after this transaction was applied. */
  readonly balance: number;
};

// ===== Mining tenement (DMIRS / state mining registers) =====

export type TenementType = "M" | "E" | "P" | "G" | "L";
export type TenementStatus = "Live" | "Pending" | "Surrendered" | "Cancelled";

export type Tenement = {
  readonly tenementId: string;
  readonly type: TenementType;
  readonly status: TenementStatus;
  readonly holder: string;
  readonly holderAbn: string | null;
  readonly commodity: readonly string[];
  readonly grantedDate: string;
  readonly expiryDate: string;
  readonly areaHectares: number;
  /** Assessment numbers this tenement intersects. Maintained by the spatial layer. */
  readonly intersectsAssessmentNumbers: readonly string[];
  readonly isProducing: boolean;
  readonly lastWorkProgramYear: number | null;
  /** Leaflet-order polygon. Real polygons come from DMIRS WFS GetFeature. */
  readonly polygon: readonly LatLng[];
};

// ===== Detection signals =====

export type SignalCategory =
  | "register"
  | "aerial"
  | "identity"
  | "spatial"
  | "behavioural"
  | "corporate";

/**
 * A signal definition — what the detector is looking for, what it weighs,
 * what its authoritative source is. Defined statically per the catalogue.
 */
export type SignalDef = {
  readonly id: string;
  readonly name: string;
  readonly short: string;
  readonly category: SignalCategory;
  /** Score contribution when this signal fires (0..1). */
  readonly weight: number;
  readonly description: string;
  readonly source: string;
  /**
   * Mutually-exclusive group identifier. Among signals sharing a group,
   * only the highest-weighted firing signal contributes to the composite.
   */
  readonly exclusiveGroup?: string;
};

/** A signal that has fired against a property, with its evidence. */
export type SignalHit = Pick<
  SignalDef,
  "id" | "name" | "short" | "category" | "weight" | "source"
> & {
  readonly evidence: string;
};

export type MismatchSeverity = "high" | "medium" | "low";

/**
 * A property identified as potentially mis-rated, with full audit trail.
 *
 * Critical: `estArrears3y` is THREE years' arrears, conservatively estimated
 * within the WA LGA s.6.81 5-year backdating limit. It is NOT five years.
 */
export type MismatchCandidate = {
  readonly assessmentNumber: string;
  readonly property: Property;
  readonly tenements: readonly Tenement[];
  readonly kind: string;
  readonly severity: MismatchSeverity;
  readonly reason: string;
  readonly estAnnualRatesNew: number;
  readonly estUplift: number;
  /** Three-year conservative arrears estimate within statutory backdating limits. */
  readonly estArrears3y: number;
  /** Composite confidence 0..1 — sum of fired signal weights, capped, with exclusive groups enforced. */
  readonly compositeScore: number;
  /** Alias of compositeScore for backward compatibility; prefer compositeScore. */
  readonly confidence: number;
  readonly signals: readonly SignalHit[];
};

// ===== Communications drafting =====

export type CommunicationTone = "friendly" | "firm" | "final";

export type ReminderDraft = {
  readonly assessmentNumber: string;
  readonly recipient: string;
  readonly recipientPhone: string | null;
  readonly recipientEmail: string | null;
  readonly tone: CommunicationTone;
  readonly subject: string;
  readonly body: string;
  /**
   * Always false at draft time. Adapters MUST refuse to send communications
   * unless an explicit, separately-authenticated commit call follows the
   * preview. The system never auto-sends.
   */
  readonly committed: false;
};

// ===== Audit log =====

export type AuditEventCategory =
  | "lookup"
  | "write"
  | "comms"
  | "recovery"
  | "system"
  | "auth";

/**
 * Every read and write produces an audit event. Append-only, tamper-evident,
 * retained 7 years per state records legislation. Adapters emit these; the
 * audit-log infrastructure (in @ratesassist/db) persists them.
 */
export type AuditEvent = {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly userRole: string;
  readonly timestamp: string;
  readonly category: AuditEventCategory;
  readonly action: string;
  readonly target?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly resultHash?: string;
  readonly correlationId?: string;
  readonly ipAddress?: string;
  readonly conversationId?: string;
};

// ===== Adapter capability + metadata =====

/**
 * Capabilities that a concrete adapter declares it supports. Capabilities
 * MUST match the contract — adapters do not invent new capability strings.
 */
export type AdapterCapability =
  | "read.property"
  | "read.owner"
  | "read.transactions"
  | "read.list_overdue"
  | "write.update_owner_contact"
  | "write.add_property_note"
  | "write.payment_arrangement"
  | "write.pensioner_rebate"
  | "write.address_change"
  | "generate.statutory_certificate";

/**
 * Identifying metadata an adapter exposes during connection so that the
 * web app and the audit log can record which adapter and version handled
 * the request.
 */
export type AdapterIdentity = {
  /** Stable adapter identifier, e.g. "techone-cianywhere", "civica-authority", "demo". */
  readonly id: string;
  readonly name: string;
  readonly vendor: string;
  /** Semver of the adapter implementation. */
  readonly version: string;
  /** Semver of the @ratesassist/contract this adapter was built against. */
  readonly contractVersion: string;
  readonly capabilities: readonly AdapterCapability[];
};
