"use client";

import { Sidebar } from "@/components/Sidebar";
import { useFetch, LoadingState, ErrorState } from "@/lib/useFetch";
import type { SignalCategory, SignalDef } from "@/lib/types";
import {
  Sparkles,
  Activity,
  Building2,
  Layers,
  Database,
  Eye,
  GanttChart,
} from "lucide-react";

type SignalsResponse = {
  catalogue: SignalDef[];
  contributionByCandidate: Record<string, number>;
};

const CATEGORY_META: Record<
  SignalCategory,
  { icon: typeof Activity; cls: string; label: string; tint: string }
> = {
  register:    { icon: Database,    cls: "text-accent-700",   label: "Authoritative register", tint: "border-accent-300 bg-accent-50/40" },
  aerial:      { icon: Eye,         cls: "text-warn-700",     label: "Aerial change detection", tint: "border-warn-300 bg-warn-50/40" },
  identity:    { icon: Building2,   cls: "text-success-700",  label: "Identity verification",   tint: "border-success-200 bg-success-50/40" },
  spatial:     { icon: Layers,      cls: "text-ink-700",      label: "Spatial pattern",         tint: "border-ink-200 bg-ink-50/40" },
  behavioural: { icon: GanttChart,  cls: "text-ink-700",      label: "Behavioural / portfolio", tint: "border-ink-200 bg-ink-50/40" },
  corporate:   { icon: Building2,   cls: "text-success-700",  label: "Corporate structure",     tint: "border-success-200 bg-success-50/40" },
};

export default function SignalsPage() {
  const fetchState = useFetch<SignalsResponse>("/api/signals");
  if (fetchState.status === "loading") return <LoadingState />;
  if (fetchState.status === "error") return <ErrorState message={fetchState.error} />;
  const data = fetchState.data;

  const grouped = data.catalogue.reduce<Record<SignalCategory, SignalDef[]>>(
    (acc, s) => {
      (acc[s.category] = acc[s.category] ?? []).push(s);
      return acc;
    },
    {} as Record<SignalCategory, SignalDef[]>,
  );

  const totalCandidatesWithSignals = Object.values(data.contributionByCandidate).reduce(
    (s, n) => s + n,
    0,
  );

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent-500" />
            Detection Signal Catalogue
          </h1>
          <div className="text-sm text-ink-500">
            The {data.catalogue.length} signals that compose the RatesRecovery scoring engine — each weighted, sourced, and auditable.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-ink-50">
          <div className="card p-5 bg-accent-50/40 border-accent-300">
            <div className="text-sm text-ink-700 leading-relaxed">
              <strong>How the scoring works.</strong> For each property, every signal is evaluated independently. Hits accumulate into a composite score (sum of weights, capped at 1.0). Severity bands: <strong>high ≥ 0.60</strong>, <strong>medium ≥ 0.35</strong>, <strong>low ≥ 0.15</strong>. Tenement-class signals are mutually exclusive (one fires per property based on tenement type). Identity, behavioural, and spatial signals stack on top. Every contribution is cited in the evidence pack — councils can defend reclassifications because every claim has an authoritative source.
            </div>
          </div>

          {(Object.keys(grouped) as SignalCategory[]).map((cat) => {
            const meta = CATEGORY_META[cat];
            const Icon = meta.icon;
            const sigs = grouped[cat] ?? [];
            return (
              <section key={cat} className="space-y-3">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${meta.cls}`} />
                  <h2 className={`text-sm font-medium uppercase tracking-wider ${meta.cls}`}>
                    {meta.label}
                  </h2>
                  <span className="text-xs text-ink-500">
                    {sigs.length} signal{sigs.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {sigs.map((s) => (
                    <SignalCard
                      key={s.id}
                      signal={s}
                      hits={data.contributionByCandidate[s.id] ?? 0}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          <div className="card p-5">
            <div className="font-medium text-ink-900 mb-2">Coverage summary</div>
            <div className="text-sm text-ink-700">
              Across the active portfolio, signals fired{" "}
              <strong>{totalCandidatesWithSignals}</strong> times against{" "}
              <strong>
                {Object.keys(data.contributionByCandidate).length}
              </strong>{" "}
              distinct signals.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function SignalCard({ signal: s, hits }: { signal: SignalDef; hits: number }) {
  const meta = CATEGORY_META[s.category];
  const Icon = meta.icon;
  return (
    <div className={`card p-5 ${meta.tint}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Icon className={`w-4 h-4 ${meta.cls}`} />
            <span className="font-medium text-ink-900">{s.name}</span>
          </div>
          <code className="text-[11px] text-ink-500 font-mono">{s.id}</code>
        </div>
        <div className="text-right shrink-0">
          <div className="label">Weight</div>
          <div className="text-xl font-semibold text-ink-900 tabular-nums">
            +{s.weight.toFixed(2)}
          </div>
        </div>
      </div>
      <div className="text-sm text-ink-700 my-2 leading-relaxed">{s.description}</div>
      <div className="grid grid-cols-2 gap-3 text-xs mt-3 pt-3 border-t border-ink-200">
        <div>
          <div className="label mb-0.5">Source</div>
          <div className="text-ink-700">{s.source}</div>
        </div>
        <div>
          <div className="label mb-0.5">Hits in portfolio</div>
          <div className="text-ink-700 font-medium">
            {hits === 0 ? <span className="text-ink-400">0</span> : <>{hits} candidate{hits === 1 ? "" : "s"}</>}
          </div>
        </div>
      </div>
      {s.exclusiveGroup && (
        <div className="text-[11px] text-ink-400 mt-2">
          Exclusive group: <code>{s.exclusiveGroup}</code> (one fires per property)
        </div>
      )}
    </div>
  );
}
