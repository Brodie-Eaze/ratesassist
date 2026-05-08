"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { formatAud } from "@/lib/utils";
import { useFetch, LoadingState, ErrorState } from "@/lib/useFetch";
import {
  Building,
  CheckCircle2,
  AlertCircle,
  CircleDashed,
  Sparkles,
  Lock,
  Database,
  Plug,
  Users,
  TrendingUp,
} from "lucide-react";
import type {
  AdapterStatus,
  AuxiliaryAdapter,
  RatingAdapter,
  TenantRegistration,
} from "@/lib/tenants";

type Catalogue = {
  id: string;
  name: string;
  category: string;
  vendor: string;
  authTypes: string[];
  description: string;
  state: "Generally Available" | "Beta" | "Roadmap";
};

type Benchmark = {
  metric: string;
  description: string;
  unit: string;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  yourCouncilValue?: number;
  yourCouncilPercentile?: number;
};

type DataResponse = {
  tenants: TenantRegistration[];
  catalogue: Catalogue[];
  benchmarks: Benchmark[];
};

const STATUS_META: Record<
  AdapterStatus,
  { icon: typeof CheckCircle2; cls: string; label: string }
> = {
  live: { icon: CheckCircle2, cls: "text-success-700 bg-success-50", label: "Live" },
  degraded: { icon: AlertCircle, cls: "text-warn-700 bg-warn-50", label: "Degraded" },
  configuring: { icon: CircleDashed, cls: "text-accent-700 bg-accent-50", label: "Configuring" },
  unconfigured: { icon: CircleDashed, cls: "text-ink-600 bg-ink-100", label: "Not configured" },
  error: { icon: AlertCircle, cls: "text-critical-700 bg-critical-50", label: "Error" },
};

const STATE_META: Record<
  Catalogue["state"],
  { cls: string }
> = {
  "Generally Available": { cls: "bg-success-50 text-success-700" },
  Beta: { cls: "bg-warn-50 text-warn-700" },
  Roadmap: { cls: "bg-ink-100 text-ink-600" },
};

export default function TenantsPage() {
  const fetchState = useFetch<DataResponse>("/api/tenants");
  const [tab, setTab] = useState<"tenants" | "catalogue" | "benchmarks">("tenants");

  if (fetchState.status === "loading") return <LoadingState />;
  if (fetchState.status === "error") return <ErrorState message={fetchState.error} />;
  const data = fetchState.data;

  const liveCount = data.tenants.filter((t) => t.rating.status === "live").length;
  const totalParcels = data.tenants.reduce((s, t) => s + t.metrics.parcelsMirrored, 0);
  const totalCandidates = data.tenants.reduce((s, t) => s + t.metrics.candidatesOpen, 0);
  const totalUplift = data.tenants.reduce((s, t) => s + t.metrics.upliftPipelineAud, 0);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
            <Building className="w-5 h-5 text-accent-500" />
            Tenants & Plug-in Architecture
          </h1>
          <div className="text-sm text-ink-500">
            Multi-tenant: each council is a tenant with isolated data, its own rating-system adapter, and opt-in cross-council intelligence
          </div>
        </div>

        {/* Tab strip */}
        <div className="px-6 pt-4 bg-white border-b border-ink-200">
          <div className="flex gap-1">
            {(
              [
                { id: "tenants", label: `Tenants (${data.tenants.length})` },
                { id: "catalogue", label: `Adapter catalogue (${data.catalogue.length})` },
                { id: "benchmarks", label: `Cross-council intelligence` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm border-b-2 transition-colors ${
                  tab === t.id
                    ? "border-accent-600 text-ink-900 font-medium"
                    : "border-transparent text-ink-500 hover:text-ink-900"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-ink-50">
          {/* Top stats */}
          <div className="grid grid-cols-4 gap-4">
            <Stat
              icon={<Building className="w-5 h-5 text-accent-500" />}
              label="Active tenants"
              value={data.tenants.length.toString()}
              sub={`${liveCount} live · ${data.tenants.length - liveCount} configuring/degraded`}
            />
            <Stat
              icon={<Database className="w-5 h-5 text-accent-500" />}
              label="Parcels mirrored"
              value={totalParcels.toLocaleString()}
              sub="across active rating-system adapters"
            />
            <Stat
              icon={<Sparkles className="w-5 h-5 text-warn-500" />}
              label="Candidates open (cross-tenant)"
              value={totalCandidates.toString()}
              sub="aggregated across all tenants"
            />
            <Stat
              icon={<TrendingUp className="w-5 h-5 text-success-500" />}
              label="Recovery pipeline"
              value={formatAud(totalUplift)}
              sub="annual uplift opportunity portfolio-wide"
              highlight
            />
          </div>

          {tab === "tenants" && (
            <div className="space-y-3">
              {data.tenants.map((t) => (
                <TenantCard key={t.council.code} tenant={t} />
              ))}
            </div>
          )}

          {tab === "catalogue" && (
            <CatalogueGrid items={data.catalogue} />
          )}

          {tab === "benchmarks" && (
            <BenchmarkPanel benchmarks={data.benchmarks} tenantCount={data.tenants.filter((t) => t.benchmarkOptIn).length} />
          )}
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
    <div className={`card p-4 ${highlight ? "border-accent-400 bg-accent-50/40" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="label">{label}</div>
        {icon}
      </div>
      <div className="text-2xl font-semibold text-ink-900 mt-1">{value}</div>
      <div className="text-xs text-ink-500 mt-1">{sub}</div>
    </div>
  );
}

function TenantCard({ tenant: t }: { tenant: TenantRegistration }) {
  const meta = STATUS_META[t.rating.status];
  const Icon = meta.icon;
  const enabledAuxCount = t.auxiliary.filter((a) => a.enabled).length;
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="font-medium text-ink-900">{t.council.name}</span>
            <span className="badge bg-ink-100 text-ink-700 text-[10px]">{t.council.state}</span>
            <span className={`badge ${meta.cls}`}>
              <Icon className="w-3 h-3 mr-1 inline" />
              {meta.label}
            </span>
            <span className="badge bg-ink-100 text-ink-700">{t.contractType}</span>
            {t.benchmarkOptIn && (
              <span className="badge bg-accent-50 text-accent-700">Benchmark opt-in</span>
            )}
          </div>
          <div className="text-xs text-ink-500">
            Tenant <code className="text-accent-700">{t.council.code}</code> · ABN{" "}
            <code className="text-ink-700">{t.abn}</code> · contract from {t.contractStart}
          </div>
        </div>
        <div className="text-xs text-right">
          <div className="text-ink-500 flex items-center justify-end gap-1">
            <Lock className="w-3 h-3" />
            {t.isolation === "physical-vpc" ? "Physical isolation" : "Logical RLS"}
          </div>
        </div>
      </div>

      {/* Adapter row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Rating adapter */}
        <div className="border border-ink-200 rounded-lg p-3 bg-ink-50/50">
          <div className="text-xs uppercase tracking-wider text-ink-500 mb-1.5 flex items-center gap-1.5">
            <Plug className="w-3 h-3" />
            Rating-system adapter
          </div>
          <div className="font-medium text-sm text-ink-900">{t.rating.platform}</div>
          <div className="text-xs text-ink-500">
            {t.rating.vendor} · {t.rating.authType}
          </div>
          {t.rating.endpoint && (
            <code className="block mt-1 text-[10px] text-accent-700 break-all">
              {t.rating.endpoint}
            </code>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-ink-500">Last sync</span>
              <div className="text-ink-900">{t.rating.lastSync}</div>
            </div>
            <div>
              <span className="text-ink-500">Cadence</span>
              <div className="text-ink-900">{t.rating.syncCadence}</div>
            </div>
            <div className="col-span-2">
              <span className="text-ink-500">Capabilities</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {t.rating.capabilities.length === 0 ? (
                  <span className="text-ink-400 text-[11px]">none yet</span>
                ) : (
                  t.rating.capabilities.map((c) => (
                    <code key={c} className="text-[10px] bg-white border border-ink-200 px-1.5 py-0.5 rounded text-accent-700">
                      {c}
                    </code>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Auxiliary adapters */}
        <div className="border border-ink-200 rounded-lg p-3 bg-ink-50/50">
          <div className="text-xs uppercase tracking-wider text-ink-500 mb-1.5 flex items-center gap-1.5">
            <Plug className="w-3 h-3" />
            Auxiliary adapters ({enabledAuxCount} enabled)
          </div>
          <div className="space-y-1.5">
            {t.auxiliary.map((a) => (
              <AuxRow key={a.id} aux={a} />
            ))}
          </div>
        </div>

        {/* Metrics */}
        <div className="border border-ink-200 rounded-lg p-3 bg-ink-50/50">
          <div className="text-xs uppercase tracking-wider text-ink-500 mb-1.5">
            Metrics
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <span className="text-ink-500">Parcels mirrored</span>
            <span className="text-right tabular-nums text-ink-900">
              {t.metrics.parcelsMirrored.toLocaleString()}
            </span>
            <span className="text-ink-500">Officers active</span>
            <span className="text-right tabular-nums text-ink-900">{t.metrics.officersActive}</span>
            <span className="text-ink-500">Candidates open</span>
            <span className="text-right tabular-nums text-warn-700">{t.metrics.candidatesOpen}</span>
            <span className="text-ink-500">Uplift pipeline</span>
            <span className="text-right tabular-nums text-success-700 font-medium">
              {formatAud(t.metrics.upliftPipelineAud)}
            </span>
            <span className="text-ink-500">Audit events (30d)</span>
            <span className="text-right tabular-nums text-ink-900">
              {t.metrics.auditEvents30d.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuxRow({ aux }: { aux: AuxiliaryAdapter }) {
  const meta = STATUS_META[aux.status];
  const Icon = meta.icon;
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-1.5 text-ink-700 truncate">
        <Icon className={`w-3 h-3 shrink-0 ${aux.status === "live" ? "text-success-500" : aux.status === "configuring" ? "text-accent-500" : "text-ink-400"}`} />
        {aux.name}
      </span>
      <span className={`badge ${meta.cls} text-[9px]`}>{meta.label}</span>
    </div>
  );
}

function CatalogueGrid({ items }: { items: Catalogue[] }) {
  const grouped = items.reduce<Record<string, Catalogue[]>>((acc, i) => {
    (acc[i.category] = acc[i.category] ?? []).push(i);
    return acc;
  }, {});
  return (
    <div className="space-y-5">
      <div className="card p-4 bg-accent-50/40 border-accent-200">
        <div className="text-sm text-ink-700 leading-relaxed">
          <strong>How adapters work.</strong> Each integration is a self-contained plug-in implementing a
          standard interface (<code>read.property</code>, <code>read.owner</code>, <code>write.note</code>, etc.).
          Adding a new platform = writing one adapter; the rest of RatesAssist consumes it through the same contract.
          Tenants enable only the adapters they need.
        </div>
      </div>
      {Object.entries(grouped).map(([cat, list]) => (
        <section key={cat}>
          <h2 className="text-sm font-medium uppercase tracking-wider text-ink-500 mb-2">{cat}</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {list.map((i) => (
              <CatalogueCard key={i.id} item={i} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CatalogueCard({ item }: { item: Catalogue }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="font-medium text-sm text-ink-900">{item.name}</div>
        <span className={`badge ${STATE_META[item.state].cls} text-[10px]`}>{item.state}</span>
      </div>
      <div className="text-xs text-ink-500 mb-2">{item.vendor}</div>
      <div className="text-sm text-ink-700 mb-2">{item.description}</div>
      <div className="flex flex-wrap gap-1">
        {item.authTypes.map((a) => (
          <code key={a} className="text-[10px] bg-ink-100 px-1.5 py-0.5 rounded text-ink-700">
            {a}
          </code>
        ))}
      </div>
    </div>
  );
}

function BenchmarkPanel({
  benchmarks,
  tenantCount,
}: {
  benchmarks: Benchmark[];
  tenantCount: number;
}) {
  if (!benchmarks.length) {
    return (
      <div className="card p-6 text-center bg-warn-50/40 border-warn-200">
        <div className="font-medium text-ink-900 mb-1">k-anonymity threshold not yet met</div>
        <div className="text-sm text-ink-700">
          Cross-council benchmarking activates once at least 5 tenants opt into the comparison pool.
          Currently {tenantCount} tenant(s) have opted in. No raw data is shared between tenants —
          only anonymised aggregate statistics.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-5 bg-accent-50/40 border-accent-200">
        <div className="font-medium text-ink-900 mb-1 flex items-center gap-2">
          <Users className="w-4 h-4 text-accent-500" />
          Cross-council intelligence (anonymised)
        </div>
        <div className="text-sm text-ink-700 leading-relaxed">
          Benchmarks computed across <strong>{tenantCount} opted-in tenants</strong>. k-anonymity ≥ 5 enforced —
          no individual council is identifiable from any aggregate. Each tenant sees its own value alongside the percentile
          distribution. <strong>No raw cross-tenant data exchange ever occurs.</strong>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50">
            <tr className="text-xs uppercase tracking-wider text-ink-500">
              <th className="text-left px-5 py-3 font-medium">Metric</th>
              <th className="text-right px-3 py-3 font-medium">P25</th>
              <th className="text-right px-3 py-3 font-medium">Median</th>
              <th className="text-right px-3 py-3 font-medium">P75</th>
              <th className="text-right px-3 py-3 font-medium">P90</th>
              <th className="text-right px-3 py-3 font-medium">Your council</th>
              <th className="text-right px-5 py-3 font-medium">Percentile</th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.map((b) => (
              <tr key={b.metric} className="border-t border-ink-100 hover:bg-ink-50/50">
                <td className="px-5 py-3">
                  <div className="font-medium text-ink-900">{b.metric}</div>
                  <div className="text-xs text-ink-500">{b.description}</div>
                  <div className="text-[10px] text-ink-400 mt-0.5">unit: {b.unit}</div>
                </td>
                <td className="text-right px-3 py-3 tabular-nums text-ink-700">{b.p25}</td>
                <td className="text-right px-3 py-3 tabular-nums text-ink-900 font-medium">{b.p50}</td>
                <td className="text-right px-3 py-3 tabular-nums text-ink-700">{b.p75}</td>
                <td className="text-right px-3 py-3 tabular-nums text-ink-700">{b.p90}</td>
                <td className="text-right px-3 py-3 tabular-nums">
                  <span
                    className={
                      (b.yourCouncilPercentile ?? 0) >= 0.75
                        ? "text-success-700 font-semibold"
                        : (b.yourCouncilPercentile ?? 0) <= 0.25
                          ? "text-warn-700 font-semibold"
                          : "text-ink-900"
                    }
                  >
                    {b.yourCouncilValue}
                  </span>
                </td>
                <td className="text-right px-5 py-3 tabular-nums">
                  {b.yourCouncilPercentile !== undefined && (
                    <PercentileBar pct={b.yourCouncilPercentile} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PercentileBar({ pct }: { pct: number }) {
  const colour =
    pct >= 0.75 ? "bg-success-500" : pct >= 0.5 ? "bg-accent-500" : pct >= 0.25 ? "bg-warn-500" : "bg-critical-500";
  return (
    <div className="flex items-center gap-2 justify-end">
      <span className="text-xs text-ink-700 tabular-nums">P{Math.round(pct * 100)}</span>
      <div className="w-20 h-1.5 bg-ink-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${colour}`}
          style={{ width: `${pct * 100}%` }}
        ></div>
      </div>
    </div>
  );
}
