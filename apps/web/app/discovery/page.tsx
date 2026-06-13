"use client";

import { useEffect, useState } from "react";
import { LoadingState, ErrorState } from "@/lib/useFetch";
import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { formatAud, shortDate } from "@/lib/utils";
import {
  Cpu,
  Activity,
  Database,
  Layers,
  GitMerge,
  Sparkles,
  BrainCircuit,
  Repeat,
  ArrowRight,
  Clock,
  CheckCircle2,
} from "lucide-react";

type Stage = {
  id: string;
  name: string;
  detail?: string;
  sources?: { name: string; schedule: string; lastSyncedHoursAgo: number; recordsToday: number }[];
  throughput?: number;
  computedNow?: number;
  divergencesFound?: number;
  candidatesOpened?: number;
  signalsFiringNow?: number;
  modelVersion?: string;
  packsDraftedToday?: number;
  readyForReview?: number;
  verdictsRecorded30d?: number;
  reclassifiedPct?: number;
  collectionsRealised?: number;
};

type DiscoveryResponse = {
  stages: Stage[];
  activity: { ts: string; stage: string; text: string }[];
  watchlist: {
    rank: number;
    assessment: string;
    address: string;
    council: string;
    composite: number;
    severity: "high" | "medium" | "low";
    estUplift: number;
    signalCount: number;
    lastReevaluated: string;
    nextScheduledScan: string;
  }[];
  summary: {
    parcelsUnderContinuousMonitoring: number;
    councilsLive: number;
    candidatesOpenNow: number;
    candidatesAwaitingReview: number;
    estUpliftPipeline: number;
    estCollectionsPipeline: number;
    lastFullSweepAt: string;
    nextScheduledSweep: string;
    avgTimeToCandidateSec: number;
    aiVerdictsPerDay: number;
    falsePositiveRate: number;
  };
};

const STAGE_ICONS: Record<string, typeof Activity> = {
  ingest: Database,
  intersect: Layers,
  reconcile: GitMerge,
  score: Sparkles,
  triage: BrainCircuit,
  feedback: Repeat,
};

const SEVERITY_BADGE = {
  high: "bg-critical-50 text-critical-700",
  medium: "bg-warn-50 text-warn-700",
  low: "bg-ink-100 text-ink-700",
};

export default function DiscoveryPage() {
  const [data, setData] = useState<DiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ctrl: AbortController | null = null;
    function load() {
      ctrl?.abort();
      ctrl = new AbortController();
      const signal = ctrl.signal;
      fetch("/api/discovery", { signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
          return (await r.json()) as DiscoveryResponse;
        })
        .then((d) => {
          if (!cancelled) {
            setData(d);
            setError(null);
          }
        })
        .catch((e) => {
          if (cancelled || signal.aborted) return;
          const msg = e instanceof Error ? e.message : String(e);
          // Only surface error if we have no data yet — otherwise keep showing
          // last good snapshot during transient polling failures.
          setError((prev) => (data ? prev : msg));
        });
    }
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      ctrl?.abort();
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) {
    if (error) return <ErrorState message={error} />;
    return <LoadingState />;
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-accent-500" />
            Autonomous Discovery Engine
            <span className="ml-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-700">
              Illustrative
            </span>
          </h1>
          <div className="text-sm text-ink-500">
            Continuous detection of mis-rated properties · Multi-source ingestion · Spatial reconciliation · Weighted-signal scoring · AI triage
          </div>
          <div className="mt-1 text-xs text-ink-400">
            Projected autonomous operation at scale. Throughput, model-version and outcome figures on this page are synthetic and for illustration — not live production metrics.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-ink-50">
          {/* Top stats */}
          <div className="grid grid-cols-4 gap-4">
            <Stat
              icon={<Activity className="w-5 h-5 text-accent-500" />}
              label="Parcels under continuous monitoring"
              value={data.summary.parcelsUnderContinuousMonitoring.toLocaleString()}
              sub={`across ${data.summary.councilsLive} councils`}
            />
            <Stat
              icon={<Sparkles className="w-5 h-5 text-warn-500" />}
              label="Candidates open right now"
              value={data.summary.candidatesOpenNow.toString()}
              sub={`${data.summary.candidatesAwaitingReview} awaiting officer review`}
            />
            <Stat
              icon={<BrainCircuit className="w-5 h-5 text-success-500" />}
              label="AI verdicts / day"
              value={data.summary.aiVerdictsPerDay.toLocaleString()}
              sub={`avg ${data.summary.avgTimeToCandidateSec}s per candidate`}
            />
            <Stat
              icon={<CheckCircle2 className="w-5 h-5 text-success-500" />}
              label="Recovery pipeline"
              value={formatAud(data.summary.estCollectionsPipeline)}
              sub={`${formatAud(data.summary.estUpliftPipeline)} annual + arrears`}
              highlight
            />
          </div>

          {/* Pipeline visualisation */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-medium text-ink-900">Detection pipeline</div>
                <div className="text-xs text-ink-500">
                  Last full sweep:{" "}
                  <span className="text-ink-700">
                    {new Date(data.summary.lastFullSweepAt).toLocaleString()}
                  </span>{" "}
                  · Next sweep:{" "}
                  <span className="text-ink-700">
                    {new Date(data.summary.nextScheduledSweep).toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="badge bg-success-50 text-success-700 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success-500 animate-pulse"></span>
                Running
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-6 gap-2">
              {data.stages.map((s, i) => {
                const Icon = STAGE_ICONS[s.id] ?? Activity;
                return (
                  <div key={s.id} className="contents">
                    <StageCard stage={s} Icon={Icon} />
                    {i < data.stages.length - 1 && (
                      <div className="hidden lg:flex items-center justify-center text-ink-300 -mx-1">
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Activity feed */}
            <div className="card p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-medium text-ink-900 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-accent-500" />
                    Recent worker activity
                  </div>
                  <div className="text-xs text-ink-500">
                    Live feed — refreshes every 30s. Each line is one autonomous worker action with audit-log entry.
                  </div>
                </div>
              </div>
              <div className="divide-y divide-ink-100 -mx-5">
                {data.activity.map((a, i) => {
                  const Icon = STAGE_ICONS[a.stage] ?? Activity;
                  return (
                    <div key={i} className="flex items-start gap-3 px-5 py-2.5">
                      <Icon className="w-3.5 h-3.5 text-ink-400 mt-1 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ink-900">{a.text}</div>
                        <div className="text-xs text-ink-500 mt-0.5 flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          {timeAgo(a.ts)}
                          <span className="text-ink-300">·</span>
                          <code className="text-[10px] text-accent-700">{a.stage}</code>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Watchlist */}
            <div className="card p-5">
              <div className="font-medium text-ink-900 flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-warn-500" />
                Active watchlist
              </div>
              <div className="text-xs text-ink-500 mb-3">
                Top {data.watchlist.length} candidates being continuously re-evaluated against incoming data feeds.
              </div>
              <div className="space-y-2">
                {data.watchlist.map((w) => (
                  <Link
                    key={w.assessment}
                    href={`/recovery/${w.assessment}`}
                    className="block p-2.5 -mx-2 rounded-md hover:bg-ink-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-xs text-accent-700 font-mono">
                        {w.assessment}
                      </code>
                      <span className={`badge ${SEVERITY_BADGE[w.severity]} text-[9px]`}>
                        {w.severity}
                      </span>
                    </div>
                    <div className="text-xs text-ink-700 mt-0.5 truncate">{w.address}</div>
                    <div className="flex items-center justify-between mt-1 text-[11px] text-ink-500">
                      <span>{(w.composite * 100).toFixed(0)}% · {w.signalCount} signals</span>
                      <span className="text-success-700 font-medium">+{formatAud(w.estUplift)}/yr</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Outcome ledger */}
          <div className="card p-5">
            <div className="font-medium text-ink-900 mb-3">Outcome feedback (last 30 days)</div>
            <div className="grid grid-cols-3 gap-4">
              <Stat
                icon={<CheckCircle2 className="w-5 h-5 text-success-500" />}
                label="Verdicts recorded"
                value={(data.stages.find((s) => s.id === "feedback")?.verdictsRecorded30d ?? 0).toString()}
                sub="Officer + council determinations fed to model"
              />
              <Stat
                icon={<Sparkles className="w-5 h-5 text-success-500" />}
                label="Reclassification success rate"
                value={`${((data.stages.find((s) => s.id === "feedback")?.reclassifiedPct ?? 0) * 100).toFixed(0)}%`}
                sub="Of high-confidence candidates"
              />
              <Stat
                icon={<CheckCircle2 className="w-5 h-5 text-success-500" />}
                label="Collections realised"
                value={formatAud(data.stages.find((s) => s.id === "feedback")?.collectionsRealised ?? 0)}
                sub="Cash-basis recovery"
              />
            </div>
            <div className="mt-4 text-xs text-ink-500 leading-relaxed">
              Every officer decision and council outcome flows back as a label. The composite-scoring model retrains quarterly.
              Within 12 months, this loop will surface candidates that manual review can&rsquo;t reach because
              the system has seen 100,000+ properties.
            </div>
          </div>

          {/* False-positive transparency */}
          <div className="card p-5 bg-warn-50/40 border-warn-200">
            <div className="font-medium text-ink-900 mb-2">Transparency</div>
            <div className="text-sm text-ink-700 leading-relaxed">
              Current false-positive rate against historical officer-validated outcomes:{" "}
              <strong className="text-warn-700">
                {(data.summary.falsePositiveRate * 100).toFixed(0)}%
              </strong>.
              Surfaced candidates always require officer review — the system never auto-reclassifies. Every signal that contributed to a decision is named, weighted and cited. Councils can defend the determinations because every claim has an authoritative public source on record in the evidence pack.
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

function StageCard({
  stage,
  Icon,
}: {
  stage: Stage;
  Icon: typeof Activity;
}) {
  return (
    <div className="card p-3 bg-white border-ink-200">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-accent-500" />
        <div className="text-xs font-medium text-ink-900">{stage.name}</div>
      </div>
      <div className="text-[10px] text-ink-500 leading-snug min-h-[40px]">
        {stage.detail ?? `${stage.sources?.length ?? 0} sources`}
      </div>
      <div className="mt-2 pt-2 border-t border-ink-100 text-[11px]">
        {stage.id === "ingest" && stage.sources && (
          <div className="space-y-0.5">
            {stage.sources.slice(0, 3).map((s) => (
              <div key={s.name} className="flex justify-between gap-1">
                <span className="text-ink-500 truncate">{s.name}</span>
                <span className="text-ink-700 tabular-nums">{s.recordsToday}</span>
              </div>
            ))}
            {stage.sources.length > 3 && (
              <div className="text-ink-400 text-center">+{stage.sources.length - 3} more</div>
            )}
          </div>
        )}
        {stage.id === "intersect" && (
          <>
            <div className="flex justify-between">
              <span className="text-ink-500">Operations</span>
              <span className="text-ink-900 tabular-nums">{stage.computedNow?.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-500">Throughput/h</span>
              <span className="text-ink-900 tabular-nums">{stage.throughput?.toLocaleString()}</span>
            </div>
          </>
        )}
        {stage.id === "reconcile" && (
          <>
            <div className="flex justify-between">
              <span className="text-ink-500">Divergences</span>
              <span className="text-warn-700 font-medium tabular-nums">{stage.divergencesFound}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-500">Opened</span>
              <span className="text-ink-900 tabular-nums">{stage.candidatesOpened}</span>
            </div>
          </>
        )}
        {stage.id === "score" && (
          <>
            <div className="flex justify-between">
              <span className="text-ink-500">Signals firing</span>
              <span className="text-ink-900 tabular-nums">{stage.signalsFiringNow}</span>
            </div>
            <div className="text-[10px] text-ink-400 mt-0.5">{stage.modelVersion}</div>
          </>
        )}
        {stage.id === "triage" && (
          <>
            <div className="flex justify-between">
              <span className="text-ink-500">Packs drafted</span>
              <span className="text-ink-900 tabular-nums">{stage.packsDraftedToday}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-500">For review</span>
              <span className="text-success-700 font-medium tabular-nums">{stage.readyForReview}</span>
            </div>
          </>
        )}
        {stage.id === "feedback" && (
          <>
            <div className="flex justify-between">
              <span className="text-ink-500">Verdicts (30d)</span>
              <span className="text-ink-900 tabular-nums">{stage.verdictsRecorded30d}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-500">Recovery</span>
              <span className="text-success-700 font-medium tabular-nums">
                {formatAud(stage.collectionsRealised ?? 0)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return shortDate(iso);
}
