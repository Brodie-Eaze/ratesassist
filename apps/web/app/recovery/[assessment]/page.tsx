import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { Markdown } from "@/components/Markdown";
import { PropertyMapClientShell } from "./_PropertyMapShell";
import { SignalAccordion } from "@/components/recovery/SignalAccordion";
import { TitleStateSection } from "@/components/recovery/TitleStateSection";
import { ConcessionAuditSection } from "@/components/recovery/ConcessionAuditSection";
import { buildEvidencePack } from "@ratesassist/recovery-engine";
import { getProperty } from "@/lib/data";
import { getEvaluationContext } from "@/lib/clients";
import { ArrowLeft, AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { formatAud } from "@/lib/utils";

/**
 * Validate a rate-source URL before rendering as an `<a href>`. Only allows
 * https URLs on the .gov.au TLD or a small allowlist of known WA council
 * domains. Returns null for anything else — protects against open-redirect
 * / phishing payloads via injected source URLs (SEC-004).
 */
const RATE_SOURCE_DOMAIN_ALLOWLIST = new Set<string>([
  // Reserved for known WA council vanity domains that don't end in .gov.au.
]);

function safeRateSourceUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (host.endsWith(".gov.au") || RATE_SOURCE_DOMAIN_ALLOWLIST.has(host)) {
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

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
                      {pack.candidate.rateSourceUrl && (() => {
                        const safe = safeRateSourceUrl(pack.candidate.rateSourceUrl);
                        const verified = pack.candidate.rateTableVerified === true;
                        return (
                          <div className="text-ink-500 flex flex-wrap items-center gap-2">
                            <span>Source:</span>
                            {safe ? (
                              <a
                                href={safe}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent-700 hover:underline break-all"
                              >
                                {safe}
                              </a>
                            ) : (
                              <span className="text-ink-500">
                                [URL withheld — invalid]
                              </span>
                            )}
                            {verified ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-success-50 border border-success-500 text-success-700 px-2 py-0.5 text-[11px] font-medium"
                                title="Rate table verified against the council's published 2025-26 budget."
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                Verified 2025-26
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-warn-50 border border-warn-500 text-warn-700 px-2 py-0.5 text-[11px] font-medium"
                                title="Rate table carried forward from a previous FY or sourced from a regional benchmark — see caveats."
                              >
                                <AlertTriangle className="w-3 h-3" />
                                Carried-forward
                              </span>
                            )}
                          </div>
                        );
                      })()}
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
                {/* Headline panel — top-3 signals by weight, coloured strip.
                    Gold/red/amber tier mirrors the markdown render in the
                    engine. Omitted when no signals fire (defensive — the
                    page would not have a pack in that case). */}
                {pack.headlineSignals.length > 0 && (
                  <div
                    className="card p-5 mb-4 border-l-4 border-l-accent-600"
                    aria-label="Headline signals"
                    data-testid="headline-panel"
                  >
                    <div className="label mb-2">
                      Headline — top {pack.headlineSignals.length} signal
                      {pack.headlineSignals.length === 1 ? "" : "s"} by weight
                    </div>
                    <ol className="space-y-2">
                      {pack.headlineSignals.map((sig, ix) => {
                        const tier =
                          ix === 0
                            ? {
                                label: "gold",
                                className:
                                  "bg-warn-50 text-warn-700 border-warn-500",
                              }
                            : ix === 1
                            ? {
                                label: "red",
                                className:
                                  "bg-critical-50 text-critical-700 border-critical-500",
                              }
                            : {
                                label: "amber",
                                className:
                                  "bg-ink-100 text-ink-700 border-ink-300",
                              };
                        return (
                          <li
                            key={sig.id}
                            className="flex items-start gap-2"
                            data-headline-rank={ix + 1}
                          >
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border ${tier.className} flex-shrink-0`}
                            >
                              #{ix + 1} · {tier.label}
                            </span>
                            <div className="flex-1 text-sm">
                              <div className="font-medium text-ink-900">
                                {sig.short}{" "}
                                <span className="text-xs text-ink-500 font-normal">
                                  (weight {sig.weight.toFixed(2)})
                                </span>
                              </div>
                              <div className="text-ink-700 text-xs mt-0.5">
                                {sig.evidence}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}

                {/* Section 5 breakdown rendered as accordions. Priority-sorted
                    by weight DESC (engine guarantees stable order); top-3
                    expanded by default per the locked spec. */}
                {pack.prioritisedSignals.length > 0 && (
                  <div className="mb-4" data-testid="signal-breakdown">
                    <div className="label mb-2 px-1">
                      Signal breakdown — {pack.prioritisedSignals.length}{" "}
                      firing, sorted by weight
                    </div>
                    {pack.prioritisedSignals.map((sig, ix) => (
                      <SignalAccordion
                        key={sig.id}
                        signal={sig}
                        defaultOpen={ix < 3}
                      />
                    ))}
                  </div>
                )}

                {/* Section 8 — Title state (only renders when the property
                    carries title-state fields). */}
                <TitleStateSection
                  ctVolume={pack.candidate.property.ctVolume}
                  ctFolio={pack.candidate.property.ctFolio}
                  ctIssuedDate={pack.candidate.property.ctIssuedDate}
                  proprietor={pack.candidate.property.proprietorOnTitle}
                  proprietorPostalAddress={
                    pack.candidate.property.proprietorPostalAddress
                  }
                  pins={pack.candidate.property.pins ?? []}
                  encumbrances={pack.candidate.property.encumbrances ?? []}
                  strataParentCt={pack.candidate.property.strataParentCt}
                  strataChildren={pack.candidate.property.strataChildren ?? []}
                  source={pack.candidate.property.titleSource}
                  councilLandUse={pack.candidate.property.landUse}
                />

                {/* Section 9 — Concession audit (only when concession on
                    file). */}
                {pack.candidate.property.pensionerConcession && (
                  <ConcessionAuditSection
                    concession={pack.candidate.property.pensionerConcession}
                    propertyAddress={`${pack.candidate.property.address}, ${pack.candidate.property.suburb} ${pack.candidate.property.postcode} ${pack.candidate.property.state}`}
                    propertyPostalAddress={
                      pack.candidate.property.proprietorPostalAddress
                    }
                  />
                )}

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
