/**
 * `notify_clerk` handler.
 *
 * Composes a templated email from a recovery candidate's record and dispatches
 * it through the configured provider. Provider matrix:
 *
 *   RA_NOTIFY_PROVIDER unset      → console transport (pino-style stderr line),
 *                                    NO real send. Default.
 *   RA_NOTIFY_PROVIDER=resend      + RA_NOTIFY_API_KEY → POST to
 *                                    https://api.resend.com/emails. Gated
 *                                    behind explicit env so tests never send.
 *   anything else                  → returns `forbidden` with "no_provider_configured".
 *
 * Authorisation: RBAC (`write.user_management` or similar) is enforced at
 * the HTTP route in apps/web. Within the adapter we still refuse when the
 * actor kind is missing or unauthenticated.
 *
 * Audit: every successful send (including console) writes an audit row with
 * action="notify.clerk" and after={recipient,subject,provider,messageId?}.
 * Never sends without an authorised actor (actorKind="user" or "service").
 */

import { createHash } from "node:crypto";

import type { schemas } from "@ratesassist/contract";

import { recordMutation } from "../audit/index.js";
import type { RequestContext } from "../runtime/context.js";
import { forbidden, internalError, notFound } from "../runtime/errors.js";

type SendOutcome =
  | { readonly ok: true; readonly provider: "console" | "resend"; readonly messageId?: string }
  | { readonly ok: false; readonly code: "no_provider_configured" | "transport_error"; readonly message: string };

function stderr(payload: Record<string, unknown>): void {
  try {
    process.stderr.write(
      JSON.stringify({
        level: "info",
        scope: "adapter-demo/notify",
        time: new Date().toISOString(),
        ...payload,
      }) + "\n",
    );
  } catch {
    /* never let logging throw */
  }
}

async function sendViaResend(opts: {
  apiKey: string;
  to: string;
  subject: string;
  text: string;
  correlationId: string;
}): Promise<SendOutcome> {
  // Gated behind the explicit env vars — tests never reach this branch.
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.apiKey}`,
        "x-correlation-id": opts.correlationId,
      },
      body: JSON.stringify({
        from: process.env["RA_NOTIFY_FROM"] ?? "ratesassist@notifications.amalafinance.com.au",
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        code: "transport_error",
        message: `resend responded ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, provider: "resend", ...(json.id !== undefined ? { messageId: json.id } : {}) };
  } catch (e) {
    return {
      ok: false,
      code: "transport_error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

async function dispatchEmail(opts: {
  to: string;
  subject: string;
  text: string;
  correlationId: string;
}): Promise<SendOutcome> {
  const provider = process.env["RA_NOTIFY_PROVIDER"];
  if (!provider || provider === "console") {
    stderr({
      msg: "notify.send.console",
      to: opts.to,
      subject: opts.subject,
      correlationId: opts.correlationId,
      bodyChars: opts.text.length,
      note: "console transport — no real send. Set RA_NOTIFY_PROVIDER=resend + RA_NOTIFY_API_KEY for live delivery.",
    });
    return { ok: true, provider: "console" };
  }
  if (provider === "resend") {
    const apiKey = process.env["RA_NOTIFY_API_KEY"];
    if (!apiKey || apiKey.length < 8) {
      return {
        ok: false,
        code: "no_provider_configured",
        message: "RA_NOTIFY_PROVIDER=resend but RA_NOTIFY_API_KEY is missing or too short.",
      };
    }
    return sendViaResend({ apiKey, ...opts });
  }
  return {
    ok: false,
    code: "no_provider_configured",
    message: `Unknown RA_NOTIFY_PROVIDER="${provider}".`,
  };
}

function composeBody(args: {
  candidateAssessmentNumber: string;
  severity: string;
  council?: string;
  uplift?: number;
  recipient: string;
}): string {
  const lines: string[] = [];
  lines.push(`Hello,`);
  lines.push(``);
  lines.push(
    `RatesAssist has flagged a recovery candidate that may require your attention.`,
  );
  lines.push(``);
  lines.push(`  Assessment:   ${args.candidateAssessmentNumber}`);
  lines.push(`  Severity:     ${args.severity}`);
  if (args.council) lines.push(`  Council:      ${args.council}`);
  if (args.uplift !== undefined) {
    lines.push(`  Est. uplift:  AUD ${args.uplift.toLocaleString("en-AU")}/yr`);
  }
  lines.push(``);
  lines.push(
    `Sign in to the RatesAssist console to review the evidence pack and confirm the next action.`,
  );
  lines.push(``);
  lines.push(`Kind regards,`);
  lines.push(`RatesAssist`);
  return lines.join("\n");
}

export async function notifyClerkHandler(
  input: schemas.ToolInputs["notify_clerk"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  if (ctx.actorKind !== "user" && ctx.actorKind !== "service") {
    return forbidden(
      "notify_clerk requires an authorised actor (user or service).",
      ctx.correlationId,
    );
  }

  const property = ctx.store.getProperty(input.candidateAssessmentNumber);
  if (!property) {
    return notFound(
      `No property with assessment "${input.candidateAssessmentNumber}".`,
      ctx.correlationId,
    );
  }

  const text = composeBody({
    candidateAssessmentNumber: input.candidateAssessmentNumber,
    severity: input.severity,
    council: property.council,
    recipient: input.recipientEmail,
  });

  const outcome = await dispatchEmail({
    to: input.recipientEmail,
    subject: input.subject,
    text,
    correlationId: ctx.correlationId,
  });

  if (!outcome.ok) {
    if (outcome.code === "no_provider_configured") {
      return forbidden(
        `notify_clerk: ${outcome.message}`,
        ctx.correlationId,
      );
    }
    return internalError(
      `notify_clerk transport_error: ${outcome.message}`,
      ctx.correlationId,
    );
  }

  const audit = recordMutation({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    actorKind: ctx.actorKind,
    action: "notify.clerk",
    target: { type: "property", id: input.candidateAssessmentNumber },
    after: {
      recipientHash: createHash("sha256").update(input.recipientEmail).digest("hex"),
      recipientDomain: input.recipientEmail.split("@")[1] ?? "unknown",
      subject: input.subject,
      severity: input.severity,
      provider: outcome.provider,
      ...(outcome.messageId !== undefined ? { messageId: outcome.messageId } : {}),
    },
    correlationId: ctx.correlationId,
    ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
    ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
  });
  // Best-effort: notify is NOT in FAIL_CLOSED_ACTIONS so we proceed even if the
  // write failed (it's logged via stderr from recordMutation).
  void audit;

  return {
    ok: true,
    output: `Notification dispatched via ${outcome.provider} to ${input.recipientEmail}.`,
    data: {
      provider: outcome.provider,
      recipient: input.recipientEmail,
      subject: input.subject,
      candidateAssessmentNumber: input.candidateAssessmentNumber,
      severity: input.severity,
      ...(outcome.messageId !== undefined ? { messageId: outcome.messageId } : {}),
    },
    mutated: true,
  };
}
