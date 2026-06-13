/**
 * PublicLayout — minimal chrome for unauthenticated marketing and trust pages.
 *
 * Mirrors the app's Arial font family but drops the sidebar, auth state,
 * and any data-fetching scaffolding. Pages that render under this layout
 * MUST NOT depend on session or tenant context.
 *
 * The footer renders the trust-index links so a council CFO landing on any
 * marketing or trust page can pivot directly into security / status /
 * changelog / privacy / sub-processors without hunting through the site.
 */

import Link from "next/link";

import { Wordmark } from "./Brand";

/* Keyboard-focus treatment (WCAG 2.4.7). The design system is hover-only;
 * these append a visible focus-visible ring so keyboard users can see where
 * they are. Shared across every public page that renders this chrome. */
const FOCUS_LINK =
  "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2";
const FOCUS_BTN =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2";

const TRUST_FOOTER_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/trust", label: "Trust centre" },
  { href: "/security", label: "Security" },
  { href: "/status", label: "Status" },
  { href: "/changelog", label: "Changelog" },
  { href: "/privacy", label: "Privacy" },
  { href: "/trust/sub-processors", label: "Sub-processors" },
];

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-ink-900 font-sans">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent-600 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <header className="border-b border-ink-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Wordmark size="md" />
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/how-it-works"
              className={`text-ink-600 hover:text-ink-900 ${FOCUS_LINK}`}
            >
              How it works
            </Link>
            <Link
              href="/trust"
              className={`text-ink-600 hover:text-ink-900 ${FOCUS_LINK}`}
            >
              Trust
            </Link>
            <a
              href="mailto:brodie@amalafinance.com.au"
              className={`text-ink-600 hover:text-ink-900 ${FOCUS_LINK}`}
            >
              Contact
            </a>
            <Link
              href="/login"
              className={`rounded-md bg-accent-600 px-3 py-1.5 text-white hover:bg-accent-700 ${FOCUS_BTN}`}
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main id="main-content" className="flex-1">{children}</main>
      <footer className="border-t border-ink-100 bg-ink-50">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-ink-600 md:flex-row md:items-start md:justify-between">
          <p className="max-w-md">
            RatesAssist is operated by Amala Finance Pty Ltd, an Australian
            company. Council-supplied data is resident in AU-Southeast.
          </p>
          <nav aria-label="Trust documents">
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
              {TRUST_FOOTER_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className={`hover:text-ink-900 ${FOCUS_LINK}`}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/**
 * TrustPageShell — opinionated content wrapper for the trust artefacts
 * (security, status, changelog, privacy, /trust index, /trust/sub-processors).
 *
 * Provides the constrained max-w-3xl reading column, the page title block,
 * and the "Back to product" link. Pages render their own sections inside.
 */
export function TrustPageShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <PublicLayout>
      <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <div className="mb-8">
          <Link
            href="/"
            className={`text-sm text-ink-500 hover:text-ink-900 ${FOCUS_LINK}`}
          >
            <span aria-hidden="true">←</span> Back to product
          </Link>
        </div>
        {eyebrow ? (
          <p className="text-xs uppercase tracking-widest text-ink-500">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
          {title}
        </h1>
        {intro ? (
          <div className="mt-4 text-base text-ink-700">{intro}</div>
        ) : null}
        <div className="mt-10 space-y-10 text-ink-800">{children}</div>
      </div>
    </PublicLayout>
  );
}
