/**
 * Workflow handlers — two-phase mutating tools and statutory certificate generation.
 *
 * The two mutating tools (`update_owner_contact`, `add_property_note`)
 * follow the preview-then-confirm protocol described in
 * `runtime/commitTokens.ts`. The shape is identical for both:
 *
 *   - First call: `confirm: false` ⇒ validate, capture the proposed
 *     change, return preview text + a server-issued `commitToken`.
 *   - Second call: `confirm: true` + matching `commitToken` ⇒ apply.
 *
 * The certificate handler is read-only but produces a consequential
 * artefact (a state-specific statutory document) so it lives alongside
 * the mutators in the same module.
 */
import type { schemas } from "@ratesassist/contract";
import type { RequestContext } from "../runtime/context.js";
/** `update_owner_contact` handler — two-phase mutation. */
export declare function updateOwnerContactHandler(input: schemas.ToolInputs["update_owner_contact"], ctx: RequestContext): Promise<schemas.ToolResult>;
/** `add_property_note` handler — two-phase mutation. */
export declare function addPropertyNoteHandler(input: schemas.ToolInputs["add_property_note"], ctx: RequestContext): Promise<schemas.ToolResult>;
/** `generate_statutory_certificate` handler. */
export declare function generateStatutoryCertificateHandler(input: schemas.ToolInputs["generate_statutory_certificate"], ctx: RequestContext): Promise<schemas.ToolResult>;
//# sourceMappingURL=workflows.d.ts.map