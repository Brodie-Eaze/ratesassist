"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { useFetch, LoadingState, ErrorState } from "@/lib/useFetch";
import type { Integration, IntegrationStatus } from "@/lib/types";
import {
  CheckCircle2,
  AlertCircle,
  CircleDashed,
  XCircle,
  Activity,
  ChevronRight,
} from "lucide-react";

type DataResponse = { integrations: Integration[] };

const STATUS_META: Record<
  IntegrationStatus,
  { icon: typeof CheckCircle2; cls: string; label: string }
> = {
  live: { icon: CheckCircle2, cls: "text-success-700 bg-success-50", label: "Live" },
  degraded: { icon: AlertCircle, cls: "text-warn-700 bg-warn-50", label: "Degraded" },
  unconfigured: {
    icon: CircleDashed,
    cls: "text-ink-600 bg-ink-100",
    label: "Not configured",
  },
  error: { icon: XCircle, cls: "text-critical-700 bg-critical-50", label: "Error" },
};

export default function ConnectionsPage() {
  const fetchState = useFetch<DataResponse>("/api/integrations");
  const [filter, setFilter] = useState<string>("All");

  if (fetchState.status === "loading") return <LoadingState />;
  if (fetchState.status === "error") return <ErrorState message={fetchState.error} />;
  const data = fetchState.data;

  const categories = ["All", ...Array.from(new Set(data.integrations.map((i) => i.category)))];
  const filtered =
    filter === "All"
      ? data.integrations
      : data.integrations.filter((i) => i.category === filter);

  const counts = {
    live: data.integrations.filter((i) => i.status === "live").length,
    degraded: data.integrations.filter((i) => i.status === "degraded").length,
    unconfigured: data.integrations.filter((i) => i.status === "unconfigured").length,
    error: data.integrations.filter((i) => i.status === "error").length,
    total: data.integrations.length,
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-accent-500" />
            Connections
          </h1>
          <div className="text-sm text-ink-500">
            {counts.total} integrations · {counts.live} live · {counts.degraded} degraded ·{" "}
            {counts.unconfigured} not configured
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-ink-50">
          {/* Health summary */}
          <div className="grid grid-cols-4 gap-4">
            <Health
              label="Live"
              count={counts.live}
              total={counts.total}
              colour="success"
            />
            <Health
              label="Degraded"
              count={counts.degraded}
              total={counts.total}
              colour="warn"
            />
            <Health
              label="Not configured"
              count={counts.unconfigured}
              total={counts.total}
              colour="ink"
            />
            <Health
              label="Error"
              count={counts.error}
              total={counts.total}
              colour="critical"
            />
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-ink-500">Filter:</span>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`btn ${
                  filter === cat
                    ? "bg-ink-900 text-white"
                    : "bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Integrations grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filtered.map((i) => (
              <IntegrationCard key={i.id} integration={i} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function Health({
  label,
  count,
  total,
  colour,
}: {
  label: string;
  count: number;
  total: number;
  colour: "success" | "warn" | "ink" | "critical";
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const cls = {
    success: { text: "text-success-700", bar: "bg-success-500" },
    warn: { text: "text-warn-700", bar: "bg-warn-500" },
    ink: { text: "text-ink-700", bar: "bg-ink-400" },
    critical: { text: "text-critical-700", bar: "bg-critical-500" },
  }[colour];
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className={`text-2xl font-semibold ${cls.text}`}>{count}</span>
      </div>
      <div className="mt-2 h-1.5 bg-ink-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${cls.bar} transition-all`}
          style={{ width: `${pct}%` }}
        ></div>
      </div>
    </div>
  );
}

function IntegrationCard({ integration: i }: { integration: Integration }) {
  const meta = STATUS_META[i.status];
  const Icon = meta.icon;
  return (
    <div className="card p-5 hover:border-accent-400 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-medium text-ink-900">{i.name}</span>
            <span className={`badge ${meta.cls}`}>
              <Icon className="w-3 h-3 mr-1 inline" />
              {meta.label}
            </span>
          </div>
          <div className="text-xs text-ink-500">
            {i.category}
            {i.vendor && <span> · {i.vendor}</span>}
            {i.authType && <span> · {i.authType}</span>}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-ink-400 shrink-0" />
      </div>
      <div className="text-sm text-ink-700 mb-3">{i.description}</div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        {i.scope && (
          <div>
            <div className="label mb-0.5">Scope</div>
            <div className="text-ink-600 font-mono leading-snug">{i.scope}</div>
          </div>
        )}
        {i.lastSync && (
          <div>
            <div className="label mb-0.5">Last sync</div>
            <div className="text-ink-600">{i.lastSync}</div>
          </div>
        )}
        {i.endpoint && (
          <div className="col-span-2">
            <div className="label mb-0.5">Endpoint</div>
            <code className="text-[11px] text-accent-700 break-all">{i.endpoint}</code>
          </div>
        )}
      </div>
    </div>
  );
}
