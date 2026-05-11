/**
 * PublicLayout — minimal chrome for unauthenticated marketing pages.
 *
 * Mirrors the app's Arial font family but drops the sidebar, auth state,
 * and any data-fetching scaffolding. Pages that render under this layout
 * MUST NOT depend on session or tenant context.
 */

import Link from "next/link";

import { Wordmark } from "./Brand";

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-ink-900 font-sans">
      <header className="border-b border-ink-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Wordmark size="md" />
          <nav className="flex items-center gap-4 text-sm">
            <a
              href="mailto:brodie@amalafinance.com.au"
              className="text-ink-600 hover:text-ink-900"
            >
              Contact
            </a>
            <Link
              href="/login"
              className="rounded-md bg-accent-600 px-3 py-1.5 text-white hover:bg-accent-700"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-ink-100 bg-ink-50">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-6 text-sm text-ink-600 md:flex-row md:items-center md:justify-between">
          <p>
            RatesAssist is operated by Amala Finance Pty Ltd, an Australian
            company. Data resident in AU-Southeast.
          </p>
          <ul className="flex gap-4">
            <li>
              <a href="/PRIVACY.md" className="hover:text-ink-900">
                Privacy
              </a>
            </li>
            <li>
              <a href="/SECURITY.md" className="hover:text-ink-900">
                Security
              </a>
            </li>
            <li>
              <a href="/api/openapi" className="hover:text-ink-900">
                API
              </a>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
