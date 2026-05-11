"use client";

import { Sidebar } from "@/components/Sidebar";
import { formatAud } from "@/lib/utils";
import { useFetch, LoadingState, ErrorState } from "@/lib/useFetch";
import type { Council, MismatchCandidate, Property } from "@/lib/types";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  DollarSign,
  CheckCircle2,
} from "lucide-react";
import {
  CollectionTrendChart,
  CouncilBarChart,
  SeverityChart,
} from "@/components/IntelCharts";

type DataResponse = {
  councils: Council[];
  properties: Property[];
  mismatches: MismatchCandidate[];
  stats: {
    total: number;
    high: number;
    medium: number;
    low: number;
    totalUplift: number;
    totalArrears: number;
    totalRecovery: number;
    highUplift: number;
  };
};

export default function IntelPage() {
  // PERF-007: /api/data no longer ships properties/owners/tenements in the
  // default response. The intel page needs them for the council rollups,
  // so we opt back in via the include= query param.
  const fetchState = useFetch<DataResponse>(
    "/api/data?include=properties,owners,tenements,mismatches",
  );
  if (fetchState.status === "loading") return <LoadingState />;
  if (fetchState.status === "error") return <ErrorState message={fetchState.error} />;
  const data = fetchState.data;

  const overdue = data.properties.filter((p) => p.balance > 0);
  const totalOverdue = overdue.reduce((s, p) => s + p.balance, 0);
  const totalRevenue = data.councils.reduce((s, c) => s + c.rateRevenue, 0);
  const totalRateable = data.councils.reduce((s, c) => s + c.rateableProperties, 0);
  const collectionRate = ((1 - totalOverdue / totalRevenue) * 100).toFixed(2);

  // Per-council breakdown
  const perCouncil = data.councils.map((c) => {
    const props = data.properties.filter((p) => p.council === c.code);
    const overdueC = props.filter((p) => p.balance > 0);
    const overdueAud = overdueC.reduce((s, p) => s + p.balance, 0);
    const mismatches = data.mismatches.filter((m) => m.property.council === c.code);
    const uplift = mismatches.reduce((s, m) => s + m.estUplift, 0);
    return {
      council: c,
      overdueCount: overdueC.length,
      overdueAud,
      mismatches: mismatches.length,
      mismatchUplift: uplift,
      collectionRate: ((1 - overdueAud / c.rateRevenue) * 100).toFixed(2),
    };
  });

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-ink-900">Dashboards</h1>
            <span className="badge bg-accent-100 text-accent-700">RatesIntel</span>
          </div>
          <div className="text-sm text-ink-500">
            Cross-council portfolio view · {data.councils.length} councils ·{" "}
            {totalRateable.toLocaleString()} rateable properties
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-ink-50">
          {/* Top stats */}
          <div className="grid grid-cols-4 gap-4">
            <Stat
              icon={<DollarSign className="w-5 h-5 text-accent-500" />}
              label="Annual rate revenue"
              value={formatAud(totalRevenue)}
              sub="Across portfolio"
            />
            <Stat
              icon={<CheckCircle2 className="w-5 h-5 text-success-500" />}
              label="Collection rate"
              value={`${collectionRate}%`}
              sub={`Overdue $${totalOverdue.toLocaleString()}`}
            />
            <Stat
              icon={<AlertTriangle className="w-5 h-5 text-warn-500" />}
              label="Recovery candidates"
              value={data.stats.total.toString()}
              sub={`${data.stats.high} high-confidence`}
            />
            <Stat
              icon={<TrendingUp className="w-5 h-5 text-success-500" />}
              label="Recovery opportunity"
              value={formatAud(data.stats.totalRecovery)}
              sub="Annual + 3y arrears"
              highlight
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-5 col-span-2">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-medium text-ink-900">Collection trend</div>
                  <div className="text-xs text-ink-500">Levied vs collected, last 12 months</div>
                </div>
                <span className="badge badge-success">+3.2% YoY</span>
              </div>
              <CollectionTrendChart />
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-medium text-ink-900">Recovery candidates</div>
                  <div className="text-xs text-ink-500">By severity</div>
                </div>
              </div>
              <SeverityChart
                high={data.stats.high}
                medium={data.stats.medium}
                low={data.stats.low}
              />
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium text-ink-900">Per-council recovery + arrears</div>
                <div className="text-xs text-ink-500">
                  Bars are recovery uplift opportunity (green) vs current overdue (amber).
                </div>
              </div>
            </div>
            <CouncilBarChart
              data={perCouncil.map((row) => ({
                council: row.council.code,
                uplift: row.mismatchUplift,
                overdue: row.overdueAud,
              }))}
            />
          </div>

          {/* Per-council */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-ink-200 flex items-center justify-between">
              <div className="font-medium text-ink-900">By council</div>
              <div className="text-xs text-ink-500">
                Anonymised peer comparison available with cross-council opt-in
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-ink-50">
                <tr className="text-xs uppercase tracking-wider text-ink-500">
                  <th className="text-left px-5 py-2 font-medium">Council</th>
                  <th className="text-right px-3 py-2 font-medium">Properties</th>
                  <th className="text-right px-3 py-2 font-medium">Rate revenue</th>
                  <th className="text-right px-3 py-2 font-medium">Collection</th>
                  <th className="text-right px-3 py-2 font-medium">Overdue</th>
                  <th className="text-right px-3 py-2 font-medium">Mismatches</th>
                  <th className="text-right px-5 py-2 font-medium">Uplift opp.</th>
                </tr>
              </thead>
              <tbody>
                {perCouncil.map((row) => (
                  <tr
                    key={row.council.code}
                    className="border-t border-ink-100 hover:bg-ink-50/50"
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium text-ink-900">{row.council.name}</div>
                      <div className="text-xs text-ink-500">
                        {row.council.code} · {row.council.state}
                      </div>
                    </td>
                    <td className="text-right px-3 py-3 tabular-nums">
                      {row.council.rateableProperties.toLocaleString()}
                    </td>
                    <td className="text-right px-3 py-3 tabular-nums">
                      {formatAud(row.council.rateRevenue)}
                    </td>
                    <td className="text-right px-3 py-3 tabular-nums">{row.collectionRate}%</td>
                    <td className="text-right px-3 py-3 tabular-nums text-warn-700">
                      {row.overdueCount} · {formatAud(row.overdueAud)}
                    </td>
                    <td className="text-right px-3 py-3 tabular-nums">
                      {row.mismatches > 0 ? (
                        <span className="badge badge-warn">{row.mismatches}</span>
                      ) : (
                        <span className="text-ink-400">0</span>
                      )}
                    </td>
                    <td className="text-right px-5 py-3 tabular-nums font-medium text-success-700">
                      {row.mismatchUplift > 0 ? formatAud(row.mismatchUplift) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Anomalies */}
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-5">
              <div className="font-medium text-ink-900 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warn-500" />
                Top recovery candidates
              </div>
              <div className="space-y-2">
                {data.mismatches.slice(0, 5).map((m) => (
                  <div
                    key={m.assessmentNumber}
                    className="flex items-center justify-between text-sm"
                  >
                    <div>
                      <code className="text-accent-700 text-xs font-mono">
                        {m.assessmentNumber}
                      </code>
                      <span className="text-ink-700 ml-2">{m.property.suburb}</span>
                    </div>
                    <span className="font-medium text-success-700">
                      {formatAud(m.estUplift)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-5">
              <div className="font-medium text-ink-900 mb-3 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-warn-500" />
                Top overdue accounts
              </div>
              <div className="space-y-2">
                {[...overdue]
                  .sort((a, b) => b.balance - a.balance)
                  .slice(0, 5)
                  .map((p) => (
                    <div
                      key={p.assessmentNumber}
                      className="flex items-center justify-between text-sm"
                    >
                      <div>
                        <code className="text-accent-700 text-xs font-mono">
                          {p.assessmentNumber}
                        </code>
                        <span className="text-ink-700 ml-2">{p.suburb}</span>
                      </div>
                      <span className="font-medium text-warn-700">
                        {formatAud(p.balance)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`card p-4 ${
        highlight ? "border-accent-400 bg-accent-50/40" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="label">{label}</div>
        {icon}
      </div>
      <div className="text-2xl font-semibold text-ink-900 mt-1">{value}</div>
      <div className="text-xs text-ink-500 mt-1">{sub}</div>
    </div>
  );
}
