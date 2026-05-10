/**
 * Communications handlers — draft-only. The adapter NEVER auto-sends.
 *
 * Both handlers return `committed: false` on each `ReminderDraft`-shaped
 * data entry, mirroring the contract's invariant that drafts are previews
 * until a separately-authenticated send call is performed by a different
 * (commit) flow. This adapter does not implement send — it only drafts.
 */

import type {
  CommunicationTone,
  Owner,
  Property,
  ReminderDraft,
  schemas,
} from "@ratesassist/contract";

import { recordMutation } from "../audit/index.js";
import type { RequestContext } from "../runtime/context.js";
import { notFound } from "../runtime/errors.js";
import { aud } from "./format.js";

/**
 * First name extraction for a friendly greeting. Falls back to the full
 * name when there is no whitespace (corporate owners).
 */
function firstName(owner: Owner): string {
  const parts = owner.name.split(/\s+/);
  return parts[0] ?? owner.name;
}

/**
 * Compose the draft body for a property/tone pair. State-aware for AU
 * idiomatic phrasing; tone-aware for escalation language.
 */
function composeDraft(
  property: Property,
  owner: Owner,
  tone: CommunicationTone,
): { subject: string; body: string } {
  const subject =
    tone === "final"
      ? `FINAL NOTICE — Council rates ${property.assessmentNumber} (${aud(property.balance)} outstanding)`
      : tone === "firm"
        ? `Overdue council rates — ${property.assessmentNumber}`
        : `Friendly reminder — your council rates`;

  const greeting = tone === "final" ? "Notice" : `Hi ${firstName(owner)}`;
  const balance = aud(property.balance);

  const closing = tone === "final"
    ? `Failure to respond may result in legal recovery action under the Local Government Act applicable in ${property.state}. Contact the council's rates department immediately.`
    : tone === "firm"
      ? `Please arrange payment within 7 days to avoid further action. Payment plans are available on request.`
      : `You can pay via BPAY, online portal, or by contacting the council. Let us know if you'd like to set up a payment plan.`;

  const body = [
    `${greeting},`,
    ``,
    `Council rates of ${balance} for ${property.address}, ${property.suburb} (Assessment ${property.assessmentNumber}) are currently overdue.`,
    ``,
    closing,
    ``,
    `— Rates department`,
  ].join("\n");

  return { subject, body };
}

/** `draft_payment_reminder` — single-property draft. */
export async function draftPaymentReminderHandler(
  input: schemas.ToolInputs["draft_payment_reminder"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const property = ctx.store.getProperty(input.assessmentNumber);
  if (property === undefined) {
    return notFound(
      `No property with assessment number "${input.assessmentNumber}".`,
      ctx.correlationId,
    );
  }
  if (property.balance <= 0) {
    return {
      ok: true,
      output: `${input.assessmentNumber} has no outstanding balance — nothing to remind.`,
      data: { assessmentNumber: input.assessmentNumber, balance: property.balance },
      mutated: false,
    };
  }
  const owner = ctx.store.ownersForProperty(property)[0];
  if (owner === undefined) {
    return {
      ok: true,
      output: `${input.assessmentNumber} has no owner of record — cannot draft a reminder.`,
      data: { assessmentNumber: input.assessmentNumber },
      mutated: false,
    };
  }
  const { subject, body } = composeDraft(property, owner, input.tone);
  const draft: ReminderDraft = {
    assessmentNumber: property.assessmentNumber,
    recipient: owner.name,
    recipientPhone: owner.phone,
    recipientEmail: owner.email,
    tone: input.tone,
    subject,
    body,
    committed: false,
  };
  const text = [
    `Draft (${input.tone}) for ${owner.name} — ${owner.phone ?? "no phone"} / ${owner.email ?? "no email"}:`,
    ``,
    `Subject: ${subject}`,
    ``,
    body,
    ``,
    `[NOT SENT — separate confirmation flow required]`,
  ].join("\n");
  // Best-effort preview event. Drafts don't mutate state but the council's
  // compliance officer needs to see *which* properties were drafted against,
  // by whom — so we record a preview event with target=property and a
  // minimal payload (no message body, since that's reproducible from input).
  recordMutation({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    actorKind: ctx.actorKind,
    action: "draft_payment_reminder",
    target: { type: "property", id: property.assessmentNumber },
    after: { tone: input.tone, recipientOwnerId: owner.ownerId, balance: property.balance },
    correlationId: ctx.correlationId,
    ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
    ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
  });
  return {
    ok: true,
    output: text,
    data: { draft },
    mutated: false,
  };
}

/** `draft_chase_all_overdue` — batch preview across overdue accounts not on a payment arrangement. */
export async function draftChaseAllOverdueHandler(
  input: schemas.ToolInputs["draft_chase_all_overdue"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const overdue = ctx.store
    .listOverdue(input.council)
    .filter((p) => !p.paymentArrangement);
  if (overdue.length === 0) {
    return {
      ok: true,
      output: `Nothing to chase — every overdue account is already on a payment arrangement.`,
      data: { drafts: [] },
      mutated: false,
    };
  }
  const drafts: ReminderDraft[] = [];
  for (const property of overdue) {
    const owner = ctx.store.ownersForProperty(property)[0];
    if (owner === undefined) continue;
    const { subject, body } = composeDraft(property, owner, input.tone);
    drafts.push({
      assessmentNumber: property.assessmentNumber,
      recipient: owner.name,
      recipientPhone: owner.phone,
      recipientEmail: owner.email,
      tone: input.tone,
      subject,
      body,
      committed: false,
    });
  }
  const summaryLines = drafts
    .map(
      (d) =>
        `  - ${d.assessmentNumber} → ${d.recipient} | ${d.recipientPhone ?? "no phone"} / ${d.recipientEmail ?? "no email"}`,
    )
    .join("\n");
  const text = [
    `Would draft ${drafts.length} ${input.tone} reminder${drafts.length === 1 ? "" : "s"}${input.council ? ` for council ${input.council}` : ""}:`,
    summaryLines,
    ``,
    `[NOT SENT — separate confirmation flow required to commit any individual draft]`,
  ].join("\n");
  // Single batch-level audit event — emitting one entry per draft would
  // explode the buffer and obscure the meaningful "officer ran a chase"
  // signal. The list of assessmentNumbers is in the payload for traceability.
  recordMutation({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    actorKind: ctx.actorKind,
    action: "draft_chase_all_overdue",
    target: { type: "council", id: input.council ?? ctx.tenantId },
    after: {
      tone: input.tone,
      draftCount: drafts.length,
      assessmentNumbers: drafts.map((d) => d.assessmentNumber),
    },
    correlationId: ctx.correlationId,
    ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
    ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
  });
  return {
    ok: true,
    output: text,
    data: { drafts },
    mutated: false,
  };
}
