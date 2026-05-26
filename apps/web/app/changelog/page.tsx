/**
 * Public-facing product changelog.
 *
 * Distinct from CHANGELOG.md at the repo root — that file is the
 * engineer-facing release log (Keep-a-Changelog format, every diff). This
 * page is the council-facing surface: product-language entries grouped by
 * month, with a "coming next" section that mirrors the roadmap signals
 * we want a CFO to see before a procurement meeting.
 *
 * Entries are curated in source rather than scraped from git: the commit
 * messages are engineering shorthand ("ship-ready iter3"), not the
 * product-facing copy a council expects to read. When a tagged release
 * lands, mirror the corresponding CHANGELOG.md entry here in council
 * language.
 */

import type { Metadata } from "next";

import { TrustPageShell } from "@/components/PublicLayout";

export const metadata: Metadata = {
  title: "Changelog — RatesAssist",
  description:
    "Dated product changes shipped by RatesAssist, grouped by month, with the upcoming roadmap.",
};

interface ChangelogEntry {
  readonly title: string;
  readonly body: string;
}

interface ChangelogMonth {
  readonly anchor: string;
  readonly label: string;
  readonly entries: ReadonlyArray<ChangelogEntry>;
}

const MONTHS: ReadonlyArray<ChangelogMonth> = [
  {
    anchor: "2026-05",
    label: "May 2026",
    entries: [
      {
        title: "Sentinel-2 Live imagery",
        body:
          "Sentinel-2 cloud-free imagery sourced from the Esri Living Atlas now ships as the default basemap, with a rolling latest-scene cadence of approximately 14 days. The imagery-currency badge surfaces the source date next to every parcel preview so clerks see exactly how fresh the underlying scene is.",
      },
      {
        title: "Postgres audit hash-chain",
        body:
          "Every read and write against tenant data now writes a SHA-256-linked row to a Postgres-backed audit chain, scoped per tenant. The chain head is verifiable on demand and exportable for council records under the State Records Act 2000 (WA).",
      },
      {
        title: "Evidence-pack PDF generator",
        body:
          "Recovery evidence packs render to print-ready PDF with embedded provenance, citations, and a QR-encoded verification link. The PDF route is tenant-scoped and session-gated: cross-tenant requests return a generic 404 with no enumeration signal.",
      },
      {
        title: "Cross-tenant input scrubbing",
        body:
          "Closes pen-test finding F-001. Tenant identifiers can no longer be derived from a request body, query string, or client cookie — only from the validated session header injected by middleware. Cross-tenant attempts emit an audit-grade Sentry event.",
      },
      {
        title: "Sentry observability wiring",
        body:
          "Application errors, slow requests, and security events stream to Sentry with a per-request correlation ID. PII redaction filters strip owner names, postal addresses and contact details from breadcrumbs before they leave the AU-region service boundary.",
      },
      {
        title: "Council pilot MoU drafted",
        body:
          "The Shire of Ashburton (Tom Price) pilot MoU is drafted, with explicit AU-region pinning, success-fee pricing capped at AUD 250,000 per candidate, 72-hour breach notification, and 7-year audit-log retention. Ready for council legal and Privacy Officer review.",
      },
    ],
  },
];

const COMING_NEXT: ReadonlyArray<ChangelogEntry> = [
  {
    title: "Planet PlanetScope daily 3 m imagery",
    body:
      "Paid uplift signal layered over the Sentinel-2 baseline, providing daily 3-metre resolution for high-value subdivision and construction-detection candidates.",
  },
  {
    title: "SOC 2 Type I audit",
    body:
      "Engagement scheduled for Q3 2026. Bridging letter and audit report will be available to councils under NDA on completion.",
  },
  {
    title: "Multi-tenant rate-table sync",
    body:
      "Per-council WA rate-table imports refresh quarterly from each council's published schedule, with operator review before tenant cut-over.",
  },
  {
    title: "TechOne CiAnywhere live partner integration",
    body:
      "API-based ingestion of the rating roll, replacing the monthly CSV export workflow. Negotiation with TechOne in progress; the CSV path remains the default until a signed partner agreement lands.",
  },
];

export default function ChangelogPage() {
  return (
    <TrustPageShell
      eyebrow="Product"
      title="Changelog"
      intro={
        <p>
          Dated product changes councils have visibility into. The
          engineer-facing release log lives in the repository CHANGELOG.md
          file; this page is the council-language summary, grouped by
          month.
        </p>
      }
    >
      {MONTHS.map((m) => (
        <section
          key={m.anchor}
          id={m.anchor}
          aria-labelledby={`${m.anchor}-heading`}
        >
          <h2
            id={`${m.anchor}-heading`}
            className="text-xl font-semibold tracking-tight text-ink-900"
          >
            {m.label}
          </h2>
          <ul className="mt-4 space-y-4">
            {m.entries.map((e) => (
              <li
                key={e.title}
                className="rounded-xl border border-ink-100 bg-white p-5"
              >
                <h3 className="text-base font-semibold text-ink-900">
                  {e.title}
                </h3>
                <p className="mt-2 text-sm text-ink-700">{e.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section id="coming-next" aria-labelledby="coming-next-heading">
        <h2
          id="coming-next-heading"
          className="text-xl font-semibold tracking-tight text-ink-900"
        >
          Coming next
        </h2>
        <ul className="mt-4 space-y-4">
          {COMING_NEXT.map((e) => (
            <li
              key={e.title}
              className="rounded-xl border border-accent-100 bg-accent-50 p-5"
            >
              <h3 className="text-base font-semibold text-ink-900">
                {e.title}
              </h3>
              <p className="mt-2 text-sm text-ink-700">{e.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-ink-100 pt-6 text-sm text-ink-600">
        <p>
          Subscribe to monthly product updates by emailing{" "}
          <a
            href="mailto:product@ratesassist.com.au?subject=Monthly%20updates%20subscription"
            className="text-accent-600 underline hover:text-accent-700"
          >
            product@ratesassist.com.au
          </a>
          .
        </p>
      </footer>
    </TrustPageShell>
  );
}
