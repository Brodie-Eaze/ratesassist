import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { Markdown } from "@/components/Markdown";
import { PropertyMapClientShell } from "./_PropertyMapShell";
import { buildEvidencePack } from "@ratesassist/recovery-engine";
import { getProperty } from "@/lib/data";
import { getEvaluationContext } from "@/lib/clients";
import { ArrowLeft, Download } from "lucide-react";
import { formatAud } from "@/lib/utils";

export default async function EvidencePackPage({
  params,
}: {
  params: Promise<{ assessment: string }>;
}) {
  const { assessment } = await params;
  const result = buildEvidencePack(assessment, getEvaluationContext());
  const pack = result.kind === "ok" ? result.pack : null;
  const property = pack ? null : getProperty(assessment);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white flex items-center justify-between">
          <div>
            <Link
              href="/recovery"
              className="text-sm text-ink-500 hover:text-ink-900 flex items-center gap-1 mb-1"
            >
              <ArrowLeft className="w-3 h-3" />
              Recovery audit
            </Link>
            <h1 className="text-xl font-semibold text-ink-900">Evidence Pack</h1>
            {pack && (
              <div className="text-xs text-ink-500 mt-0.5">
                {pack.packId} · severity {pack.candidate.severity} · {(pack.candidate.confidence * 100).toFixed(0)}% confidence
              </div>
            )}
          </div>
          {pack && (
            <div className="flex items-center gap-2">
              <a
                href={`/api/evidence/${assessment}.md`}
                className="btn-ghost"
                download
              >
                <Download className="w-4 h-4" />
                Markdown
              </a>
              <a
                href={`/api/evidence/${assessment}.html`}
                target="_blank"
                rel="noopener"
                className="btn-primary"
              >
                <Download className="w-4 h-4" />
                Print / PDF
              </a>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto bg-ink-50 p-6">
          <div className="max-w-3xl mx-auto">
            {!pack ? (
              <div className="card p-8 text-center">
                {property ? (
                  <>
                    <div className="text-ink-700">
                      Property{" "}
                      <span className="font-medium">{property.address}</span>{" "}
                      (<code className="text-accent-700">{assessment}</code>) has
                      no detection signals firing.
                    </div>
                    <div className="text-sm text-ink-500 mt-2">
                      Nothing to recover — the rating register, DMIRS, ABN/ASIC
                      and aerial signals are all clean for this assessment.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-ink-700">
                      Assessment{" "}
                      <code className="text-accent-700">{assessment}</code> not
                      found in the rating register.
                    </div>
                    <div className="text-sm text-ink-500 mt-2">
                      Check the assessment number, or browse{" "}
                      <Link href="/properties" className="text-accent-700 hover:underline">
                        all properties
                      </Link>
                      .
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="card p-4 mb-4 bg-accent-50/40 border-accent-300">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="label">Current annual rates</div>
                      <div className="text-xl font-semibold text-ink-900">
                        {formatAud(pack.candidate.property.annualRates)}
                      </div>
                      <div className="text-xs text-ink-500 mt-0.5">
                        as rated ({pack.candidate.property.landUse})
                      </div>
                    </div>
                    <div>
                      <div className="label">Correct annual rates</div>
                      <div className="text-xl font-semibold text-ink-900">
                        {formatAud(
                          pack.candidate.correctAnnualRates ??
                            pack.candidate.estAnnualRatesNew,
                        )}
                      </div>
                      <div className="text-xs text-ink-500 mt-0.5">
                        Δ {formatAud(pack.candidate.estUplift)}/yr
                      </div>
                    </div>
                    <div>
                      <div className="label">Total recoverable</div>
                      <div className="text-xl font-semibold text-success-700">
                        {formatAud(
                          (pack.candidate.backdatedAmountConservative ??
                            pack.candidate.estArrears3y) +
                            pack.candidate.estUplift,
                        )}
                      </div>
                      <div className="text-xs text-ink-500 mt-0.5">
                        3y conservative + 1y forward
                      </div>
                    </div>
                  </div>
                  {pack.candidate.rateFormula &&
                  pack.candidate.rateFormula !== "heuristic" ? (
                    <div className="mt-4 pt-3 border-t border-accent-200 text-xs text-ink-600 space-y-2">
                      <div>
                        <span className="font-medium text-ink-900">Formula:</span>{" "}
                        {pack.candidate.rateFormula}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {pack.candidate.changeDetectedAt && (
                          <div>
                            <span className="text-ink-500">Change detected:</span>{" "}
                            {pack.candidate.changeDetectedAt}
                            {typeof pack.candidate.yearsSinceChange === "number"
                              ? ` (${pack.candidate.yearsSinceChange.toFixed(2)}y ago)`
                              : ""}
                          </div>
                        )}
                        {typeof pack.candidate.backdatedAmountConservative === "number" && (
                          <div>
                            <span className="text-ink-500">
                              Backdated 3y conservative:
                            </span>{" "}
                            {formatAud(pack.candidate.backdatedAmountConservative)}
                          </div>
                        )}
                        {typeof pack.candidate.backdatedAmountStatutory === "number" && (
                          <div>
                            <span className="text-ink-500">
                              Backdated 5y statutory (LGA s.6.81):
                            </span>{" "}
                            {formatAud(pack.candidate.backdatedAmountStatutory)}
                          </div>
                        )}
                      </div>
                      {pack.candidate.rateSourceUrl && (
                        <div className="text-ink-500">
                          Source:{" "}
                          <a
                            href={pack.candidate.rateSourceUrl}
                            target="_blank"
                            rel="noopener"
                            className="text-accent-700 hover:underline"
                          >
                            {pack.candidate.rateSourceUrl}
                          </a>{" "}
                          {pack.candidate.rateTableVerified === true ? (
                            <span className="text-success-700">[verified]</span>
                          ) : (
                            <span className="text-warn-700">[unverified — see caveats]</span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 pt-2 border-t border-accent-200 text-xs text-ink-500">
                      Uplift estimated via heuristic multiplier — accurate rate-table
                      path not available for this candidate.
                    </div>
                  )}
                </div>
                <div className="card p-0 overflow-hidden mb-4">
                  <div className="px-5 py-3 border-b border-ink-200 flex items-center justify-between">
                    <div className="label">Visual evidence</div>
                    <span className="text-xs text-ink-500">
                      Cadastre · DMIRS tenement · Esri imagery
                    </span>
                  </div>
                  <div className="h-[480px]">
                    <PropertyMapClientShell
                      focusMode="parcel"
                      tenement={
                        pack.candidate.tenements[0]
                          ? {
                              id: pack.candidate.tenements[0].tenementId,
                              geometry: {
                                type: "Polygon",
                                coordinates: [
                                  pack.candidate.tenements[0].polygon.map(
                                    ([lat, lng]) => [lng, lat] as [number, number],
                                  ),
                                ],
                              },
                              holder: pack.candidate.tenements[0].holder,
                            }
                          : null
                      }
                      parcels={
                        pack.candidate.property.parcel &&
                        pack.candidate.property.parcel.length >= 3
                          ? [
                              {
                                id: pack.candidate.property.assessmentNumber,
                                geometry: {
                                  type: "Polygon",
                                  coordinates: [
                                    pack.candidate.property.parcel.map(
                                      ([lat, lng]) => [lng, lat] as [number, number],
                                    ),
                                  ],
                                },
                              },
                            ]
                          : undefined
                      }
                      assessmentNumber={pack.candidate.property.assessmentNumber}
                      stats={{
                        assessmentNumber: pack.candidate.property.assessmentNumber,
                        address: pack.candidate.property.address,
                        landUse: pack.candidate.property.landUse,
                        valuation: pack.candidate.property.valuation,
                        currentAnnualRates: pack.candidate.property.annualRates,
                        projectedAnnualRates: pack.candidate.estAnnualRatesNew,
                        estimatedUplift: pack.candidate.estUplift,
                      }}
                      evidenceHref={`/api/evidence/${pack.candidate.property.assessmentNumber}.html`}
                    />
                  </div>
                </div>
                <div className="card p-6 bg-white">
                  <Markdown>{pack.markdown}</Markdown>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
