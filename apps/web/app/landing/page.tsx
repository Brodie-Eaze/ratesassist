/**
 * Public landing page — first thing an unauthenticated visitor sees.
 *
 * Hero stat is a hard-coded aggregate ("Across pilot councils: $4.2M+ in
 * identified recovery") rather than a live read from /api/recovery/candidates.
 * Rationale: the candidates endpoint is auth-gated and the landing page is
 * public, so a live read would either require a public unauthenticated
 * counter (extra attack surface, more code) or render as a placeholder for
 * un-authed visitors. The hard-coded figure is honest — it reflects the
 * cumulative pilot estimate — and we update it manually when we onboard a
 * new council. DOCUMENTED: any future "live counter" path should land
 * behind a dedicated, rate-limited, no-PII public endpoint.
 *
 * Australian English throughout.
 */

import { PublicLayout } from "@/components/PublicLayout";

const CONTACT_EMAIL = "brodie@amalafinance.com.au";

const PILLARS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Multi-signal detection",
    body:
      "Cross-references DMIRS mining grants, Landgate cadastre, ABN registry, TechOne rating roll, and the council's own portfolio to surface mis-rated parcels before the next audit cycle.",
  },
  {
    title: "Audit-grade evidence packs",
    body:
      "Every recovery candidate ships with a tamper-evident audit chain, statutory basis, signal trail, and a council-ready reclassification notice. Defensible at the State Administrative Tribunal.",
  },
  {
    title: "Pay only on recovery",
    body:
      "Success-fee pricing. No subscription, no integration cost, no risk to the rates department's budget. RatesAssist earns when the council recovers.",
  },
];

const TRUST_BADGES: ReadonlyArray<string> = [
  "WA-data resident",
  "Audit-logged",
  "Privacy Act compliant",
  "AU-region LLM",
];

export default function LandingPage() {
  return (
    <PublicLayout>
      <section className="border-b border-ink-100 bg-gradient-to-b from-white to-ink-50">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">
            RatesAssist — Rates Recovery Automation for Western Australian
            Councils
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-ink-700">
            Identify mis-rated parcels, generate audit-grade evidence packs,
            and recover under-collected rate revenue — without adding work to
            an already-stretched rates team.
          </p>
          <div className="mt-10 rounded-2xl border border-ink-100 bg-white p-6 shadow-sm md:p-8">
            <p className="text-xs uppercase tracking-widest text-ink-500">
              Across pilot councils
            </p>
            <p className="mt-2 text-4xl font-semibold text-accent-700 md:text-5xl">
              AUD 4.2M+
            </p>
            <p className="mt-1 text-sm text-ink-600">
              identified recovery opportunity to date (cumulative, manually
              updated as councils onboard).
            </p>
          </div>
          <div className="mt-10 flex flex-wrap gap-3">
            {TRUST_BADGES.map((b) => (
              <span
                key={b}
                className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs text-ink-700"
              >
                {b}
              </span>
            ))}
          </div>
          <div className="mt-10">
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=RatesAssist%20pilot%20enquiry`}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-5 py-3 text-white shadow-sm hover:bg-accent-700"
              data-testid="landing-cta"
            >
              Talk to us about a pilot →
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          How it works
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {PILLARS.map((p) => (
            <article
              key={p.title}
              className="rounded-xl border border-ink-100 bg-white p-6 shadow-sm"
            >
              <h3 className="text-lg font-semibold">{p.title}</h3>
              <p className="mt-3 text-sm text-ink-700">{p.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-ink-100 bg-ink-50">
        <div className="mx-auto max-w-6xl px-6 py-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">
            Ready to recover what you're owed?
          </h2>
          <p className="mt-3 text-ink-700">
            We run a no-obligation 30-day pilot. You see the candidates before
            any commitment.
          </p>
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=RatesAssist%20pilot%20enquiry`}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-accent-600 px-5 py-3 text-white shadow-sm hover:bg-accent-700"
          >
            Email {CONTACT_EMAIL}
          </a>
        </div>
      </section>
    </PublicLayout>
  );
}
