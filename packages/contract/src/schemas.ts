/**
 * @ratesassist/contract — runtime schemas
 *
 * Zod schemas for every tool's input and output. Validated at every
 * adapter boundary: incoming tool calls are parsed before dispatch;
 * outgoing tool results are parsed before returning to the client.
 *
 * This is what makes "preview-then-confirm" guarantees enforceable in
 * production — schemas reject malformed inputs at the protocol layer
 * before any business logic or LLM-generated text reaches a handler.
 */

import { z } from "zod";

// ===== Reusable primitives =====

export const tone = z.enum(["friendly", "firm", "final"]);
export const severity = z.enum(["high", "medium", "low"]);
export const australianState = z.enum(["WA", "NSW", "VIC", "QLD", "SA", "TAS", "ACT", "NT"]);

const assessmentNumber = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/i, "assessment numbers are alphanumeric with dashes");

const councilCode = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[A-Z]+$/);

const abn = z.string().regex(/^\d[\d\s]{9,}\d$/, "ABN must be 11 digits with optional spaces");

// ===== Cadastre / title primitives (VEN + CT + Concession feature) =====
//
// Each domain type in ./types.ts has a corresponding Zod schema below. All
// schemas use `.strict()` to reject unknown fields at adapter boundaries.

/**
 * GeoJSON geometry subset accepted in cadastral payloads. Mirrors the
 * `GeoJsonGeometry` type in `./types.ts`.
 */
export const geoJsonGeometry = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.array(z.number()))),
    })
    .strict(),
  z
    .object({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(z.array(z.array(z.array(z.number())))),
    })
    .strict(),
  z
    .object({
      type: z.literal("Point"),
      coordinates: z.array(z.number()),
    })
    .strict(),
]);

export const pinSchema = z
  .object({
    pin: z.string().min(1).max(40),
    lotPlan: z.string().min(1).max(120),
    landuseCode: z.string().min(1).max(40),
    areaSquareMetres: z.number().nonnegative().finite(),
    geometry: geoJsonGeometry.optional(),
    councilCode: z
      .string()
      .regex(/^[A-Z]{2,5}$/, "2-5 uppercase letters")
      .optional(),
  })
  .strict();

export const encumbranceType = z.enum([
  "mortgage",
  "easement",
  "caveat",
  "tenement_notation",
  "covenant",
  "other",
]);

export const encumbranceSchema = z
  .object({
    type: encumbranceType,
    reference: z.string().min(1).max(120),
    date: z.string().min(1).max(40),
    source: z.string().min(1).max(80),
  })
  .strict();

export const waterCorpEligibilityStatus = z.enum([
  "active",
  "cancelled",
  "expired",
  "deceased",
  "unknown",
]);

export const pensionerConcessionType = z.enum([
  "pensioner",
  "first_home",
  "senior",
  "veteran",
]);

export const pensionerConcessionSchema = z
  .object({
    applied: z.boolean(),
    type: pensionerConcessionType,
    appliedAt: z.string().min(1).max(40),
    cardNumber: z.string().min(1).max(80).optional(),
    cardExpiry: z.string().min(1).max(40).optional(),
    wcEligibilityVerifiedAt: z.string().datetime().optional(),
    wcEligibilityStatus: waterCorpEligibilityStatus.optional(),
    wcCancellationReason: z.string().min(1).max(200).optional(),
    wcCancellationDate: z.string().min(1).max(40).optional(),
  })
  .strict();

export const titleSourceTier = z.enum([
  "wc_feed",
  "landgate_restricted",
  "slip",
  "council_uploaded_pdf",
  "map_viewer_plus",
]);

export const titleSourceFreshnessSchema = z
  .object({
    source: titleSourceTier,
    retrievedAt: z.string().datetime(),
    lagWarning: z.string().min(1).max(200).optional(),
  })
  .strict();

export const strataChildSchema = z
  .object({
    volume: z.string().min(1).max(40),
    folio: z.string().min(1).max(40),
  })
  .strict();

// ===== Tool input schemas (every adapter's tool MUST accept these) =====

export const inputs = {
  search_property: z.object({
    query: z.string().min(1).max(200),
    /**
     * Tenant scope. Restricts the search to one council's portfolio. The
     * web layer injects the caller's tenant for non-admins (cross-tenant
     * read IDOR fix) and leaves it for platform_admin. Omitted → all
     * councils (admin / single-tenant deployment).
     */
    council: councilCode.optional(),
  }),

  search_by_owner: z.object({
    name: z.string().min(1).max(200),
    suburb: z.string().max(80).optional(),
    /** Tenant scope — see `search_property.council`. */
    council: councilCode.optional(),
  }),

  get_property_detail: z.object({
    assessmentNumber,
  }),

  get_transaction_history: z.object({
    assessmentNumber,
  }),

  list_overdue: z.object({
    council: councilCode.optional(),
    minDaysOverdue: z.number().int().min(0).max(3650).optional(),
  }),

  list_properties: z.object({
    council: councilCode.optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().min(0).optional(),
  }),

  list_councils: z
    .object({
      /**
       * Tenant scope. The platform's council set is the commercially
       * sensitive customer base — a non-admin must see only their own
       * council. The web layer injects the caller's tenant for non-admins
       * and leaves it for platform_admin. Omitted → all councils.
       */
      council: councilCode.optional(),
    })
    .strict(),

  get_owner: z.object({
    ownerId: z.string().min(1).max(80),
  }),

  draft_payment_reminder: z.object({
    assessmentNumber,
    tone: tone.default("friendly"),
  }),

  draft_chase_all_overdue: z.object({
    tone: tone.default("friendly"),
    council: councilCode.optional(),
  }),

  update_owner_contact: z
    .object({
      ownerId: z.string().min(1).max(80),
      newPhone: z.string().min(6).max(40).optional(),
      newEmail: z.string().email().max(200).optional(),
      /**
       * Two-phase commit. First call with confirm=false returns a preview
       * + a server-issued commit token. Second call with confirm=true and
       * the token actually applies the change.
       */
      confirm: z.boolean().default(false),
      commitToken: z.string().optional(),
    })
    .refine(
      (v) => v.newPhone !== undefined || v.newEmail !== undefined,
      "must provide newPhone and/or newEmail",
    ),

  add_property_note: z.object({
    assessmentNumber,
    note: z.string().min(1).max(4000),
    confirm: z.boolean().default(false),
    commitToken: z.string().optional(),
  }),

  generate_statutory_certificate: z.object({
    assessmentNumber,
    /** State-specific certificate type, e.g. "WA-6.76", "NSW-603", "QLD-95". */
    certificateType: z.string().min(2).max(40),
    requesterName: z.string().min(1).max(200),
    requesterEmail: z.string().email().max(200),
  }),

  get_tenement_for_property: z.object({
    assessmentNumber,
  }),

  find_mining_mismatches: z.object({
    council: councilCode.optional(),
    minSeverity: severity.optional(),
  }),

  generate_evidence_pack: z.object({
    assessmentNumber,
  }),

  recovery_summary: z.object({
    council: councilCode.optional(),
  }),

  daily_briefing: z.object({
    council: councilCode.optional(),
  }),

  verify_abn: z.object({
    abn,
  }),

  list_recent_grants: z.object({
    /** LGA name filter (case-insensitive substring). Optional. */
    lgaName: z.string().min(1).max(120).optional(),
    /** Lookback window in days. Default 30, max 365. */
    sinceDays: z.number().int().min(1).max(365).default(30),
    /** Optional type-code allow-list, e.g. ["M","G","L"]. */
    types: z.array(z.string().min(1).max(4)).max(10).optional(),
  }),

  get_grant_detail: z.object({
    /** Raw tenement id (e.g. `M  4701569`) — unencoded. */
    tenementId: z.string().min(3).max(40),
    /** Lookback window in days for resolving the tenement against the grants feed. */
    sinceDays: z.number().int().min(1).max(365).default(90),
    /**
     * Tenant scope for the intersecting-parcel join. The tenement metadata
     * is public (DMIRS/MINEDEX), but the intersecting council-registered
     * parcels carry valuation / annual rates / recovery uplift — commercially
     * sensitive per-council data. Restricts parcels to one council. The web
     * layer injects the caller's tenant for non-admins (cross-tenant read
     * IDOR fix) and leaves it for platform_admin. Omitted → all councils.
     */
    council: councilCode.optional(),
  }),

  list_lag_window_candidates: z.object({
    /** LGA name filter (case-insensitive substring). Optional hint. */
    lgaName: z.string().min(1).max(120).optional(),
    /** Lookback window in days. Default 90, max 365. */
    sinceDays: z.number().int().min(1).max(365).default(90),
    /** Minimum severity to surface. Default medium (low is officer-review). */
    minSeverity: z.enum(["high", "medium", "low"]).default("medium"),
  }).strict(),

  add_council: z
    .object({
      code: z
        .string()
        .regex(/^[A-Z]{2,5}$/, "2-5 uppercase letters"),
      name: z.string().min(3).max(120),
      /**
       * Locked to "WA" for the current product scope. The full
       * `australianState` enum remains in the contract for the domain
       * model (Property.state, Council.state) so the multi-state fixture
       * survives; only the council-registration surface is gated. See
       * `./constants.ts` and internal/LANDGATE-ACCESS.md for the
       * inter-state-expansion upgrade path — flip this back to
       * `australianState` when ready.
       */
      state: z.literal("WA"),
      centerLat: z.number().min(-45).max(-9),
      centerLng: z.number().min(110).max(156),
      population: z.number().int().min(0),
      rateableProperties: z.number().int().min(0),
      rateRevenue: z.number().min(0),
      /**
       * Two-phase commit. First call with confirm=false returns a preview
       * + a server-issued commit token. Second call with confirm=true and
       * the token actually applies the change.
       */
      confirm: z.boolean().default(false),
      commitToken: z.string().uuid().optional(),
    })
    .strict(),

  list_address_discrepancies: z
    .object({
      /** Kind filter: "all" returns every classified discrepancy. */
      kind: z
        .enum([
          "address_renumber",
          "subdivision",
          "landuse_reclass",
          "industrial_reuse",
          "lot_plan_amend",
          "all",
        ])
        .default("all"),
      /**
       * Minimum severity. Default "medium" mirrors `list_lag_window_candidates`
       * — low-severity entries are officer-review only and would noise up
       * the recovery dashboard.
       */
      minSeverity: z.enum(["high", "medium", "low"]).default("medium"),
      /**
       * Tenant scope. Each discrepancy is keyed to an assessment number that
       * embeds its owning council (e.g. `KAL-7777-01`), so the unscoped set
       * leaks other councils' mis-rated parcels + recovery reasoning. The web
       * layer injects the caller's tenant for non-admins (cross-tenant read
       * IDOR fix) and leaves it for platform_admin. Omitted → all councils.
       */
      council: councilCode.optional(),
    })
    .strict(),

  import_rating_roll: z
    .object({
      councilCode: z.string().regex(/^[A-Z]{2,5}$/, "2-5 uppercase letters"),
      /** Raw CSV text. Hard cap 10MB to match the route-layer body cap. */
      csvText: z.string().min(50).max(10_000_000),
      mergeStrategy: z.enum(["replace", "upsert"]).default("upsert"),
      confirm: z.boolean().default(false),
      commitToken: z.string().uuid().optional(),
    })
    .strict(),

  list_environmental_approvals: z
    .object({
      /** Raw DMIRS tenement id (letter + 2 spaces + 7 digits). Optional — omit to list all. */
      tenementId: z.string().min(3).max(40).optional(),
      /** When true (default) return only active approvals. */
      active: z.boolean().default(true),
    })
    .strict(),

  list_audit_log: z.object({
    /** Tenant scope. Defaults to the caller's tenant when omitted. */
    tenantId: z.string().min(1).max(80).optional(),
    /** Page size; clamped to [1, 500]. */
    limit: z.number().int().min(1).max(500).default(50),
    /** ISO-8601 floor; only entries at-or-after this instant are returned. */
    since: z.string().datetime().optional(),
  }),

  verify_audit_chain: z
    .object({
      /** Tenant scope. Defaults to the caller's tenant when omitted. Cross-tenant: platform_admin only. */
      tenantId: z.string().min(1).max(80).optional(),
      /** How many of the most-recent rows to verify (chain-ordered). */
      limit: z.number().int().min(1).max(10_000).default(1000),
    })
    .strict(),

  notify_clerk: z
    .object({
      /** Recipient email — typically a council clerk or duty officer. */
      recipientEmail: z.string().email().max(200),
      /** Email subject; rendered verbatim by the transport. */
      subject: z.string().min(3).max(200),
      /** The recovery candidate this notification is about. */
      candidateAssessmentNumber: z
        .string()
        .min(3)
        .max(40)
        .regex(/^[A-Z0-9][A-Z0-9-]*$/i, "assessment numbers are alphanumeric with dashes"),
      /** Surfaced in the email body and used for routing/styling. */
      severity: severity.default("medium"),
    })
    .strict(),

  // ===== VEN + CT + Concession feature: CSV imports + strata lifecycle =====

  import_rate_schedule: z
    .object({
      councilCode: z.string().regex(/^[A-Z]{2,5}$/, "2-5 uppercase letters"),
      /** Financial year in `YYYY-YY` form, e.g. "2025-26". */
      financialYear: z.string().regex(/^\d{4}-\d{2}$/, "format YYYY-YY"),
      /** Raw CSV text. Hard cap 10MB to match the route-layer body cap. */
      csvText: z.string().min(50).max(10_000_000),
      mergeStrategy: z.enum(["replace", "upsert"]).default("upsert"),
      confirm: z.boolean().default(false),
      commitToken: z.string().uuid().optional(),
    })
    .strict(),

  import_landgate_title_data: z
    .object({
      councilCode: z.string().regex(/^[A-Z]{2,5}$/, "2-5 uppercase letters"),
      /** Raw CSV text. Hard cap 10MB to match the route-layer body cap. */
      csvText: z.string().min(50).max(10_000_000),
      /**
       * Which Landgate tier the data came from. Drives the freshness label
       * stamped onto every imported title row. `map_viewer_plus` is NOT
       * acceptable as an import source (UI-only fallback) and so is omitted.
       */
      sourceTier: z
        .enum([
          "wc_feed",
          "landgate_restricted",
          "slip",
          "council_uploaded_pdf",
        ])
        .default("council_uploaded_pdf"),
      /** ISO-8601 timestamp the data was retrieved from Landgate. */
      retrievedAt: z.string().datetime().optional(),
      confirm: z.boolean().default(false),
      commitToken: z.string().uuid().optional(),
    })
    .strict(),

  import_wc_eligibility: z
    .object({
      councilCode: z.string().regex(/^[A-Z]{2,5}$/, "2-5 uppercase letters"),
      /** Raw CSV text. Hard cap 10MB to match the route-layer body cap. */
      csvText: z.string().min(50).max(10_000_000),
      /** ISO-8601 timestamp the eligibility extract was retrieved from Water Corp. */
      retrievedAt: z.string().datetime().optional(),
      confirm: z.boolean().default(false),
      commitToken: z.string().uuid().optional(),
    })
    .strict(),

  request_strata_conversion: z
    .object({
      parentAssessmentNumber: z.string().min(1).max(40),
      /**
       * Target state in the strata-conversion state machine. The handler
       * (Round 2) enforces ordering: cannot skip states.
       */
      toState: z.enum([
        "strata_plan_uploaded",
        "children_previewed",
        "children_imported",
        "parent_superseded",
        "withdrawn",
      ]),
      childCts: z
        .array(
          z
            .object({
              volume: z.string().min(1).max(40),
              folio: z.string().min(1).max(40),
              ven: z.string().min(1).max(40).optional(),
              address: z.string().min(1).max(200).optional(),
            })
            .strict(),
        )
        .optional(),
      reason: z.string().min(1).max(500).optional(),
      confirm: z.boolean().default(false),
      commitToken: z.string().uuid().optional(),
    })
    .strict(),
} as const;

export type ToolInputs = {
  [K in keyof typeof inputs]: z.infer<(typeof inputs)[K]>;
};

// ===== Tool result schema (uniform across adapters) =====

/**
 * Every tool returns either a successful result or a structured error.
 * Free-form `output` (string) is the human-readable response that the LLM
 * narrates. Structured `data` is for client-side rendering.
 */
export const toolResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    output: z.string(),
    /** Optional structured payload for the client to render rich UI. */
    data: z.unknown().optional(),
    /** Optional commit token for two-phase mutating operations. */
    commitToken: z.string().optional(),
    /** Whether this tool call mutated state. False for read-only tools and previews. */
    mutated: z.boolean().default(false),
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
      "commit_token_invalid",
      "commit_token_expired",
      "rate_limited",
      "upstream_error",
      "timeout",
      "internal_error",
    ]),
    correlationId: z.string().optional(),
    retryable: z.boolean().default(false),
  }),
]);

export type ToolResult = z.infer<typeof toolResult>;

// ===== Adapter identity schema =====

export const adapterCapability = z.enum([
  "read.property",
  "read.owner",
  "read.transactions",
  "read.list_overdue",
  "write.update_owner_contact",
  "write.add_property_note",
  "write.payment_arrangement",
  "write.pensioner_rebate",
  "write.address_change",
  "generate.statutory_certificate",
  "write.user_management",
]);

export const adapterIdentity = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  vendor: z.string().min(1).max(200),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  contractVersion: z.string().regex(/^\d+\.\d+\.\d+/),
  capabilities: z.array(adapterCapability),
});
