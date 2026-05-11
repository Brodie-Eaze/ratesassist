"use client";

/**
 * LiveGrantsWidget — pinned "Live DMIRS feed" panel.
 *
 * Mounts on /recovery and /intel to make the live DMIRS connection visible.
 * Calls GET /api/grants?sinceDays=14 directly via useFetch — the dashboard
 * elsewhere reads from the recovery engine which runs over demo property
 * fixtures, leading some viewers to believe the entire system is mocked.
 * This widget surfaces the unfiltered, live grants feed regardless of
 * whether any grant intersects a council-registered parcel.
 *
 * Honest source labelling: the API returns `source: "live" | "seeded"`; the
 * widget surfaces it in the badge so operators can tell at a glance whether
 * DMIRS is reachable. NEVER silently falls back to mock data.
 */

import Link from "next/link";
import { useFetch } from "@/lib/useFetch";
import { BellRing, ExternalLink, RefreshCw } from "lucide-react";

type Grant = {
  readonly tenementId: string;
  readonly tenementIdDisplay: string;
  readonly type: string;
  readonly typeLabel: string;
  readonly grantDate: string;
  readonly grantDateMs: number;
  readonly holder: string;
  readonly provisional: boolean;
};

type GrantsResponse = {
  readonly ok: boolean;
  readonly data: {
    readonly grants: readonly Grant[];
    readonly source?: "live" | "seeded";
    readonly note?: string;
  } | null;
  readonly output?: string;
};

const SINCE_DAYS = 14;
const ENDPOINT = `/api/grants?sinceDays=${SINCE_DAYS}`;

function relativeTime(grantDateMs: number, now: number = Date.now()): string {
  const diff = now - grantDateMs;
  if (diff < 0) return "just now";
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diff / day);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  return `${Math.floor(days / 7)} weeks ago`;
}

export function LiveGrantsWidget({ className = "" }: { className?: string }) {
  const state = useFetch<GrantsResponse>(ENDPOINT);

  const inner = (() => {
    if (state.status === "loading") {
      return (
        <div className="space-y-2" aria-label="Loading live grants">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-7 bg-ink-100 animate-pulse rounded"
            />
          ))}
        </div>
      );
    }
    if (state.status === "error") {
      return (
        <div className="text-sm">
          <div className="text-critical-700 font-medium mb-1">
            Failed to load live DMIRS feed
          </div>
          <div className="text-ink-600 mb-2">{state.error}</div>
          <button
            onClick={() => {
              // useFetch re-runs on URL change; cheapest retry is a reload.
              window.location.reload();
            }}
            className="btn bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      );
    }

    const grants = state.data.data?.grants ?? [];
    if (grants.length === 0) {
      return (
        <div className="text-sm text-ink-500 py-4 text-center">
          No new grants from DMIRS in the last {SINCE_DAYS} days.
        </div>
      );
    }

    const top = grants.slice(0, 5);
    const overflow = grants.length - top.length;

    return (
      <div>
        <table className="w-full text-sm" style={{ fontFamily: "Arial, sans-serif" }}>
          <thead>
            <tr className="text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
              <th className="text-left py-1.5 pr-3 font-medium">Tenement</th>
              <th className="text-left py-1.5 pr-3 font-medium">Type</th>
              <th className="text-left py-1.5 pr-3 font-medium">Holder</th>
              <th className="text-right py-1.5 font-medium">Granted</th>
            </tr>
          </thead>
          <tbody>
            {top.map((g) => (
              <tr
                key={g.tenementId}
                className="border-b border-ink-100 last:border-b-0 hover:bg-ink-50/60 transition-colors"
              >
                <td className="py-1.5 pr-3">
                  <Link
                    href={`/alerts/${encodeURIComponent(g.tenementId)}`}
                    className="text-accent-700 font-mono text-xs hover:underline inline-flex items-center gap-1"
                  >
                    {g.tenementIdDisplay}
                    {g.provisional && (
                      <span
                        className="badge bg-warn-100 text-warn-700 text-[9px]"
                        title="Within 30-day appeal window"
                      >
                        prov.
                      </span>
                    )}
                  </Link>
                </td>
                <td className="py-1.5 pr-3 text-ink-700">{g.typeLabel}</td>
                <td className="py-1.5 pr-3 text-ink-700 truncate max-w-[16rem]">
                  {g.holder}
                </td>
                <td className="py-1.5 text-right tabular-nums text-ink-600 text-xs">
                  {relativeTime(g.grantDateMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {overflow > 0 && (
          <div className="mt-2 text-right">
            <Link
              href="/alerts"
              className="text-xs text-accent-700 hover:underline inline-flex items-center gap-1"
            >
              and {overflow} more
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        )}
      </div>
    );
  })();

  const source =
    state.status === "ok" ? state.data.data?.source ?? "live" : null;

  return (
    <div
      className={`card p-5 border border-ink-200 rounded ${className}`}
      style={{ fontFamily: "Arial, sans-serif" }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BellRing className="w-4 h-4 text-accent-500" />
          <div className="font-medium text-ink-900">
            Live DMIRS feed — last {SINCE_DAYS} days
          </div>
        </div>
        {source !== null && (
          <span
            className={`badge ${
              source === "live"
                ? "bg-success-50 text-success-700"
                : "bg-warn-50 text-warn-700"
            } text-[10px] uppercase tracking-wider`}
            title={
              source === "live"
                ? "Streaming directly from DMIRS SLIP"
                : "DMIRS unreachable — showing seeded fallback"
            }
          >
            SOURCE: {source}
          </span>
        )}
      </div>
      {inner}
    </div>
  );
}
