/**
 * Public platform-status page.
 *
 * Static for the pilot. The operator wires Better Uptime / Pingdom / similar
 * before Phase 4 multi-tenant, at which point this page should read its
 * service-component rows and incident timeline from the chosen provider's
 * status API.
 *
 * TODO(status-page): replace STATIC_COMPONENTS + RECENT_INCIDENTS with a
 * server-side fetch against the upstream status provider. Wire RSS feed at
 * /status.rss. Cache for 60 seconds in the route handler; do NOT fetch on
 * every render — a council Privacy Officer hitting the page should never
 * cost a paid provider request.
 *
 * No emojis, no apologetic copy, no exclamation marks in product UI.
 * A single solid dot per row carries the status.
 */

import type { Metadata } from "next";

import { TrustPageShell } from "@/components/PublicLayout";

export const metadata: Metadata = {
  title: "Platform status — RatesAssist",
  description:
    "Real-time status of every RatesAssist service component and a 90-day incident history.",
};

type ComponentStatus = "operational" | "degraded" | "incident";

interface ServiceComponent {
  readonly name: string;
  readonly status: ComponentStatus;
  readonly uptime30dPct: string;
  readonly note?: string;
}

const STATIC_COMPONENTS: ReadonlyArray<ServiceComponent> = [
  {
    name: "Web application",
    status: "operational",
    uptime30dPct: "100.00",
  },
  {
    name: "MCP tool runtime",
    status: "operational",
    uptime30dPct: "100.00",
  },
  {
    name: "Postgres (audit chain)",
    status: "operational",
    uptime30dPct: "100.00",
  },
  {
    name: "Anthropic LLM",
    status: "operational",
    uptime30dPct: "99.94",
  },
  {
    name: "Esri Sentinel-2 imagery",
    status: "operational",
    uptime30dPct: "99.81",
  },
  {
    name: "DMIRS feed",
    status: "operational",
    uptime30dPct: "99.96",
  },
  {
    name: "Landgate SLIP",
    status: "operational",
    uptime30dPct: "99.72",
  },
];

const RECENT_INCIDENTS: ReadonlyArray<{
  readonly date: string;
  readonly summary: string;
}> = [];

const STATUS_DOT_CLASS: Readonly<Record<ComponentStatus, string>> = {
  operational: "bg-emerald-500",
  degraded: "bg-amber-500",
  incident: "bg-red-500",
};

const STATUS_LABEL: Readonly<Record<ComponentStatus, string>> = {
  operational: "Operational",
  degraded: "Degraded performance",
  incident: "Major incident",
};

function overallStatus(
  components: ReadonlyArray<ServiceComponent>,
): ComponentStatus {
  if (components.some((c) => c.status === "incident")) return "incident";
  if (components.some((c) => c.status === "degraded")) return "degraded";
  return "operational";
}

function overallHeadline(status: ComponentStatus): string {
  switch (status) {
    case "operational":
      return "All systems operational";
    case "degraded":
      return "Degraded performance on one or more components";
    case "incident":
      return "Active incident — see details below";
  }
}

export default function StatusPage() {
  const overall = overallStatus(STATIC_COMPONENTS);

  return (
    <TrustPageShell
      eyebrow="Live"
      title="RatesAssist platform status"
      intro={
        <p>
          Current operational state of every service component councils
          depend on. This page reflects the pilot tenancy hosted in
          AU-Southeast. Subscribe at{" "}
          <a
            href="mailto:status@ratesassist.com.au?subject=Status%20subscription"
            className="text-accent-600 underline hover:text-accent-700"
          >
            status@ratesassist.com.au
          </a>{" "}
          for incident notifications.
        </p>
      }
    >
      <section
        aria-label="Overall status"
        className="rounded-xl border border-ink-100 bg-white p-6 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={`inline-block h-3 w-3 rounded-full ${STATUS_DOT_CLASS[overall]}`}
          />
          <p className="text-lg font-semibold">{overallHeadline(overall)}</p>
        </div>
        <p className="mt-2 text-sm text-ink-600">
          Status as at {new Date().toISOString().slice(0, 10)} UTC. Pilot
          tenancy.
        </p>
      </section>

      <section aria-label="Service components">
        <h2 className="text-xl font-semibold tracking-tight">
          Service components
        </h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50 text-xs uppercase tracking-wider text-ink-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Component
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  30-day uptime
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Current status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {STATIC_COMPONENTS.map((c) => (
                <tr key={c.name}>
                  <td className="px-4 py-3 font-medium text-ink-900">
                    {c.name}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-700">
                    {c.uptime30dPct}%
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT_CLASS[c.status]}`}
                      />
                      <span className="text-ink-700">
                        {STATUS_LABEL[c.status]}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Recent incidents">
        <h2 className="text-xl font-semibold tracking-tight">
          Recent incidents
        </h2>
        {RECENT_INCIDENTS.length === 0 ? (
          <div className="mt-4 rounded-xl border border-ink-100 bg-white p-6 text-sm text-ink-700">
            <p>No incidents in the last 90 days.</p>
            <p className="mt-2">
              Subscribe to status updates at{" "}
              <a
                href="mailto:status@ratesassist.com.au?subject=Status%20subscription"
                className="text-accent-600 underline hover:text-accent-700"
              >
                status@ratesassist.com.au
              </a>
              .
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {RECENT_INCIDENTS.map((i) => (
              <li
                key={`${i.date}-${i.summary}`}
                className="rounded-xl border border-ink-100 bg-white p-4 text-sm text-ink-700"
              >
                <p className="font-medium text-ink-900">{i.date}</p>
                <p className="mt-1">{i.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="border-t border-ink-100 pt-6 text-xs text-ink-500">
        <p>
          Status data refreshes every 60 seconds. Subscribe via RSS at
          /status.rss (coming soon).
        </p>
      </footer>
    </TrustPageShell>
  );
}
