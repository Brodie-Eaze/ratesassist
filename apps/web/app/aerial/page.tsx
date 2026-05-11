"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { PortfolioMap } from "@/components/PortfolioMap";
import type { MismatchCandidate, Property, Tenement } from "@/lib/types";
import { formatAud } from "@/lib/utils";
import { useFetch, LoadingState, ErrorState } from "@/lib/useFetch";
import { Eye, Layers } from "lucide-react";

type DataResponse = {
  properties: Property[];
  tenements: Tenement[];
  mismatches: MismatchCandidate[];
};

export default function AerialPage() {
  const fetchState = useFetch<DataResponse>("/api/data?include=properties,owners,tenements,mismatches");
  const [selectedAssess, setSelectedAssess] = useState<string>("");

  if (fetchState.status === "loading") return <LoadingState />;
  if (fetchState.status === "error") return <ErrorState message={fetchState.error} />;
  const data = fetchState.data;

  const effectiveAssess =
    selectedAssess || (data.mismatches[0]?.assessmentNumber ?? "");
  const candidate = data.mismatches.find(
    (m) => m.assessmentNumber === effectiveAssess,
  );
  const property = candidate?.property;
  const tenements = candidate?.tenements ?? [];

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
            <Eye className="w-5 h-5 text-accent-500" />
            Aerial Change Detection
          </h1>
          <div className="text-sm text-ink-500">
            Visual evidence layer — Esri satellite imagery + DMIRS tenement overlay.
            Powers Nearmap AI integration in production.
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Candidate list */}
          <aside className="w-80 border-r border-ink-200 bg-white overflow-y-auto">
            <div className="p-3 border-b border-ink-200 bg-ink-50">
              <div className="text-xs uppercase tracking-wider text-ink-500 font-medium">
                {data.mismatches.length} candidates
              </div>
            </div>
            {data.mismatches.map((m) => (
              <button
                key={m.assessmentNumber}
                onClick={() => setSelectedAssess(m.assessmentNumber)}
                className={`w-full text-left px-4 py-3 border-b border-ink-100 hover:bg-ink-50 transition-colors ${
                  effectiveAssess === m.assessmentNumber ? "bg-accent-50" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <code className="text-xs text-accent-700 font-mono">
                    {m.assessmentNumber}
                  </code>
                  <span
                    className={`badge ${
                      m.severity === "high"
                        ? "bg-critical-50 text-critical-700"
                        : m.severity === "medium"
                          ? "bg-warn-50 text-warn-700"
                          : "bg-ink-100 text-ink-700"
                    }`}
                  >
                    {m.severity}
                  </span>
                </div>
                <div className="text-sm text-ink-900 mt-1">{m.property.address}</div>
                <div className="text-xs text-ink-500 mt-0.5">{m.property.suburb}</div>
                <div className="text-xs font-medium text-success-700 mt-1">
                  +{formatAud(m.estUplift)}/yr
                </div>
              </button>
            ))}
          </aside>

          {/* Map */}
          <div className="flex-1 flex flex-col">
            <div className="bg-ink-50 px-5 py-3 border-b border-ink-200 flex items-center justify-between">
              <div>
                {property ? (
                  <>
                    <div className="font-medium text-ink-900">{property.address}</div>
                    <div className="text-xs text-ink-500">
                      <code className="text-accent-700">{property.assessmentNumber}</code>
                      {" · "}
                      Currently rated <strong>{property.landUse}</strong>
                      {" → proposed "}
                      <strong className="text-warn-700">Mining</strong>
                      {" · uplift "}
                      <strong className="text-success-700">
                        {candidate ? formatAud(candidate.estUplift) : "—"}/yr
                      </strong>
                    </div>
                  </>
                ) : (
                  <span className="text-ink-500 text-sm">
                    Select a candidate from the list
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-ink-500">
                <Layers className="w-3 h-3" />
                Aerial · DMIRS overlay
              </div>
            </div>
            <div className="flex-1 bg-ink-100 p-3">
              {property ? (
                <PortfolioMap
                  properties={[property]}
                  tenements={tenements}
                  centre={[property.lat, property.lng]}
                  zoom={15}
                  showAerial={true}
                  highlightAssessment={property.assessmentNumber}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-ink-400 text-sm">
                  No candidate selected
                </div>
              )}
            </div>
          </div>

          {/* Side analysis */}
          <aside className="w-80 border-l border-ink-200 bg-white p-4 overflow-y-auto space-y-4">
            {candidate && (
              <>
                <div>
                  <div className="label mb-1">Mismatch analysis</div>
                  <div className="text-sm text-ink-700">{candidate.kind}</div>
                  <div className="text-xs text-ink-500 mt-1 leading-relaxed">
                    {candidate.reason}
                  </div>
                </div>

                <div className="border-t border-ink-200 pt-3">
                  <div className="label mb-1">Confidence</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-ink-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent-500"
                        style={{ width: `${candidate.confidence * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-medium text-ink-900 tabular-nums">
                      {(candidate.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                <div className="border-t border-ink-200 pt-3">
                  <div className="label mb-1">Tenement coverage</div>
                  <div className="space-y-2 text-sm">
                    {tenements.map((t) => (
                      <div
                        key={t.tenementId}
                        className="border-l-2 border-warn-500 pl-3"
                      >
                        <div className="font-mono text-xs text-accent-700">
                          {t.tenementId}
                        </div>
                        <div className="text-xs text-ink-700">
                          {t.holder}
                        </div>
                        <div className="text-xs text-ink-500">
                          {t.commodity.join(" · ")} · {t.areaHectares.toLocaleString()} ha
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-ink-200 pt-3">
                  <div className="label mb-1">Recovery estimate</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-ink-500">Current rates</span>
                      <span className="tabular-nums">
                        {formatAud(candidate.property.annualRates)}/yr
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-500">Proposed rates</span>
                      <span className="tabular-nums font-medium">
                        {formatAud(candidate.estAnnualRatesNew)}/yr
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-ink-100 pt-1">
                      <span className="text-ink-700 font-medium">Annual uplift</span>
                      <span className="text-success-700 font-semibold tabular-nums">
                        +{formatAud(candidate.estUplift)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-ink-500">
                      <span>3-year arrears</span>
                      <span className="tabular-nums">
                        +{formatAud(candidate.estArrears3y)}
                      </span>
                    </div>
                  </div>
                </div>

                <a
                  href={`/recovery/${candidate.assessmentNumber}`}
                  className="btn-primary w-full"
                >
                  View evidence pack →
                </a>
              </>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
