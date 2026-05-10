"use client";

/**
 * /alerts — newly-granted mining tenement live feed.
 *
 * The headline detection-signal page. Polls /api/grants for live SLIP/DMIRS
 * grants, lets the officer filter by LGA + lookback window, and surfaces
 * provisional flags for the 30-day wardens-court appeal window. Click-through
 * goes straight to the public MINEDEX detail record.
 */

import { useMemo, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { LoadingState, ErrorState, useFetch } from "@/lib/useFetch";
import type { Council } from "@/lib/types";
import { BellRing, ExternalLink, Filter } from "lucide-react";

type Grant = {
  tenementId: string;
  tenementIdDisplay: string;
  type: string;
  typeLabel: string;
  grantDate: string;
  grantDateMs: number;
  holder: string;
  detailUrl: string;
  provisional: boolean;
};

type GrantsResponse = {
  ok: true;
  data: {
    grants: Grant[];
    source: "live" | "seeded" | "cache";
    watermarkUsedMs: number;
    queriedAt: string;
    note?: string;
  } | null;
  output: string;
};

type CouncilsResponse = {
  councils: Council[];
};

const SINCE_OPTIONS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
];

function relativeDays(grantDateMs: number): string {
  const days = Math.max(0, Math.floor((Date.now() - grantDateMs) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export default function AlertsPage() {
  const [sinceDays, setSinceDays] = useState<number>(30);
  const [lgaName, setLgaName] = useState<string>("");
  const councilsState = useFetch<CouncilsResponse>("/api/data");

  // Build the URL for /api/grants whenever filters change. The hook re-fires.
  const url = useMemo(() => {
    const p = new URLSearchParams();
    p.set("sinceDays", String(sinceDays));
    if (lgaName.length > 0) p.set("lgaName", lgaName);
    return `/api/grants?${p.toString()}`;
  }, [sinceDays, lgaName]);

  const grantsState = useFetch<GrantsResponse>(url);

  if (councilsState.status === "loading" || grantsState.status === "loading") {
    return <LoadingState />;
  }
  if (councilsState.status === "error") {
    return <ErrorState message={councilsState.error} />;
  }
  if (grantsState.status === "error") {
    return <AlertsErrorState message={grantsState.error} retryUrl={url} />;
  }

  const grants = grantsState.data.data?.grants ?? [];
  const source = grantsState.data.data?.source ?? "live";
  const note = grantsState.data.data?.note;
  const councils = councilsState.data.councils;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
            <BellRing className="w-5 h-5 text-accent-500" />
            Newly granted tenement alerts
          </h1>
          <div className="text-sm text-ink-500">
            DMIRS via SLIP — fresh LIVE grants on parcels that may now be
            reclassifiable for higher rates.
            <span className="ml-2 text-[11px] uppercase tracking-widest text-ink-400">
              source: {source}
            </span>
          </div>
        </div>

        <div className="px-6 py-3 border-b border-ink-200 bg-white flex flex-wrap items-center gap-3">
          <Filter className="w-4 h-4 text-ink-500" />
          <label className="text-sm text-ink-700">
            LGA:
            <select
              value={lgaName}
              onChange={(e) => setLgaName(e.target.value)}
              className="ml-2 px-2 py-1 text-sm border border-ink-300 rounded bg-white"
            >
              <option value="">All</option>
              {councils.map((c) => (
                <option key={c.code} value={c.name}>
                  {c.name} ({c.state})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-ink-700">
            Since:
            <select
              value={sinceDays}
              onChange={(e) => setSinceDays(Number(e.target.value))}
              className="ml-2 px-2 py-1 text-sm border border-ink-300 rounded bg-white"
            >
              {SINCE_OPTIONS.map((o) => (
                <option key={o.days} value={o.days}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto text-xs text-ink-500 tabular-nums">
            {grants.length} grant{grants.length === 1 ? "" : "s"} matching filters
          </div>
        </div>

        {note !== undefined && (
          <div className="px-6 py-2 bg-warn-50 text-xs text-warn-700 border-b border-warn-300">
            {note}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 bg-ink-50">
          {grants.length === 0 ? (
            <div className="card p-8 text-center text-ink-600">
              <BellRing className="w-8 h-8 mx-auto mb-3 text-ink-300" />
              <div className="font-medium text-ink-900 mb-1">
                No grants matching filters in this period.
              </div>
              <div className="text-sm">
                This page surfaces newly granted live mining tenements (DMIRS
                via SLIP). When a fresh grant lands on a parcel currently
                rated rural or vacant, the council can lawfully reclassify it
                for higher rates — that&apos;s the recovery moment.
              </div>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-ink-100 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium text-ink-700">Tenement</th>
                    <th className="px-4 py-2 font-medium text-ink-700">Type</th>
                    <th className="px-4 py-2 font-medium text-ink-700">Holder</th>
                    <th className="px-4 py-2 font-medium text-ink-700">Granted</th>
                    <th className="px-4 py-2 font-medium text-ink-700">Status</th>
                    <th className="px-4 py-2 font-medium text-ink-700">MINEDEX</th>
                  </tr>
                </thead>
                <tbody>
                  {grants.map((g) => (
                    <tr
                      key={g.tenementId}
                      className="border-t border-ink-200 hover:bg-ink-50"
                    >
                      <td className="px-4 py-2 font-mono text-ink-900">
                        {g.tenementIdDisplay}
                      </td>
                      <td className="px-4 py-2 text-ink-700">{g.typeLabel}</td>
                      <td className="px-4 py-2 text-ink-700">{g.holder}</td>
                      <td
                        className="px-4 py-2 text-ink-700 tabular-nums"
                        title={g.grantDate}
                      >
                        {relativeDays(g.grantDateMs)}
                      </td>
                      <td className="px-4 py-2">
                        {g.provisional ? (
                          <span className="text-[11px] uppercase tracking-widest px-2 py-0.5 rounded bg-warn-100 text-warn-700 border border-warn-300">
                            Provisional
                          </span>
                        ) : (
                          <span className="text-[11px] uppercase tracking-widest text-ink-400">
                            Final
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <a
                          href={g.detailUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-accent-700 hover:underline"
                        >
                          Open
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function AlertsErrorState({ message, retryUrl: _retryUrl }: { message: string; retryUrl: string }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex items-center justify-center">
        <div className="card p-6 max-w-md text-center">
          <div className="text-critical-700 font-medium mb-1">
            Failed to load grants
          </div>
          <div className="text-sm text-ink-600 mb-3">{message}</div>
          <button
            onClick={() => window.location.reload()}
            className="text-sm px-3 py-1 rounded bg-accent-500 text-white hover:bg-accent-600"
          >
            Retry
          </button>
        </div>
      </main>
    </div>
  );
}
