/**
 * Public sub-processors page.
 *
 * Renders SUB-PROCESSORS.md from the repository root so the public surface
 * and the canonical document stay in lockstep. Read at server-render time
 * via the Node fs API — no caching beyond Next's default static render —
 * because the document is small, updates rarely, and any drift between the
 * .md and the page would be a compliance defect.
 *
 * If the .md file is missing at build time (e.g. a future deploy bundle
 * doesn't include the monorepo root), the page renders a stable fallback
 * pointing councils at privacy@ratesassist.com.au rather than throwing.
 * The build still succeeds — the trust page must never be a hard 500.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";

import { TrustPageShell } from "@/components/PublicLayout";
import { TrustMarkdown } from "@/components/TrustMarkdown";

export const metadata: Metadata = {
  title: "Sub-processors — RatesAssist",
  description:
    "Every third party that may process council-supplied personal information on RatesAssist's behalf, with role, residency and contract basis.",
};

// Repo root sits two directories above apps/web at build time.
// process.cwd() is apps/web during `next build` in this monorepo.
const SUB_PROCESSORS_PATH = path.resolve(
  process.cwd(),
  "..",
  "..",
  "SUB-PROCESSORS.md",
);

async function loadSubProcessorsMarkdown(): Promise<string | null> {
  try {
    return await fs.readFile(SUB_PROCESSORS_PATH, "utf8");
  } catch {
    // File missing at build time — return null so the page renders the
    // fallback rather than failing the route.
    return null;
  }
}

export default async function SubProcessorsPage() {
  const markdown = await loadSubProcessorsMarkdown();

  return (
    <TrustPageShell
      eyebrow="Trust centre"
      title="Sub-processors"
      intro={
        <p>
          A sub-processor is any third-party organisation that processes
          council-supplied or council-derived personal information on
          RatesAssist's behalf. Public-data sources are not sub-processors
          — they are upstream providers of public registers.
        </p>
      }
    >
      <section
        aria-label="Sub-processor list"
        className="rounded-xl border border-ink-100 bg-white p-6"
      >
        {markdown ? (
          <TrustMarkdown source={markdown} />
        ) : (
          <div className="text-sm text-ink-700">
            <p>
              The current sub-processor list is temporarily unavailable on
              this page. Email{" "}
              <a
                href="mailto:privacy@ratesassist.com.au?subject=Sub-processor%20list%20request"
                className="text-accent-600 underline hover:text-accent-700"
              >
                privacy@ratesassist.com.au
              </a>{" "}
              to receive the canonical version by reply.
            </p>
          </div>
        )}
      </section>

      <footer className="border-t border-ink-100 pt-6 text-sm text-ink-600">
        <p>
          Councils receive at least 30 days' written notice before any new
          sub-processor begins processing council-supplied personal
          information. Object to a proposed sub-processor or request the
          current list by emailing{" "}
          <a
            href="mailto:privacy@ratesassist.com.au"
            className="text-accent-600 underline hover:text-accent-700"
          >
            privacy@ratesassist.com.au
          </a>
          .
        </p>
      </footer>
    </TrustPageShell>
  );
}
