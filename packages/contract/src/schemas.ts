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

// ===== Tool input schemas (every adapter's tool MUST accept these) =====

export const inputs = {
  search_property: z.object({
    query: z.string().min(1).max(200),
  }),

  search_by_owner: z.object({
    name: z.string().min(1).max(200),
    suburb: z.string().max(80).optional(),
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

  list_councils: z.object({}).strict(),

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
]);

export const adapterIdentity = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  vendor: z.string().min(1).max(200),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  contractVersion: z.string().regex(/^\d+\.\d+\.\d+/),
  capabilities: z.array(adapterCapability),
});
