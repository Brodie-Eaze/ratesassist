"use client";

/**
 * ConcessionAuditSection — Section 9 of the evidence pack rendered as a
 * React block. Shows the council's current concession state alongside the
 * Water Corp eligibility check (with a colour-coded status badge), a
 * postal-vs-property comparison, and a recommended action.
 *
 * Statutory basis: Rates and Charges Rebates and Deferments Act 1992 (WA).
 * Surfaced inline so the clerk can cite the basis without re-opening the
 * pack markdown.
 */

import type {
  PensionerConcession,
  WaterCorpEligibilityStatus,
} from "@ratesassist/contract";
import { AlertTriangle, CheckCircle2, XCircle, HelpCircle } from "lucide-react";

export type ConcessionAuditSectionProps = {
  readonly concession: PensionerConcession;
  /** Council's record of the property address (single line, all components). */
  readonly propertyAddress: string;
  /** Landgate proprietor's postal address (may differ from property). */
  readonly propertyPostalAddress: string | undefined;
};

/**
 * Mask a concession card number to the last 4 digits with bullets for the
 * remainder. Defensive for short / empty cards.
 */
function maskCard(card: string | undefined): string {
  if (!card) return "—";
  if (card.length < 8) return card;
  return `${"•".repeat(card.length - 4)}${card.slice(-4)}`;
}

/**
 * Visual tier for the WC eligibility status badge:
 *   active     → green (eligible, no action)
 *   expired    → amber (card lapsed, follow-up due)
 *   cancelled  → red   (suspend rebate, write to proprietor)
 *   deceased   → red   (engage executor)
 *   unknown    → amber (verification failed)
 *   undefined  → neutral (never verified)
 */
function statusTier(
  status: WaterCorpEligibilityStatus | undefined,
): {
  readonly label: string;
  readonly className: string;
  readonly icon: JSX.Element;
} {
  if (status === "active") {
    return {
      label: "Active — eligible",
      className: "bg-success-50 text-success-700 border-success-500",
      icon: <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />,
    };
  }
  if (status === "cancelled" || status === "deceased") {
    return {
      label:
        status === "deceased"
          ? "Deceased — death recorded"
          : "Cancelled — no longer eligible",
      className: "bg-critical-50 text-critical-700 border-critical-500",
      icon: <XCircle className="w-3.5 h-3.5" aria-hidden="true" />,
    };
  }
  if (status === "expired") {
    return {
      label: "Expired — card lapsed, not renewed",
      className: "bg-warn-50 text-warn-700 border-warn-500",
      icon: <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />,
    };
  }
  if (status === "unknown") {
    return {
      label: "Unknown — eligibility could not be verified",
      className: "bg-warn-50 text-warn-700 border-warn-500",
      icon: <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />,
    };
  }
  return {
    label: "Not verified — Water Corp feed not run for this property",
    className: "bg-ink-100 text-ink-700 border-ink-300",
    icon: <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />,
  };
}

function recommendedAction(
  c: PensionerConcession,
  addressMatches: boolean,
): string {
  const status = c.wcEligibilityStatus;
  if (status === "deceased") {
    return "Suspend the rebate immediately and engage the executor / proprietor's estate to confirm new ownership and update the rating roll.";
  }
  if (status === "cancelled") {
    return "Suspend the rebate and write to the proprietor requesting evidence of current eligibility; if none is provided within 28 days, remove the concession and backdate to the cancellation date.";
  }
  if (status === "expired") {
    return "Write to the proprietor requesting a current concession card; suspend the rebate if no current card is provided within 28 days.";
  }
  if (!addressMatches) {
    return "Verify the proprietor's principal place of residence — concession applies only where the property is the proprietor's primary residence; if the postal address indicates the proprietor lives elsewhere, the rebate is likely ineligible.";
  }
  if (status === "active") {
    return "No action required — Water Corp confirms active eligibility and addresses align.";
  }
  return "Manual review required — Water Corp eligibility cannot be verified from the current feed.";
}

export function ConcessionAuditSection(
  props: ConcessionAuditSectionProps,
): JSX.Element {
  const { concession, propertyAddress, propertyPostalAddress } = props;
  const tier = statusTier(concession.wcEligibilityStatus);
  const addressMatches: boolean =
    !!propertyPostalAddress &&
    propertyPostalAddress
      .toLowerCase()
      .includes(propertyAddress.split(",")[0]!.toLowerCase());

  return (
    <section
      aria-labelledby="concession-audit-heading"
      className="card p-5 mb-4"
      data-testid="concession-audit-section"
    >
      <h2
        id="concession-audit-heading"
        className="text-base font-semibold text-ink-900 mb-3"
      >
        Section 9 — Concession audit
      </h2>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="label">Current concession on file</div>
          <div className="text-sm text-ink-900">
            {concession.applied ? concession.type : "(none applied)"}
          </div>
          {concession.appliedAt && (
            <div className="text-xs text-ink-500 mt-0.5">
              Applied since {concession.appliedAt}
            </div>
          )}
          {concession.cardNumber && (
            <div className="text-xs text-ink-500 mt-0.5">
              Card:{" "}
              <span className="font-mono" data-testid="masked-card">
                {maskCard(concession.cardNumber)}
              </span>
              {concession.cardExpiry ? ` · expires ${concession.cardExpiry}` : ""}
            </div>
          )}
        </div>
        <div>
          <div className="label">Water Corp eligibility</div>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${tier.className}`}
            data-testid="wc-status-badge"
            data-wc-status={concession.wcEligibilityStatus ?? "unverified"}
          >
            {tier.icon}
            {tier.label}
          </span>
          {concession.wcEligibilityVerifiedAt && (
            <div className="text-xs text-ink-500 mt-1">
              Last verified {concession.wcEligibilityVerifiedAt}
            </div>
          )}
          {concession.wcCancellationReason && (
            <div className="text-xs text-ink-500 mt-1">
              Reason: {concession.wcCancellationReason}
            </div>
          )}
          {concession.wcCancellationDate && (
            <div className="text-xs text-ink-500">
              Cancelled {concession.wcCancellationDate}
            </div>
          )}
        </div>
      </div>

      <div className="mb-4 border-t border-ink-200 pt-3">
        <div className="label">Postal vs property address</div>
        <div className="grid grid-cols-2 gap-4 mt-1 text-xs text-ink-700">
          <div>
            <div className="text-ink-500 mb-0.5">Property</div>
            <div>{propertyAddress}</div>
          </div>
          <div>
            <div className="text-ink-500 mb-0.5">Proprietor postal</div>
            <div>{propertyPostalAddress ?? "(not on file)"}</div>
          </div>
        </div>
        <div
          className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border ${
            addressMatches
              ? "bg-success-50 text-success-700 border-success-500"
              : "bg-warn-50 text-warn-700 border-warn-500"
          }`}
          data-testid="address-comparison-badge"
          data-address-match={addressMatches ? "yes" : "no"}
        >
          {addressMatches ? "Addresses align" : "Address mismatch"}
        </div>
      </div>

      <div className="mb-4 text-xs text-ink-600">
        <div className="label mb-1">Statutory basis</div>
        <p>
          Rates and Charges (Rebates and Deferments) Act 1992 (WA) — governs
          pensioner / senior concessions on local government rates. The Water
          Corporation eligibility feed is the authoritative source for status;
          council-applied state must be reconciled against it.
        </p>
      </div>

      <div className="border-t border-ink-200 pt-3">
        <div className="label mb-1">Recommended action</div>
        <p className="text-sm text-ink-800" data-testid="recommended-action">
          {recommendedAction(concession, addressMatches)}
        </p>
      </div>
    </section>
  );
}

export default ConcessionAuditSection;
