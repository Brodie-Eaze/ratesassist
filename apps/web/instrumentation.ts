/**
 * Next.js instrumentation hook — runs once on process start, for both
 * Node.js and Edge runtimes. The only legal place to call
 * `Sentry.init()` under Next 14's App Router.
 *
 * `initSentry()` itself is a no-op when `SENTRY_DSN` is unset, so this
 * file is safe to ship without an account configured.
 */

import { initSentry } from "@/lib/sentry";

export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    initSentry();
  }
  // Edge runtime: same module, same gate. Sentry's nextjs SDK fans the
  // edge build out automatically via webpack; we just need to call
  // `init` from the edge entry too. Kept gated so dev hot-reload doesn't
  // double-wire.
  if (process.env["NEXT_RUNTIME"] === "edge") {
    initSentry();
  }
}
