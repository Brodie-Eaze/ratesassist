/**
 * Trust index — landing page for every public trust artefact RatesAssist
 * publishes. This is the page a council CFO's IT lead opens after
 * Googling "ratesassist trust" or following a link from a procurement
 * questionnaire.
 *
 * Each card maps to a canonical artefact. When we add a new artefact
 * (for example a SOC 2 bridging letter or a Statement of Applicability),
 * the link lands here.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { TrustPageShell } from "@/components/PublicLayout";

export const metadata: Metadata = {
  title: "Trust centre — RatesAssist",
  description:
    "Security posture, platform status, changelog, privacy policy, sub-processors, DPA and incident response — built for council-grade procurement.",
};

interface TrustCard {
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly external?: boolean;
  readonly note?: string;
}

const CARDS: ReadonlyArray<TrustCard> = [
  {
    title: "Security posture",
    description:
      "Encryption, authentication, RBAC, audit logging, vulnerability management, multi-tenant isolation, and the certification roadmap.",
    href: "/security",
  },
  {
    title: "Platform status",
    description:
      "Live operational state of every service component RatesAssist runs, with 30-day uptime per component and a 90-day incident history.",
    href: "/status",
  },
  {
    title: "Changelog",
    description:
      "Dated product changes councils have visibility into, grouped by month, with the upcoming roadmap.",
    href: "/changelog",
  },
  {
    title: "Privacy policy",
    description:
      "How we process council-supplied personal information, what your rights are under the Australian Privacy Principles, and how to contact us.",
    href: "/privacy",
  },
  {
    title: "Sub-processors",
    description:
      "Every third party that may process council-supplied personal information on RatesAssist's behalf, with role, residency and contract basis.",
    href: "/trust/sub-processors",
  },
  {
    title: "Data Processing Addendum (DPA)",
    description:
      "Council-ready DPA template covering APP-aligned obligations, sub-processor controls, breach notification and audit rights.",
    // TODO(dpa-template): publish DPA template PDF. Until the legal-reviewed
    // template lands at /trust/dpa-template.pdf, this card surfaces a
    // mailto fallback so councils can request the in-progress draft.
    href: "mailto:legal@ratesassist.com.au?subject=DPA%20template%20request",
    external: true,
    note: "DPA template under legal review — request a draft by email.",
  },
  {
    title: "Incident response runbook",
    description:
      "Severity definitions, triage flow, 72-hour NDB-scheme assessment timeline, and the communication templates we operate against.",
    // INCIDENT-RESPONSE-RUNBOOK.md is checked into the repository but not
    // exposed on a public GitHub URL. Councils receive the current version
    // under NDA on request.
    href: "mailto:security@ratesassist.com.au?subject=Incident%20response%20runbook%20request",
    external: true,
    note: "Available to councils on request.",
  },
];

export default function TrustIndexPage() {
  return (
    <TrustPageShell
      eyebrow="Trust centre"
      title="Built for council-grade procurement."
      intro={
        <p>
          Every artefact below answers a question a council CFO, Privacy
          Officer or ICT Manager asks before signing a pilot. They are
          versioned, dated, and updated in the same release as the
          controls they describe.
        </p>
      }
    >
      <section aria-label="Trust artefacts">
        <ul className="grid gap-4 md:grid-cols-2">
          {CARDS.map((c) => {
            const inner = (
              <>
                <h2 className="text-base font-semibold text-ink-900">
                  {c.title}
                </h2>
                <p className="mt-2 text-sm text-ink-700">{c.description}</p>
                {c.note ? (
                  <p className="mt-3 text-xs uppercase tracking-wider text-ink-500">
                    {c.note}
                  </p>
                ) : null}
              </>
            );
            const className =
              "block h-full rounded-xl border border-ink-100 bg-white p-5 transition hover:border-accent-200 hover:bg-accent-50";
            return (
              <li key={c.title}>
                {c.external ? (
                  <a href={c.href} className={className}>
                    {inner}
                  </a>
                ) : (
                  <Link href={c.href} className={className}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-labelledby="contact-heading"
        className="rounded-xl border border-accent-100 bg-accent-50 p-6"
      >
        <h2
          id="contact-heading"
          className="text-xl font-semibold tracking-tight text-ink-900"
        >
          Need something not listed here?
        </h2>
        <p className="mt-3 text-ink-700">
          Councils can request a full procurement pack — Privacy Impact
          Assessment, current sub-processor list, Incident Response
          Runbook, SOC 2 / ISO 27001 bridging letters, and the DPA
          template — under NDA. Email{" "}
          <a
            href="mailto:procurement@ratesassist.com.au?subject=Procurement%20pack"
            className="text-accent-700 underline hover:text-accent-800"
          >
            procurement@ratesassist.com.au
          </a>{" "}
          with your council, role, and the artefacts you need.
        </p>
      </section>
    </TrustPageShell>
  );
}
