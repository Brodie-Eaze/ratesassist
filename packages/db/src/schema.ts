/**
 * @ratesassist/db — Drizzle schema.
 *
 * Tables mirror @ratesassist/contract domain types. Multi-tenant isolation
 * is enforced via Postgres Row-Level Security (see migrations/0001_init.sql).
 * Spatial geometry is staged as JSONB GeoJSON; PostGIS upgrade is Phase 3.
 *
 * Classification per field is documented in /DATA-CLASSIFICATION.md at repo
 * root. OFFICIAL:Sensitive columns (owner contact, transaction amounts,
 * property balance/notes) are encryption-at-rest mandatory at the cluster
 * level; column-level pgcrypto envelopes are added in Phase 3.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ===== Enums =====

export const australianStateEnum = pgEnum("australian_state", [
  "WA",
  "NSW",
  "VIC",
  "QLD",
  "SA",
  "TAS",
  "ACT",
  "NT",
]);

export const landUseEnum = pgEnum("land_use", [
  "Residential",
  "Commercial",
  "Industrial",
  "Rural",
  "Vacant",
  "Mining",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "Direct Debit",
  "BPAY",
  "Counter",
  "Mail",
]);

export const abnStatusEnum = pgEnum("abn_status", [
  "Active",
  "Cancelled",
  "Suspended",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "Rates Levy",
  "Payment",
  "Adjustment",
  "Penalty Interest",
]);

export const tenementTypeEnum = pgEnum("tenement_type", [
  "M",
  "E",
  "P",
  "G",
  "L",
]);

export const tenementStatusEnum = pgEnum("tenement_status", [
  "Live",
  "Pending",
  "Surrendered",
  "Cancelled",
]);

export const mismatchSeverityEnum = pgEnum("mismatch_severity", [
  "high",
  "medium",
  "low",
]);

export const actorKindEnum = pgEnum("actor_kind", [
  "user",
  "service",
  "llm",
]);

// ===== Tenants (councils) =====

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    state: australianStateEnum("state").notNull(),
    centerLat: doublePrecision("center_lat").notNull(),
    centerLng: doublePrecision("center_lng").notNull(),
    population: integer("population").notNull(),
    rateableProperties: integer("rateable_properties").notNull(),
    rateRevenue: numeric("rate_revenue", { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    codeUnique: uniqueIndex("tenants_code_unique").on(t.code),
  }),
);

export type TenantInsert = typeof tenants.$inferInsert;
export type TenantSelect = typeof tenants.$inferSelect;

// ===== Properties =====

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    assessmentNumber: text("assessment_number").notNull(),
    address: text("address").notNull(),
    suburb: text("suburb").notNull(),
    postcode: text("postcode").notNull(),
    state: australianStateEnum("state").notNull(),
    landUse: landUseEnum("land_use").notNull(),
    valuation: numeric("valuation", { precision: 18, scale: 2 }).notNull(),
    annualRates: numeric("annual_rates", { precision: 18, scale: 2 }).notNull(),
    balance: numeric("balance", { precision: 18, scale: 2 }).notNull(),
    lastPaymentDate: timestamp("last_payment_date", { withTimezone: true }),
    lastPaymentAmount: numeric("last_payment_amount", {
      precision: 18,
      scale: 2,
    }),
    paymentMethod: paymentMethodEnum("payment_method"),
    pensionerRebate: boolean("pensioner_rebate").notNull().default(false),
    paymentArrangement: boolean("payment_arrangement").notNull().default(false),
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    centroidLat: doublePrecision("centroid_lat").notNull(),
    centroidLng: doublePrecision("centroid_lng").notNull(),
    /** GeoJSON geometry (Polygon). PostGIS migration scheduled Phase 3. */
    parcel: jsonb("parcel").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    tenantAssessmentUnique: uniqueIndex("properties_tenant_assessment_unique").on(
      t.tenantId,
      t.assessmentNumber,
    ),
    tenantIdx: index("properties_tenant_idx").on(t.tenantId),
  }),
);

export type PropertyInsert = typeof properties.$inferInsert;
export type PropertySelect = typeof properties.$inferSelect;

// ===== Owners =====

export const owners = pgTable(
  "owners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    ownerExtId: text("owner_ext_id").notNull(),
    name: text("name").notNull(),
    abn: text("abn"),
    abnStatus: abnStatusEnum("abn_status"),
    abnCheckedAt: timestamp("abn_checked_at", { withTimezone: true }),
    postalAddress: text("postal_address").notNull(),
    email: text("email"),
    phone: text("phone"),
    ownerSince: text("owner_since").notNull(),
    previousOwners: jsonb("previous_owners")
      .$type<{ name: string; period: string }[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    tenantExtIdUnique: uniqueIndex("owners_tenant_ext_id_unique").on(
      t.tenantId,
      t.ownerExtId,
    ),
    tenantIdx: index("owners_tenant_idx").on(t.tenantId),
  }),
);

export type OwnerInsert = typeof owners.$inferInsert;
export type OwnerSelect = typeof owners.$inferSelect;

// ===== Property ↔ Owner join =====

export const propertyOwners = pgTable(
  "property_owners",
  {
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.propertyId, t.ownerId] }),
  }),
);

export type PropertyOwnerInsert = typeof propertyOwners.$inferInsert;
export type PropertyOwnerSelect = typeof propertyOwners.$inferSelect;

// ===== Tenements (mining registers) =====

export const tenements = pgTable("tenements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenementId: text("tenement_id").notNull(),
  type: tenementTypeEnum("type").notNull(),
  status: tenementStatusEnum("status").notNull(),
  holder: text("holder").notNull(),
  holderAbn: text("holder_abn"),
  commodity: jsonb("commodity").$type<string[]>().notNull().default([]),
  grantedDate: text("granted_date").notNull(),
  expiryDate: text("expiry_date").notNull(),
  areaHectares: doublePrecision("area_hectares").notNull(),
  intersectsAssessmentNumbers: jsonb("intersects_assessment_numbers")
    .$type<string[]>()
    .notNull()
    .default([]),
  isProducing: boolean("is_producing").notNull().default(false),
  lastWorkProgramYear: integer("last_work_program_year"),
  /** GeoJSON Polygon. PostGIS migration scheduled Phase 3. */
  polygon: jsonb("polygon").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type TenementInsert = typeof tenements.$inferInsert;
export type TenementSelect = typeof tenements.$inferSelect;

// ===== Tenement ↔ Property join =====

export const tenementProperties = pgTable(
  "tenement_properties",
  {
    tenementId: uuid("tenement_id")
      .notNull()
      .references(() => tenements.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenementId, t.propertyId] }),
  }),
);

export type TenementPropertyInsert = typeof tenementProperties.$inferInsert;
export type TenementPropertySelect = typeof tenementProperties.$inferSelect;

// ===== Transactions =====

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    date: timestamp("date", { withTimezone: true }).notNull(),
    type: transactionTypeEnum("type").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    reference: text("reference").notNull(),
    runningBalance: numeric("running_balance", {
      precision: 18,
      scale: 2,
    }).notNull(),
  },
  (t) => ({
    tenantPropertyIdx: index("transactions_tenant_property_idx").on(
      t.tenantId,
      t.propertyId,
    ),
  }),
);

export type TransactionInsert = typeof transactions.$inferInsert;
export type TransactionSelect = typeof transactions.$inferSelect;

// ===== Signal hits =====

export const signalHits = pgTable(
  "signal_hits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    signalId: text("signal_id").notNull(),
    weight: doublePrecision("weight").notNull(),
    evidence: text("evidence").notNull(),
    firedAt: timestamp("fired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantPropertyIdx: index("signal_hits_tenant_property_idx").on(
      t.tenantId,
      t.propertyId,
    ),
  }),
);

export type SignalHitInsert = typeof signalHits.$inferInsert;
export type SignalHitSelect = typeof signalHits.$inferSelect;

// ===== Mismatch candidates =====

export const mismatchCandidates = pgTable(
  "mismatch_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    severity: mismatchSeverityEnum("severity").notNull(),
    reason: text("reason").notNull(),
    estAnnualRatesNew: numeric("est_annual_rates_new", {
      precision: 18,
      scale: 2,
    }).notNull(),
    estUplift: numeric("est_uplift", { precision: 18, scale: 2 }).notNull(),
    estArrears3y: numeric("est_arrears_3y", {
      precision: 18,
      scale: 2,
    }).notNull(),
    compositeScore: doublePrecision("composite_score").notNull(),
    signalsJson: jsonb("signals_json").$type<unknown[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index("mismatch_candidates_tenant_idx").on(t.tenantId),
  }),
);

export type MismatchCandidateInsert = typeof mismatchCandidates.$inferInsert;
export type MismatchCandidateSelect = typeof mismatchCandidates.$inferSelect;

// ===== Audit log (append-only; UPDATE/DELETE revoked at SQL level) =====
//
// `prev_hash` / `row_hash` are the tamper-evident chain (Phase 9). Both
// columns are NULLABLE in this Drizzle schema because the 0002 migration
// adds them as nullable; 0003 flips to NOT NULL after backfill. Loading
// `audit_log_tenant_chain_idx` requires the chain order: (tenantId,
// occurredAt ASC, id ASC). The pre-existing `audit_log_tenant_occurred_idx`
// stays — it serves "newest N rows" UI reads (DESC).
//
// The partial unique index `audit_log_tenant_row_hash_unique` enforces no
// duplicate hashes per tenant on populated rows only — legacy rows carry the
// __PRE_CHAIN__ sentinel which would otherwise alias to itself.

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    actorId: text("actor_id").notNull(),
    actorKind: actorKindEnum("actor_kind").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    correlationId: text("correlation_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** sha256 hex of the previous row in this tenant's chain, or genesisHash for the first. */
    prevHash: text("prev_hash"),
    /** sha256(prevHash + canonical(this-row-without-hashes)). */
    rowHash: text("row_hash"),
  },
  (t) => ({
    tenantOccurredIdx: index("audit_log_tenant_occurred_idx").on(
      t.tenantId,
      sql`${t.occurredAt} DESC`,
    ),
    tenantChainIdx: index("audit_log_tenant_chain_idx").on(
      t.tenantId,
      t.occurredAt,
      t.id,
    ),
    tenantRowHashUnique: uniqueIndex("audit_log_tenant_row_hash_unique")
      .on(t.tenantId, t.rowHash)
      .where(sql`row_hash IS NOT NULL`),
  }),
);

export type AuditLogInsert = typeof auditLog.$inferInsert;
export type AuditLogSelect = typeof auditLog.$inferSelect;

// ===== Commit tokens =====

export const commitTokens = pgTable("commit_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "restrict" }),
  scope: text("scope").notNull(),
  payloadHash: text("payload_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CommitTokenInsert = typeof commitTokens.$inferInsert;
export type CommitTokenSelect = typeof commitTokens.$inferSelect;

// ===== API keys =====

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "restrict" }),
  label: text("label").notNull(),
  /** Argon2 hash of the API key — never store the plaintext token. */
  hash: text("hash").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type ApiKeyInsert = typeof apiKeys.$inferInsert;
export type ApiKeySelect = typeof apiKeys.$inferSelect;

// ===== Phase 3 stubs: users + sessions =====
// TODO(Phase 3): expand these once SSO + session model are designed.

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "restrict" }),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
});

export type UserInsert = typeof users.$inferInsert;
export type UserSelect = typeof users.$inferSelect;

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type SessionInsert = typeof sessions.$inferInsert;
export type SessionSelect = typeof sessions.$inferSelect;
