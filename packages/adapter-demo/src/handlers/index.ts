/**
 * Handler registry.
 *
 * The dispatcher uses this map to resolve a `ToolName` to its concrete
 * handler. Each handler is a pure async function that receives validated
 * input and a per-request context, and returns a `ToolResult` (success or
 * structured failure). Handlers never throw to the dispatcher under normal
 * operation; the dispatcher's catch-all converts any escapee into an
 * `internal_error` result.
 *
 * Adding a tool: define its input schema in `@ratesassist/contract`'s
 * `inputs`, register a description in the contract's `descriptions` map,
 * implement a handler here, and add the entry to {@link HANDLERS}.
 * TypeScript will surface every gap.
 */

import { schemas, type ToolName } from "@ratesassist/contract";

import type { RequestContext } from "../runtime/context.js";
import {
  searchPropertyHandler,
  searchByOwnerHandler,
} from "./search.js";
import {
  getPropertyDetailHandler,
  getTransactionHistoryHandler,
  listPropertiesHandler,
} from "./property.js";
import { getOwnerHandler } from "./owner.js";
import { listOverdueHandler } from "./overdue.js";
import {
  findMiningMismatchesHandler,
  generateEvidencePackHandler,
  recoverySummaryHandler,
  getTenementForPropertyHandler,
} from "./recovery.js";
import { dailyBriefingHandler } from "./briefing.js";
import {
  draftPaymentReminderHandler,
  draftChaseAllOverdueHandler,
} from "./communications.js";
import {
  updateOwnerContactHandler,
  addPropertyNoteHandler,
  generateStatutoryCertificateHandler,
} from "./workflows.js";
import {
  verifyAbnHandler,
  listCouncilsHandler,
} from "./identity.js";
import { listRecentGrantsHandler } from "./recentGrants.js";

/**
 * Generic handler signature. `Input` is the precise type for the matching
 * tool name; `ToolResult` is the contract's discriminated union.
 */
export type Handler<Input> = (
  input: Input,
  ctx: RequestContext,
) => Promise<schemas.ToolResult>;

/**
 * Registry of every tool handler, keyed by `ToolName`. Type-checked: a
 * missing entry is a TypeScript error.
 */
export const HANDLERS: {
  readonly [K in ToolName]: Handler<schemas.ToolInputs[K]>;
} = {
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
  verify_abn: verifyAbnHandler,
  list_recent_grants: listRecentGrantsHandler,
};
