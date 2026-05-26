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

import type { AustralianState, Owner, schemas } from "@ratesassist/contract";

import { recordMutation } from "../audit/index.js";
import type { RequestContext } from "../runtime/context.js";
import {
  conflict,
  forbidden,
  internalError,
  invalidInput,
  notFound,
} from "../runtime/errors.js";
import { aud, isoDate } from "./format.js";

/**
 * Snapshot helper — strips internals (none, today) and produces a structurally
 * stable copy for the audit log. Returning the live object would risk leaking
 * later mutations through reference identity.
 */
function snapshotOwner(o: Owner): Owner {
  return { ...o };
}

// ===========================================================================
// update_owner_contact
// ===========================================================================

/**
 * Format the diff between an existing owner and the proposed change.
 * Returns the human-readable diff lines plus the patch object that the
 * commit step will apply.
 */
function diffOwnerContact(
  owner: Owner,
  newPhone: string | undefined,
  newEmail: string | undefined,
): {
  readonly lines: readonly string[];
  readonly hasChanges: boolean;
  readonly patch: { phone?: string; email?: string };
} {
  const lines: string[] = [];
  const patch: { phone?: string; email?: string } = {};
  if (newPhone !== undefined && newPhone !== owner.phone) {
    lines.push(`  phone: ${owner.phone ?? "(none)"} → ${newPhone}`);
    patch.phone = newPhone;
  }
  if (newEmail !== undefined && newEmail !== owner.email) {
    lines.push(`  email: ${owner.email ?? "(none)"} → ${newEmail}`);
    patch.email = newEmail;
  }
  return { lines, hasChanges: lines.length > 0, patch };
}

/** `update_owner_contact` handler — two-phase mutation. */
export async function updateOwnerContactHandler(
  input: schemas.ToolInputs["update_owner_contact"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const owner = ctx.store.getOwner(input.ownerId);
  if (owner === undefined) {
    return notFound(
      `No owner with id "${input.ownerId}".`,
      ctx.correlationId,
    );
  }

  // Confirm path — token must be present and valid for this operation.
  if (input.confirm) {
    if (input.commitToken === undefined) {
      return invalidInput(
        "confirm=true requires a commitToken from the preview call.",
        ctx.correlationId,
      );
    }
    const consumed = ctx.commitTokens.consume(
      input.commitToken,
      "update_owner_contact",
      { tenantId: ctx.tenantId, actorId: ctx.actorId },
    );
    if (!consumed.ok) {
      const reason =
        consumed.reason === "expired"
          ? "commitToken has expired (5 minute TTL); re-run the preview"
          : consumed.reason === "operation_mismatch"
            ? "commitToken was issued for a different operation"
            : "commitToken is unknown or already consumed";
      return conflict(reason, ctx.correlationId);
    }
    const mut = consumed.mutation;
    if (mut.operation !== "update_owner_contact") {
      // Defensive: the store enforces this, but the type guard makes the
      // narrowing explicit for the rest of the function.
      return conflict("commitToken operation mismatch.", ctx.correlationId);
    }
    if (mut.ownerId !== input.ownerId) {
      return conflict(
        "commitToken was issued for a different ownerId.",
        ctx.correlationId,
      );
    }
    const before = snapshotOwner(owner);
    const updated: Owner = {
      ...owner,
      ...(mut.newPhone !== undefined ? { phone: mut.newPhone } : {}),
      ...(mut.newEmail !== undefined ? { email: mut.newEmail } : {}),
    };
    const stored = ctx.store.replaceOwner(updated);
    if (stored === undefined) {
      // The owner existed at preview time but disappeared before commit.
      return notFound(
        `Owner "${input.ownerId}" no longer exists.`,
        ctx.correlationId,
      );
    }
    // Best-effort audit. Non-fail-closed: a failed audit write must NOT
    // discard the user's mutation; the helper logs and synthesises ok=true.
    recordMutation({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorKind: ctx.actorKind,
      action: "update_owner_contact",
      target: { type: "owner", id: stored.ownerId },
      before,
      after: snapshotOwner(stored),
      correlationId: ctx.correlationId,
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
    });
    return {
      ok: true,
      output: `Updated contact for ${stored.name} (${stored.ownerId}).`,
      data: { owner: stored },
      mutated: true,
    };
  }

  // Preview path — diff + token.
  const { lines, hasChanges, patch } = diffOwnerContact(
    owner,
    input.newPhone,
    input.newEmail,
  );
  if (!hasChanges) {
    return {
      ok: true,
      output: `No changes proposed for ${owner.name} (${owner.ownerId}); current values already match.`,
      data: { owner, changes: [] },
      mutated: false,
    };
  }
  const token = ctx.commitTokens.issue(
    {
      operation: "update_owner_contact",
      ownerId: owner.ownerId,
      ...(patch.phone !== undefined ? { newPhone: patch.phone } : {}),
      ...(patch.email !== undefined ? { newEmail: patch.email } : {}),
    },
    { tenantId: ctx.tenantId, actorId: ctx.actorId },
  );
  const text = [
    `Proposed change to ${owner.name} (${owner.ownerId}):`,
    ...lines,
    ``,
    `[NOT COMMITTED — re-run with confirm=true and commitToken=${token} within 5 minutes to apply.]`,
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { owner, changes: lines },
    commitToken: token,
    mutated: false,
  };
}

// ===========================================================================
// add_property_note
// ===========================================================================

/** `add_property_note` handler — two-phase mutation. */
export async function addPropertyNoteHandler(
  input: schemas.ToolInputs["add_property_note"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const property = ctx.store.getProperty(input.assessmentNumber);
  if (property === undefined) {
    return notFound(
      `No property with assessment number "${input.assessmentNumber}".`,
      ctx.correlationId,
    );
  }

  if (input.confirm) {
    if (input.commitToken === undefined) {
      return invalidInput(
        "confirm=true requires a commitToken from the preview call.",
        ctx.correlationId,
      );
    }
    const consumed = ctx.commitTokens.consume(
      input.commitToken,
      "add_property_note",
      { tenantId: ctx.tenantId, actorId: ctx.actorId },
    );
    if (!consumed.ok) {
      const reason =
        consumed.reason === "expired"
          ? "commitToken has expired (5 minute TTL); re-run the preview"
          : consumed.reason === "operation_mismatch"
            ? "commitToken was issued for a different operation"
            : "commitToken is unknown or already consumed";
      return conflict(reason, ctx.correlationId);
    }
    const mut = consumed.mutation;
    if (mut.operation !== "add_property_note") {
      return conflict("commitToken operation mismatch.", ctx.correlationId);
    }
    if (mut.assessmentNumber !== input.assessmentNumber) {
      return conflict(
        "commitToken was issued for a different assessment number.",
        ctx.correlationId,
      );
    }
    const beforeNotes = property.notes.slice();
    const stored = ctx.store.addNoteToProperty(input.assessmentNumber, mut.note);
    if (stored === undefined) {
      return notFound(
        `Property "${input.assessmentNumber}" no longer exists.`,
        ctx.correlationId,
      );
    }
    recordMutation({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorKind: ctx.actorKind,
      action: "add_property_note",
      target: { type: "property", id: stored.assessmentNumber },
      before: { notes: beforeNotes },
      after: { notes: stored.notes.slice(), addedNote: mut.note },
      correlationId: ctx.correlationId,
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
    });
    return {
      ok: true,
      output: `Note appended to ${stored.assessmentNumber}. Total notes on file: ${stored.notes.length}.`,
      data: { property: stored, addedNote: mut.note },
      mutated: true,
    };
  }

  const token = ctx.commitTokens.issue({
    operation: "add_property_note",
    assessmentNumber: input.assessmentNumber,
    note: input.note,
  }, { tenantId: ctx.tenantId, actorId: ctx.actorId });
  const text = [
    `Proposed note for ${property.assessmentNumber} (${property.address}):`,
    ``,
    `> ${input.note}`,
    ``,
    `[NOT COMMITTED — re-run with confirm=true and commitToken=${token} within 5 minutes to apply.]`,
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { property, proposedNote: input.note },
    commitToken: token,
    mutated: false,
  };
}

// ===========================================================================
// generate_statutory_certificate
// ===========================================================================

/** Permitted certificate type strings keyed by state. */
const CERTIFICATE_TYPES_BY_STATE: Readonly<
  Partial<Record<AustralianState, readonly string[]>>
> = {
  WA: ["WA-6.76", "WA-S6.76"],
  NSW: ["NSW-603", "NSW-S603"],
  QLD: ["QLD-95", "QLD-S95"],
};

/**
 * Build the certificate body for a property in a state where we have a
 * drafted template. Returns the markdown body. Caller wraps with header.
 */
function certificateBodyFor(
  state: AustralianState,
  args: {
    readonly assessmentNumber: string;
    readonly address: string;
    readonly suburb: string;
    readonly postcode: string;
    readonly landUse: string;
    readonly valuation: number;
    readonly annualRates: number;
    readonly balance: number;
    readonly requesterName: string;
    readonly requesterEmail: string;
    readonly issuedDate: string;
  },
): string {
  const wa = `**Statutory rates certificate — Local Government Act 1995 (WA), s.6.76**

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

— Issued by the council under delegated authority.`;

  const nsw = `**Section 603 certificate — Local Government Act 1993 (NSW)**

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

— Issued by the council under delegated authority.`;

  const qld = `**Section 95 rates certificate — Local Government Regulation 2012 (QLD)**

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

— Issued by the council under delegated authority.`;

  switch (state) {
    case "WA":
      return wa;
    case "NSW":
      return nsw;
    case "QLD":
      return qld;
    default:
      throw new Error(
        `certificateBodyFor invoked for unsupported state ${state}`,
      );
  }
}

/** `generate_statutory_certificate` handler. */
export async function generateStatutoryCertificateHandler(
  input: schemas.ToolInputs["generate_statutory_certificate"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const property = ctx.store.getProperty(input.assessmentNumber);
  if (property === undefined) {
    return notFound(
      `No property with assessment number "${input.assessmentNumber}".`,
      ctx.correlationId,
    );
  }

  const expected = CERTIFICATE_TYPES_BY_STATE[property.state];
  if (expected === undefined || expected.length === 0) {
    return forbidden(
      `Statutory certificate generation for ${property.state} is not yet supported by this adapter (see README for the deferred-state list).`,
      ctx.correlationId,
    );
  }
  if (!expected.includes(input.certificateType)) {
    return invalidInput(
      `certificateType "${input.certificateType}" is not valid for ${property.state}; expected one of: ${expected.join(", ")}.`,
      ctx.correlationId,
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
    issuedDate,
  });

  const certificateId = `CERT-${property.assessmentNumber}-${issuedDate.replace(/-/g, "")}`;
  const text = [
    `# ${certificateId}`,
    ``,
    body,
    ``,
    `*Generated by RatesAssist on behalf of the council. The council retains statutory authority for the issued certificate.*`,
  ].join("\n");

  // Fail-closed audit: emitting a statutory certificate without a recorded
  // audit row is unacceptable. The helper returns failClosed=true on error.
  const audit = recordMutation({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    actorKind: ctx.actorKind,
    action: "generate_statutory_certificate",
    target: { type: "certificate", id: certificateId },
    before: null,
    after: {
      certificateId,
      certificateType: input.certificateType,
      state: property.state,
      issuedDate,
      assessmentNumber: property.assessmentNumber,
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail,
    },
    correlationId: ctx.correlationId,
    ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
    ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
  });
  if (!audit.ok && audit.failClosed) {
    return internalError(
      `Refusing to emit certificate ${certificateId}: audit log unavailable.`,
      ctx.correlationId,
    );
  }

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
      property,
    },
    mutated: false,
  };
}
