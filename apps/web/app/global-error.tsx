"use client";

/**
 * Root error boundary — App Router's `global-error.tsx` catches errors
 * that bubble past every `error.tsx` and the layout itself.
 *
 * Must be a client component (App Router contract) and must render its
 * own `<html>` + `<body>` because the layout chain failed.
 *
 * On error: dispatch to Sentry (no-op when `SENTRY_DSN` unset; see
 * `lib/sentry.ts`) and render a minimal AU-English fallback with a
 * "try again" affordance backed by Next's reset callback.
 */

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}): React.ReactNode {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 py-12 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Something went wrong.
          </h1>
          <p className="mt-3 text-sm text-neutral-600">
            We&rsquo;ve been notified and are looking into it. Please try
            again in a moment.
          </p>
          {error.digest !== undefined && error.digest !== "" ? (
            <p className="mt-4 font-mono text-xs text-neutral-400">
              ref: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="mt-6 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
