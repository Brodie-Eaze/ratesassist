"use client";

import { Sidebar } from "@/components/Sidebar";
import { useFetch, LoadingState, ErrorState } from "@/lib/useFetch";
import { Scale, AlertTriangle, CheckCircle2, MapPin } from "lucide-react";

type Dispersion = { n: number; medianValuation: number; cod: number };
type Stratum = {
  landUse: string;
  suburb: string;
  dispersion: Dispersion;
  codUpperBound: number;
  exceedsStandard: boolean;
  underSampled: boolean;
  topOutlierAssessments: string[];
};
type RollQualityResponse = {
  summary: { propertiesAnalysed: number; totalStrata: number; flaggedStrata: number };
  strata: Stratum[];
  flaggedStrata: Stratum[];
  note: string;
};

const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

export default function RollQualityPage() {
  const fetchState = useFetch<RollQualityResponse>("/api/roll-quality");
  if (fetchState.status === "loading") return <LoadingState />;
  if (fetchState.status === "error") return <ErrorState message={fetchState.error} />;
  const { summary, strata, flaggedStrata, note } = fetchState.data;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
            <Scale className="w-5 h-5 text-accent-500" />
            Assessment Roll Quality
          </h1>
          <div className="text-sm text-ink-500">
            IAAO-style uniformity review — finds systemic, category-level non-uniformity across the whole roll, not one parcel at a time.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-ink-50">
          {/* Explainer + honest scope */}
          <div className="card p-5 bg-accent-50/40 border-accent-300">
            <div className="text-sm text-ink-700 leading-relaxed">
              <strong>How this works.</strong> Properties are grouped by land-use × suburb. For each group we
              compute the <strong>Coefficient of Dispersion (COD)</strong> — the average deviation of valuations
              from the group median (the IAAO measure of assessment uniformity). A group whose COD exceeds the
              IAAO band for its class contains parcels that may not belong — a candidate for review.
            </div>
            <div className="text-xs text-ink-500 leading-relaxed mt-3 pt-3 border-t border-accent-300/60">
              <strong>Scope.</strong> {note}
            </div>
          </div>

          {/* Summary tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatTile label="Parcels analysed" value={summary.propertiesAnalysed.toLocaleString()} />
            <StatTile label="Strata (land-use × suburb)" value={summary.totalStrata.toLocaleString()} />
            <StatTile
              label="Flagged — over IAAO band"
              value={summary.flaggedStrata.toLocaleString()}
              tone={summary.flaggedStrata > 0 ? "warn" : "success"}
            />
          </div>

          {/* Flagged strata (lead list) */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warn-700" />
              <h2 className="text-sm font-medium uppercase tracking-wider text-warn-700">
                Flagged for review
              </h2>
              <span className="text-xs text-ink-500">
                {flaggedStrata.length} stratum{flaggedStrata.length === 1 ? "" : "a"} over the IAAO band
              </span>
            </div>
            {flaggedStrata.length === 0 ? (
              <div className="card p-5 bg-success-50/40 border-success-200 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-success-700 shrink-0" />
                <div className="text-sm text-ink-700">
                  Every stratum with a usable sample is within the IAAO uniformity band for its class. No
                  category-level dispersion anomalies to review.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {flaggedStrata.map((s) => (
                  <StratumCard key={`${s.landUse}-${s.suburb}`} stratum={s} />
                ))}
              </div>
            )}
          </section>

          {/* All strata */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-ink-700" />
              <h2 className="text-sm font-medium uppercase tracking-wider text-ink-700">
                All strata
              </h2>
              <span className="text-xs text-ink-500">
                {strata.length} total · worst COD first
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {strata.map((s) => (
                <StratumCard key={`all-${s.landUse}-${s.suburb}`} stratum={s} />
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "warn" | "success";
}) {
  const valueCls =
    tone === "warn" ? "text-warn-700" : tone === "success" ? "text-success-700" : "text-ink-900";
  return (
    <div className="card p-5">
      <div className="label mb-1">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${valueCls}`}>{value}</div>
    </div>
  );
}

function StratumCard({ stratum: s }: { stratum: Stratum }) {
  const tint = s.exceedsStandard ? "border-warn-300 bg-warn-50/40" : "";
  return (
    <div className={`card p-5 ${tint}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <div className="font-medium text-ink-900">{s.suburb}</div>
          <div className="text-xs text-ink-500">{s.landUse}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="label">COD</div>
          <div
            className={`text-xl font-semibold tabular-nums ${
              s.exceedsStandard ? "text-warn-700" : "text-ink-900"
            }`}
          >
            {s.dispersion.cod.toFixed(1)}
          </div>
          <div className="text-[11px] text-ink-400">IAAO ≤ {s.codUpperBound}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs mt-3 pt-3 border-t border-ink-200">
        <div>
          <div className="label mb-0.5">Parcels</div>
          <div className="text-ink-700 font-medium tabular-nums">{s.dispersion.n}</div>
        </div>
        <div>
          <div className="label mb-0.5">Median valuation</div>
          <div className="text-ink-700 font-medium tabular-nums">
            {aud.format(s.dispersion.medianValuation)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {s.exceedsStandard && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-warn-100 text-warn-800 font-medium">
            Over IAAO band
          </span>
        )}
        {s.underSampled && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-ink-100 text-ink-500">
            Under-sampled (&lt; 5) — not flagged
          </span>
        )}
      </div>

      {s.topOutlierAssessments.length > 0 && (
        <div className="text-[11px] text-ink-500 mt-3">
          Furthest from median:{" "}
          {s.topOutlierAssessments.map((a) => (
            <code key={a} className="font-mono text-ink-600 mr-1.5">
              {a}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}
