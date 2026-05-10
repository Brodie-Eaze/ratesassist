"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { formatAud } from "@/lib/utils";
import { useFetch, LoadingState, ErrorState } from "@/lib/useFetch";
import type { MismatchCandidate, SignalCategory, SignalHit } from "@/lib/types";
import {
  TrendingUp,
  AlertTriangle,
  FileText,
  ArrowUpRight,
  Sparkles,
  Activity,
  Building2,
  Layers,
  Database,
  Eye,
  GanttChart,
  BellRing,
} from "lucide-react";

const RECENTLY_GRANTED_SIGNAL_ID = "reg.tenement.recently_granted";

type DataResponse = {
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
    signalCounts: Record<string, number>;
  };
};

const SEVERITY_BADGE = {
  high: "bg-critical-50 text-critical-700",
  medium: "bg-warn-50 text-warn-700",
  low: "bg-ink-100 text-ink-700",
};

const CATEGORY_META: Record<
  SignalCategory,
  { icon: typeof Activity; cls: string; label: string }
> = {
  register:    { icon: Database,    cls: "bg-accent-50 text-accent-700",   label: "Register" },
  aerial:      { icon: Eye,         cls: "bg-warn-50 text-warn-700",       label: "Aerial" },
  identity:    { icon: Building2,   cls: "bg-success-50 text-success-700", label: "Identity" },
  spatial:     { icon: Layers,      cls: "bg-ink-100 text-ink-700",        label: "Spatial" },
  behavioural: { icon: GanttChart,  cls: "bg-ink-100 text-ink-700",        label: "Behavioural" },
  corporate:   { icon: Building2,   cls: "bg-success-50 text-success-700", label: "Corporate" },
};

export default function RecoveryPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RecoveryPageInner />
    </Suspense>
  );
}

function RecoveryPageInner() {
  const fetchState = useFetch<DataResponse>("/api/data");
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [signalFilter, setSignalFilter] = useState<string | "all">("all");
  const [recentlyGrantedOnly, setRecentlyGrantedOnly] = useState<boolean>(false);
  const searchParams = useSearchParams();

  // Pre-apply the "Newly granted only" filter when arriving via
  // /recovery?signal=recently_granted (e.g. the legacy /alerts redirect).
  useEffect(() => {
    if (searchParams?.get("signal") === "recently_granted") {
      setRecentlyGrantedOnly(true);
    }
  }, [searchParams]);

  if (fetchState.status === "loading") return <LoadingState />;
  if (fetchState.status === "error") return <ErrorState message={fetchState.error} />;
  const data = fetchState.data;

  let filtered = data.mismatches;
  if (filter !== "all") filtered = filtered.filter((m) => m.severity === filter);
  if (signalFilter !== "all")
    filtered = filtered.filter((m) => m.signals.some((s) => s.id === signalFilter));
  if (recentlyGrantedOnly)
    filtered = filtered.filter((m) =>
      m.signals.some((s) => s.id === RECENTLY_GRANTED_SIGNAL_ID),
    );

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-ink-900">Recovery Audit</h1>
            <span className="badge bg-accent-100 text-accent-700">RatesRecovery</span>
            <span className="badge bg-ink-100 text-ink-700">
              <Sparkles className="w-3 h-3 mr-1 inline" />
              Multi-signal detection
            </span>
          </div>
          <div className="text-sm text-ink-500">
            Cross-references against DMIRS, ABN/ASIC, portfolio + spatial signals · Composite scoring with auditable trail
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-ink-50">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            <Stat
              icon={<AlertTriangle className="w-5 h-5 text-critical-500" />}
              label="High-severity candidates"
              value={data.stats.high.toString()}
              sub={`of ${data.stats.total} total`}
            />
            <Stat
              icon={<TrendingUp className="w-5 h-5 text-success-500" />}
              label="Est. annual uplift"
              value={formatAud(data.stats.totalUplift)}
              sub={`${formatAud(data.stats.highUplift)} high-conf only`}
            />
            <Stat
              icon={<FileText className="w-5 h-5 text-accent-500" />}
              label="Est. arrears (3y)"
              value={formatAud(data.stats.totalArrears)}
              sub="Within statutory backdating limit"
            />
            <Stat
              icon={<TrendingUp className="w-5 h-5 text-accent-500" />}
              label="Total recovery opportunity"
              value={formatAud(data.stats.totalRecovery)}
              sub="Annual uplift + arrears"
              highlight
            />
          </div>

          {/* Signal contribution rollup */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium text-ink-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-accent-500" />
                  Detection-signal contribution
                </div>
                <div className="text-xs text-ink-500">
                  How many candidates each signal fired against — click to filter the list.
                </div>
              </div>
              <Link
                href="/signals"
                className="text-xs text-accent-700 hover:underline"
              >
                Signal catalogue →
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSignalFilter("all")}
                className={`btn ${
                  signalFilter === "all"
                    ? "bg-ink-900 text-white"
                    : "bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                }`}
              >
                All signals
                <span className="text-[10px] opacity-70 ml-1">
                  {Object.values(data.stats.signalCounts).reduce((s, n) => s + n, 0)}
                </span>
              </button>
              {Object.entries(data.stats.signalCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([id, count]) => {
                  const sample = data.mismatches.find((m) => m.signals.some((s) => s.id === id));
                  const sig = sample?.signals.find((s) => s.id === id);
                  if (!sig) return null;
                  const meta = CATEGORY_META[sig.category];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={id}
                      onClick={() => setSignalFilter(id)}
                      className={`btn ${
                        signalFilter === id
                          ? "bg-ink-900 text-white"
                          : "bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {sig.short}
                      <span className="text-[10px] opacity-70 ml-1">{count}</span>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Severity filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-500">Severity:</span>
            {(["all", "high", "medium", "low"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`btn ${
                  filter === f
                    ? "bg-ink-900 text-white"
                    : "bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                }`}
              >
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                <span className="text-[10px] opacity-70 ml-1">
                  {f === "all"
                    ? data.stats.total
                    : data.stats[f as "high" | "medium" | "low"]}
                </span>
              </button>
            ))}
            <span className="text-xs text-ink-400 ml-3">
              Showing {filtered.length} of {data.mismatches.length}
            </span>
            <button
              onClick={() => setRecentlyGrantedOnly((v) => !v)}
              className={`btn ml-auto ${
                recentlyGrantedOnly
                  ? "bg-warn-500 text-white"
                  : "bg-white border border-warn-300 text-warn-700 hover:bg-warn-50"
              }`}
              title="Filter to candidates with a tenement granted within the last 90 days (DMIRS MINEDEX)"
            >
              <BellRing className="w-3 h-3" />
              Newly granted only
              <span className="text-[10px] opacity-70 ml-1">
                {data.mismatches.filter((m) =>
                  m.signals.some((s) => s.id === RECENTLY_GRANTED_SIGNAL_ID),
                ).length}
              </span>
            </button>
          </div>

          {/* Candidates */}
          <div className="space-y-3">
            {filtered.map((c, i) => (
              <CandidateCard key={c.assessmentNumber} candidate={c} rank={i + 1} />
            ))}
            {filtered.length === 0 && (
              <div className="text-center text-ink-500 text-sm py-12">
                No candidates match the current filter.
              </div>
            )}
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
      className={`card p-4 ${highlight ? "border-accent-400 bg-accent-50/40" : ""}`}
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

function CandidateCard({
  candidate: c,
  rank,
}: {
  candidate: MismatchCandidate;
  rank: number;
}) {
  const isRecentlyGranted = c.signals.some(
    (s) => s.id === RECENTLY_GRANTED_SIGNAL_ID,
  );
  return (
    <Link
      href={`/recovery/${c.assessmentNumber}`}
      className="card p-5 hover:border-accent-400 transition-colors block"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-ink-400 text-sm">#{rank}</span>
            <code className="text-sm text-accent-700 font-mono font-medium">
              {c.assessmentNumber}
            </code>
            <span className={`badge ${SEVERITY_BADGE[c.severity]}`}>
              {c.severity.toUpperCase()}
            </span>
            {isRecentlyGranted && (
              <span
                className="badge bg-warn-100 text-warn-700 border border-warn-300"
                title="An intersecting tenement was granted within the last 90 days (DMIRS MINEDEX)"
              >
                <BellRing className="w-3 h-3 mr-1 inline" />
                NEW GRANT
              </span>
            )}
            <span className="badge badge-neutral">
              {(c.compositeScore * 100).toFixed(0)}% composite
            </span>
            <span className="badge badge-neutral">
              {c.signals.length} signal{c.signals.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="text-ink-900 font-medium">
            {c.property.address}, {c.property.suburb}
          </div>
          <div className="text-sm text-ink-600 mt-1">
            Headline: {c.kind}
          </div>
          {/* Signal trail */}
          <SignalRow signals={c.signals} />
        </div>
        <div className="text-right shrink-0">
          <div className="label">Annual uplift</div>
          <div className="text-xl font-semibold text-ink-900">
            {formatAud(c.estUplift)}
          </div>
          <div className="text-xs text-ink-500">
            {formatAud(c.property.annualRates)} → {formatAud(c.estAnnualRatesNew)}
          </div>
          <ScoreBar score={c.compositeScore} />
          <div className="text-xs text-success-700 mt-1 flex items-center justify-end gap-1">
            View pack <ArrowUpRight className="w-3 h-3" />
          </div>
        </div>
      </div>
    </Link>
  );
}

function SignalRow({ signals }: { signals: readonly SignalHit[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {[...signals]
        .sort((a, b) => b.weight - a.weight)
        .map((s) => {
          const meta = CATEGORY_META[s.category];
          const Icon = meta.icon;
          return (
            <span
              key={s.id}
              className={`badge ${meta.cls} text-[11px]`}
              title={s.evidence}
            >
              <Icon className="w-3 h-3 mr-1 inline" />
              {s.short}
              <span className="text-ink-400 ml-1">+{s.weight.toFixed(2)}</span>
            </span>
          );
        })}
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const colour = score >= 0.6 ? "bg-critical-500" : score >= 0.35 ? "bg-warn-500" : "bg-ink-400";
  return (
    <div className="mt-2 w-32 ml-auto">
      <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${colour} transition-all`}
          style={{ width: `${score * 100}%` }}
        ></div>
      </div>
    </div>
  );
}
