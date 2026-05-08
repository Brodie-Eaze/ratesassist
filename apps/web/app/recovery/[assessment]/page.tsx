import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { Markdown } from "@/components/Markdown";
import { PortfolioMap } from "@/components/PortfolioMap";
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
                      <div className="label">Annual uplift</div>
                      <div className="text-xl font-semibold text-ink-900">
                        {formatAud(pack.candidate.estUplift)}
                      </div>
                    </div>
                    <div>
                      <div className="label">3-year arrears (est.)</div>
                      <div className="text-xl font-semibold text-ink-900">
                        {formatAud(pack.candidate.estArrears3y)}
                      </div>
                    </div>
                    <div>
                      <div className="label">Total recovery (est.)</div>
                      <div className="text-xl font-semibold text-success-700">
                        {formatAud(pack.candidate.estUplift + pack.candidate.estArrears3y)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="card p-0 overflow-hidden mb-4">
                  <div className="px-5 py-3 border-b border-ink-200 flex items-center justify-between">
                    <div className="label">Visual evidence</div>
                    <span className="text-xs text-ink-500">
                      Aerial · DMIRS tenement overlay · Esri imagery
                    </span>
                  </div>
                  <div className="h-[360px]">
                    <PortfolioMap
                      properties={[pack.candidate.property]}
                      tenements={pack.candidate.tenements}
                      centre={[pack.candidate.property.lat, pack.candidate.property.lng]}
                      zoom={14}
                      highlightAssessment={pack.candidate.property.assessmentNumber}
                      showAerial={true}
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
