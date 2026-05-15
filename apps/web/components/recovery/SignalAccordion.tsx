"use client";

/**
 * SignalAccordion — collapsible per-signal card used in the Section 5
 * Mismatch breakdown of the evidence pack page.
 *
 * Top-3 signals (by weight) render with `defaultOpen={true}` so the clerk
 * sees the headline detail immediately. Remaining signals collapse so the
 * page does not become a wall of text; the clerk expands only what they
 * need to drill into.
 *
 * ARIA: button carries `aria-expanded` reflecting open state and
 * `aria-controls` pointing at the panel's id; panel uses `role="region"`
 * with a stable label so assistive tech can announce the relationship.
 */

import { useId, useState } from "react";
import type { SignalHit } from "@ratesassist/contract";
import { ChevronDown, ChevronRight } from "lucide-react";

export type SignalAccordionProps = {
  readonly signal: SignalHit;
  readonly defaultOpen: boolean;
};

/**
 * Map a weight to the visual tier shown in the badge. Buckets match the
 * SEVERITY_BANDS constants in the engine so a single high-weight signal
 * (>=0.45) is "red" tier, mid-range is "amber", and the rest are "neutral".
 */
function tierForWeight(weight: number): {
  label: string;
  className: string;
} {
  if (weight >= 0.45) {
    return {
      label: "high",
      className:
        "bg-critical-50 text-critical-700 border border-critical-500/40",
    };
  }
  if (weight >= 0.25) {
    return {
      label: "mid",
      className: "bg-warn-50 text-warn-700 border border-warn-500/40",
    };
  }
  return {
    label: "low",
    className: "bg-ink-100 text-ink-700 border border-ink-300",
  };
}

export function SignalAccordion(props: SignalAccordionProps): JSX.Element {
  const { signal, defaultOpen } = props;
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const baseId = useId();
  const buttonId = `${baseId}-button`;
  const panelId = `${baseId}-panel`;
  const tier = tierForWeight(signal.weight);

  return (
    <div className="card mb-2 overflow-hidden" data-signal-id={signal.id}>
      <button
        id={buttonId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ink-50 focus:outline-none focus:ring-2 focus:ring-accent-500"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-ink-500 flex-shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="w-4 h-4 text-ink-500 flex-shrink-0" aria-hidden="true" />
        )}
        <span className="flex-1 text-sm font-medium text-ink-900">
          {signal.short}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tier.className}`}
          title={`Weight ${signal.weight.toFixed(2)} (${tier.label} tier)`}
        >
          weight {signal.weight.toFixed(2)}
        </span>
        <span className="badge-neutral hidden sm:inline-flex">
          {signal.category}
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="px-4 pb-4 pt-1 text-sm text-ink-700 border-t border-ink-200 bg-white"
        >
          <p className="mb-2 leading-relaxed">{signal.evidence}</p>
          <p className="text-xs text-ink-500">
            <span className="font-medium text-ink-700">Source:</span>{" "}
            {signal.source}
          </p>
        </div>
      )}
    </div>
  );
}

export default SignalAccordion;
