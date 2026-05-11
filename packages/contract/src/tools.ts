/**
 * @ratesassist/contract — canonical tool catalogue
 *
 * The exhaustive list of tools every RatesAssist adapter exposes via MCP.
 * Adapters MAY return error code "forbidden" for tools they don't yet
 * implement, but they MUST advertise the full catalogue so the consuming
 * web app can render a consistent UI.
 *
 * The shape conforms to the MCP spec's tool definition: `{ name, description,
 * inputSchema (JSON Schema) }`. Built dynamically from the Zod schemas in
 * `./schemas.ts` to guarantee schema and runtime validation never drift.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { inputs } from "./schemas.js";

export type ToolDefinition = {
  /** MCP tool name. Stable across adapter versions. */
  readonly name: string;
  /** Human-readable description used by LLM tool selection. */
  readonly description: string;
  /** JSON Schema for the tool's input. Generated from Zod. */
  readonly inputSchema: unknown;
};

const descriptions: Record<keyof typeof inputs, string> = {
  search_property:
    "Search properties by address fragment, suburb, postcode, or assessment number across the active tenant's portfolio.",
  search_by_owner:
    "Find properties by owner name (partial OK). Optional suburb filter.",
  get_property_detail:
    "Full record for one property — owner(s), valuation, balance, payment status, notes, intersecting tenements.",
  get_transaction_history:
    "Transaction history (levies, payments, adjustments, interest) for a property.",
  list_overdue:
    "List all properties with an outstanding rates balance.",
  list_properties:
    "Paginated property listing for the active tenant.",
  list_councils:
    "List councils accessible in the current session.",
  get_owner:
    "Get an owner record by ID, including ABN status if known.",
  draft_payment_reminder:
    "Draft a personalised payment reminder. Returns the draft only — does NOT send.",
  draft_chase_all_overdue:
    "Draft personalised reminders for all overdue properties not on a payment arrangement. Batch preview only — does NOT send.",
  update_owner_contact:
    "Update an owner's phone and/or email. Two-phase: first call returns preview + commit token; second call (confirm=true with token) actually applies. Never auto-commits.",
  add_property_note:
    "Add a note to a property's record. Two-phase: first call returns preview + commit token; second call applies.",
  generate_statutory_certificate:
    "Produce a state-specific statutory rates certificate (WA s.6.76, NSW s.603, QLD s.95) for a property.",
  get_tenement_for_property:
    "Look up mining tenements that intersect a specific property assessment.",
  find_mining_mismatches:
    "Cross-reference rated properties against active mining tenements and surface candidates whose rating classification appears mis-aligned with actual land use. Returns ranked list with composite confidence and estimated annual uplift.",
  generate_evidence_pack:
    "Produce a council-grade reclassification evidence pack for a mining-mismatch candidate. Includes property record, signal trail, statutory basis, draft notice text, and audit trail.",
  recovery_summary:
    "Aggregate recovery position: count and dollar value of candidates by severity, total estimated uplift and arrears.",
  daily_briefing:
    "Morning briefing for a rates officer: overdue, recovery candidates, action items.",
  verify_abn:
    "Verify an Australian Business Number via the ATO public ABN Lookup API. Returns entity name, status, type, GST registration.",
  list_recent_grants:
    "List recently-granted live mining tenements (DMIRS via SLIP). The headline sales-trigger event: a fresh LIVE grant on a parcel currently rated rural/vacant lawfully unlocks a higher rate category. Returns typed grant records with MINEDEX deep-links and provisional-status flags for the 30-day appeal window.",
  get_grant_detail:
    "Full briefing for a single recently-granted tenement: tenement metadata, geometry, intersecting council-registered parcels, and an estimated rates uplift per affected parcel. Powers the /alerts/[tenementId] detail page.",
  list_lag_window_candidates:
    "Find parcels where a live DMIRS tenement has been granted but the public WA landuse classification (Landgate / DPIRD) still reflects the pre-mining state. The headline cross-register signal — the cadastre-lag window is the highest-confidence recovery opportunity available before any council audit cycle.",
  add_council:
    "Register a new council (tenant) on the platform. Two-phase: first call returns preview + commit token; second call (confirm=true with token) actually applies. Requires write.user_management. Refuses if the code already exists.",
  list_address_discrepancies:
    "Find parcels where the Landgate cadastre carries a different address, lot/plan, or landuse code from the council's rating record. Each entry is a mis-rated parcel until reconciled — covers residential renumbering, sub-divisions, landuse reclassifications, lot/plan amendments, and rural-to-industrial reuse. Powers the headline 'address mismatch' signal alongside the cadastre-lag signal.",
  import_rating_roll:
    "Import a TechOne rating-roll CSV for a council. Two-phase: first call returns a preview (row count, error list, commit token); second call (confirm=true with token) applies the merge. mergeStrategy=replace wipes the council's properties before insert; upsert matches by assessmentNumber. Materialises owner records from the rows. Requires write.user_management.",
  list_environmental_approvals:
    "List DMIRS EMITS environmental approvals (Mining Proposals, Programmes of Work, Mine Management Plans) for a tenement. EMITS has no public machine-readable export today — results are seeded fixtures filtered by tenement id and active-flag, labelled source=seeded. Powers the environmental-approval recovery signal that compounds with cadastre lag.",
  list_audit_log:
    "List recent audit-log entries for a tenant. Supervisor-and-above only (read.audit_log permission). Returns the most recent entries newest-first; supports tenantId, limit, and since (ISO-8601) filters.",
  verify_audit_chain:
    "Verify the tamper-evident hash chain for a tenant's audit log. Walks the most recent N rows in chain order, recomputes each rowHash and reports the first break (if any). Supervisor-and-above only (read.audit_log permission).",
  notify_clerk:
    "Send an email to a council clerk about a recovery candidate. Provider depends on environment: console-logged by default; live Resend send when RA_NOTIFY_PROVIDER=resend and RA_NOTIFY_API_KEY are set. Audit-logged in either case.",
};

/**
 * Build the canonical tool catalogue. Called once at adapter startup.
 * Returns the full set of tools every adapter must advertise.
 */
export function buildToolCatalogue(): readonly ToolDefinition[] {
  return Object.entries(inputs).map(([name, schema]) => ({
    name,
    description: descriptions[name as keyof typeof inputs],
    inputSchema: zodToJsonSchema(schema, { target: "openApi3" }),
  }));
}

export type ToolName = keyof typeof inputs;
