/**
 * Email transport facade for apps/web.
 *
 * Mirror of the provider matrix used inside the adapter's notify_clerk
 * handler. The adapter handles its own dispatch when called via MCP; this
 * facade exists so REST routes (POST /api/notify) and future ad-hoc
 * server-side sends can share the same envelope.
 *
 *   RA_NOTIFY_PROVIDER unset      → console transport (pino at info level).
 *                                    No real send.
 *   RA_NOTIFY_PROVIDER=resend     + RA_NOTIFY_API_KEY → POST
 *                                    https://api.resend.com/emails.
 *   anything else                  → { ok:false, code:"no_provider_configured" }.
 *
 * Honest framing: production wiring requires a Resend / SendGrid / SMTP
 * account; until that env is configured, sends are logged-only. We never
 * silently pretend to have sent.
 */

import { scoped } from "./logger";

export type NotifyResult =
  | { readonly ok: true; readonly provider: "console" | "resend"; readonly messageId?: string }
  | {
      readonly ok: false;
      readonly code: "no_provider_configured" | "transport_error";
      readonly message: string;
    };

export interface SendEmailOpts {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly correlationId?: string;
}

export async function sendEmail(opts: SendEmailOpts): Promise<NotifyResult> {
  const log = scoped("notifier", {
    ...(opts.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
  });
  const provider = process.env["RA_NOTIFY_PROVIDER"];

  if (!provider || provider === "console") {
    log.info({
      msg: "notify.send.console",
      to: opts.to,
      subject: opts.subject,
      bodyChars: opts.text.length,
      note: "console transport — no real send. Set RA_NOTIFY_PROVIDER=resend + RA_NOTIFY_API_KEY for live delivery.",
    });
    return { ok: true, provider: "console" };
  }

  if (provider !== "resend") {
    return {
      ok: false,
      code: "no_provider_configured",
      message: `Unknown RA_NOTIFY_PROVIDER="${provider}". Supported: console (default), resend.`,
    };
  }

  const apiKey = process.env["RA_NOTIFY_API_KEY"];
  if (!apiKey || apiKey.length < 8) {
    return {
      ok: false,
      code: "no_provider_configured",
      message: "RA_NOTIFY_PROVIDER=resend but RA_NOTIFY_API_KEY is missing or too short.",
    };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(opts.correlationId ? { "x-correlation-id": opts.correlationId } : {}),
      },
      body: JSON.stringify({
        from: process.env["RA_NOTIFY_FROM"] ?? "ratesassist@notifications.amalafinance.com.au",
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        ...(opts.html !== undefined ? { html: opts.html } : {}),
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
    return {
      ok: true,
      provider: "resend",
      ...(json.id !== undefined ? { messageId: json.id } : {}),
    };
  } catch (e) {
    return {
      ok: false,
      code: "transport_error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
