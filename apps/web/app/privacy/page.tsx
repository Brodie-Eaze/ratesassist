/**
 * Public-facing privacy policy.
 *
 * Distinct from PRIVACY-IMPACT-ASSESSMENT.md — that document is the
 * internal PIA shared with council Privacy Officers during procurement.
 * This page is the plain-English policy for ratepayers, council staff,
 * and the general public.
 *
 * When the PIA changes (new sub-processor, new data class, residency
 * change), this page MUST be updated in the same release. The last-updated
 * stamp at the bottom is load-bearing — councils rely on it to evidence
 * APP 5 notification timing.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { TrustPageShell } from "@/components/PublicLayout";

export const metadata: Metadata = {
  title: "Privacy policy — RatesAssist",
  description:
    "How RatesAssist processes council-supplied personal information, what your rights are under the Australian Privacy Principles, and how to contact us.",
};

const LAST_UPDATED = "2026-05-26";
const POLICY_VERSION = "1.0";

interface PolicySection {
  readonly id: string;
  readonly title: string;
  readonly body: React.ReactNode;
}

const SECTIONS: ReadonlyArray<PolicySection> = [
  {
    id: "who-we-are",
    title: "Who we are",
    body: (
      <>
        <p>
          RatesAssist is operated by RatesAssist Pty Ltd, an Australian
          proprietary company (ABN registration pending; the ABN will be
          published here on issue). RatesAssist provides a rates audit and
          recovery decision-support platform to Australian local
          governments.
        </p>
        <p className="mt-2">
          For any privacy enquiry, contact our Privacy Owner at{" "}
          <a
            href="mailto:privacy@ratesassist.com.au"
            className="text-accent-600 underline hover:text-accent-700"
          >
            privacy@ratesassist.com.au
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "data-we-process",
    title: "What data we process",
    body: (
      <>
        <p>
          We process council ratepayer personal information that the
          council supplies to us under a written data-handling agreement.
          Categories include owner name, postal and electronic contact
          details, property identification (lot/plan, certificate of
          title, address), rateable valuation, outstanding balance, and
          where supplied by the council, pensioner or hardship-concession
          status.
        </p>
        <p className="mt-2">
          We are a <span className="font-semibold">data processor</span>{" "}
          acting on the council's instructions; the council is the data
          controller and remains the primary point of contact for
          ratepayer enquiries about their own information.
        </p>
        <p className="mt-2">
          We do not collect Tax File Numbers, Medicare numbers, driver's
          licence numbers, passport numbers, bank account details
          (collection deferred to a future phase with tokenisation),
          health information, or any other sensitive information as
          defined in section 6 of the{" "}
          <em>Privacy Act 1988 (Cth)</em> except pensioner / hardship
          status when the council supplies it.
        </p>
      </>
    ),
  },
  {
    id: "how-we-use-it",
    title: "How we use it",
    body: (
      <>
        <p>
          Council-supplied personal information is used only to support
          the council's statutory rates assessment, levying, recovery and
          concession-administration functions under the{" "}
          <em>Local Government Act 1995 (WA)</em> and the equivalent
          legislation in other Australian states.
        </p>
        <p className="mt-2">
          We cross-reference council data against public datasets to
          surface mismatch candidates — properties where rateable
          interest, ownership, valuation or contact information appears
          to be out of date. The public datasets are:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Water Corporation (WA) — published infrastructure and service
            boundaries.
          </li>
          <li>
            Landgate / SLIP — Western Australian land information service:
            cadastre, valuations, ownership of public-record properties.
          </li>
          <li>
            Department of Mines, Industry Regulation and Safety (DMIRS) —
            Western Australian mining tenement register.
          </li>
          <li>
            Australian Business Register (ABR) — operated by the
            Australian Taxation Office.
          </li>
        </ul>
        <p className="mt-2">
          We do not use council-supplied data to train any
          machine-learning model. We do not disclose council-supplied
          personal information to advertising networks, data brokers, or
          any party other than the sub-processors listed in the next
          section.
        </p>
      </>
    ),
  },
  {
    id: "where-it-lives",
    title: "Where it lives",
    body: (
      <p>
        Council-supplied personal information is hosted in Australian
        regions of our cloud infrastructure provider. The pilot tenancy
        runs on Railway pinned to an Australian region; production
        infrastructure will migrate to Amazon Web Services in the Sydney
        region (ap-southeast-2) once the Phase 6 residency operations
        plan (OP-01) closes. Backups are encrypted at rest and replicated
        only within Australia. Cross-border disclosure to Anthropic in
        the United States for LLM inference is disclosed below and in our
        Privacy Impact Assessment.
      </p>
    ),
  },
  {
    id: "who-else-sees-it",
    title: "Who else sees it",
    body: (
      <p>
        A current list of every sub-processor that may process
        council-supplied personal information is maintained at{" "}
        <Link
          href="/trust/sub-processors"
          className="text-accent-600 underline hover:text-accent-700"
        >
          /trust/sub-processors
        </Link>
        . We provide at least 30 days' written notice to council customers
        before any new sub-processor begins processing council-supplied
        information.
      </p>
    ),
  },
  {
    id: "your-rights",
    title: "Your rights",
    body: (
      <>
        <p>
          Under the Australian Privacy Principles (APPs) you have the
          right to request access to the personal information we hold
          about you, and to request correction of that information if it
          is inaccurate, out of date, incomplete, irrelevant or
          misleading.
        </p>
        <p className="mt-2">
          Because RatesAssist is a data processor, requests are routed
          through your council in the first instance. If you cannot
          resolve a matter with your council, you may contact us directly
          at{" "}
          <a
            href="mailto:privacy@ratesassist.com.au"
            className="text-accent-600 underline hover:text-accent-700"
          >
            privacy@ratesassist.com.au
          </a>
          .
        </p>
        <p className="mt-2">
          If you remain dissatisfied, you may make a complaint to the
          Office of the Australian Information Commissioner (OAIC):
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Online: oaic.gov.au</li>
          <li>Phone: 1300 363 992</li>
          <li>
            Post: GPO Box 5288, Sydney NSW 2001
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "breach-notification",
    title: "Breach notification",
    body: (
      <p>
        We will notify the affected council's nominated Privacy Officer
        in writing within 72 hours of becoming aware of any actual or
        reasonably suspected unauthorised access to, loss of, or
        disclosure of council-supplied personal information. Where the
        Notifiable Data Breaches (NDB) scheme under Part IIIC of the{" "}
        <em>Privacy Act 1988 (Cth)</em> applies, we will work with the
        council to notify the Office of the Australian Information
        Commissioner and the affected individuals within the 30-day
        statutory maximum. Our incident response process is documented
        in the Incident Response Runbook, available to councils on
        request.
      </p>
    ),
  },
  {
    id: "retention",
    title: "Retention",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Audit-log entries are retained for 7 years per the{" "}
          <em>State Records Act 2000 (WA)</em> and council
          record-keeping plans.
        </li>
        <li>
          Council-supplied operational data is retained for the term of
          engagement plus 30 days, then returned or irreversibly deleted
          at the council's election.
        </li>
        <li>
          LLM chat transcripts are retained for 90 days operationally,
          unless they back a council decision (an issued evidence pack
          referencing the transcript), in which case they are retained
          for the same 7 years as the audit log.
        </li>
      </ul>
    ),
  },
  {
    id: "changes-to-this-policy",
    title: "Changes to this policy",
    body: (
      <p>
        We version this policy and timestamp every change. The current
        version is <span className="font-mono">{POLICY_VERSION}</span>{" "}
        last updated on{" "}
        <span className="font-mono">{LAST_UPDATED}</span>. Material
        changes — a new data class, a new sub-processor, a residency
        change, or a change in retention — are announced to council
        customers in writing at least 30 days before they take effect.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <TrustPageShell
      eyebrow="Legal"
      title="Privacy policy"
      intro={
        <p>
          This policy explains how RatesAssist Pty Ltd processes
          council-supplied personal information, what your rights are
          under the Australian Privacy Principles, and how to contact us.
          A more detailed Privacy Impact Assessment is available to
          councils on request.
        </p>
      }
    >
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-heading`}>
          <h2
            id={`${s.id}-heading`}
            className="text-xl font-semibold tracking-tight text-ink-900"
          >
            {s.title}
          </h2>
          <div className="mt-3 text-ink-700">{s.body}</div>
        </section>
      ))}

      <footer className="border-t border-ink-100 pt-6 text-sm text-ink-600">
        <p>
          Last updated{" "}
          <span className="font-mono">{LAST_UPDATED}</span> — version{" "}
          <span className="font-mono">{POLICY_VERSION}</span>. Contact{" "}
          <a
            href="mailto:privacy@ratesassist.com.au"
            className="text-accent-600 underline hover:text-accent-700"
          >
            privacy@ratesassist.com.au
          </a>{" "}
          for any privacy enquiry.
        </p>
      </footer>
    </TrustPageShell>
  );
}
