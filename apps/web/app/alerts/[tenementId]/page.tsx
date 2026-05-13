"use client";

/**
 * /alerts/[tenementId] — full briefing for a single granted tenement.
 *
 * Click-through from /alerts. Renders header (with provisional badge +
 * MINEDEX/evidence-pack actions), Leaflet map of the tenement geometry +
 * intersecting parcels, collapsible aerial preview, affected-parcels
 * table, tenement metadata card, and a footer with refresh time +
 * disclaimer.
 *
 * Honest source labelling everywhere: grants source (live/seeded), cadastre
 * source ("synthetic intersection — demo data only"), and aerial source
 * ("AERIAL: SEEDED" when no Nearmap/Mapbox key configured).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { LoadingState, ErrorState, useFetch } from "@/lib/useFetch";
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Eye,
  AlertTriangle,
  MapPin,
} from "lucide-react";
import IntersectionTable from "./_IntersectionTable";
import { buildEmitsSearchUrl, buildTengraphUrl } from "@ratesassist/spatial";

type GrantedTenementGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "Point"; coordinates: number[] };

type GrantedTenement = {
  tenementId: string;
  tenementIdDisplay: string;
  type: string;
  typeLabel: string;
  grantDate: string;
  grantDateMs: number;
  holder: string;
  geometry: GrantedTenementGeometry;
  detailUrl: string;
  provisional: boolean;
};

type GrantDetailResponse = {
  ok: true;
  data: {
    grant: GrantedTenement;
    intersectingParcels: Array<{
      assessmentNumber: string;
      address: string;
      landUse: string;
      valuation: number;
      annualRates: number;
      estimatedUpliftSeverity: "high" | "medium" | "low";
      estimatedUpliftAmount: number;
    }>;
    cadastreSource: "live" | "seeded";
    cadastreNote: string;
    geometryBbox: [number, number, number, number] | null;
    geometryVertexCount: number;
    geometryAreaKm2: number;
    grantsSource: "live" | "seeded" | "cache";
    refreshedAt: string;
    minedexUrl: string;
    typeLabel: string;
  };
  output: string;
};

const PropertyMap = dynamic(() => import("@/components/PropertyMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-ink-100 flex items-center justify-center text-ink-400 text-sm">
      Loading map…
    </div>
  ),
});

function relativeDays(grantDateMs: number): string {
  const days = Math.max(0, Math.floor((Date.now() - grantDateMs) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function formatLong(grantDate: string): string {
  // grantDate is "YYYY-MM-DD".
  const d = new Date(`${grantDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return grantDate;
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function GrantDetailPage() {
  const params = useParams<{ tenementId: string }>();
  const router = useRouter();
  const encoded = params.tenementId;
  const url = `/api/grants/${encoded}?sinceDays=365`;
  const state = useFetch<GrantDetailResponse>(url);

  const [aerialOpen, setAerialOpen] = useState(false);
  const [highlightedParcel, setHighlightedParcel] = useState<string | null>(null);
  const [evidenceState, setEvidenceState] = useState<
    | { kind: "idle" }
    | { kind: "running"; assessment: string }
    | { kind: "done"; assessment: string; output: string }
    | { kind: "error"; message: string }
    | { kind: "picker"; options: string[] }
  >({ kind: "idle" });

  const data = useMemo(() => {
    return state.status === "ok" ? state.data.data : null;
  }, [state]);

  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error") {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="card p-6 max-w-md text-center">
            <div className="text-critical-700 font-medium mb-1">
              Could not load grant briefing
            </div>
            <div className="text-sm text-ink-600 mb-3">{state.error}</div>
            <Link
              href="/alerts"
              className="text-sm px-3 py-1 rounded bg-accent-500 text-white hover:bg-accent-600 inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> Back to alerts
            </Link>
          </div>
        </main>
      </div>
    );
  }
  if (!data) return <ErrorState message="missing payload" />;

  const { grant, intersectingParcels, cadastreSource, refreshedAt } = data;

  async function runEvidencePack(assessment: string) {
    setEvidenceState({ kind: "running", assessment });
    try {
      const r = await fetch("/api/tools/generate_evidence_pack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { assessmentNumber: assessment } }),
      });
      const j = (await r.json()) as { ok?: boolean; output?: string; error?: string };
      if (!r.ok || !j.ok) {
        setEvidenceState({ kind: "error", message: j.error ?? `HTTP ${r.status}` });
        return;
      }
      setEvidenceState({
        kind: "done",
        assessment,
        output: j.output ?? "(generated, but output empty)",
      });
    } catch (e) {
      setEvidenceState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function onEvidenceClick() {
    if (intersectingParcels.length === 0) {
      setEvidenceState({
        kind: "error",
        message: "No intersecting parcels — pick a parcel from the table first.",
      });
      return;
    }
    if (intersectingParcels.length === 1) {
      void runEvidencePack(intersectingParcels[0]!.assessmentNumber);
      return;
    }
    setEvidenceState({
      kind: "picker",
      options: intersectingParcels.map((p) => p.assessmentNumber),
    });
  }

  const isProvisional = grant.provisional;
  const statusBadge = isProvisional ? "PROVISIONAL" : "FINAL";

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-y-auto bg-ink-50">
        {/* Header strip */}
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <button
            onClick={() => router.push("/alerts")}
            className="text-xs text-ink-500 hover:text-ink-700 inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="w-3 h-3" /> Back to alerts
          </button>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold text-ink-900 font-mono">
                {grant.tenementIdDisplay}{" "}
                <span className="text-base font-sans font-normal text-ink-500">
                  — {grant.typeLabel}
                </span>
              </h1>
              <div className="text-sm text-ink-700 mt-1">{grant.holder}</div>
              <div className="text-sm text-ink-500 mt-0.5" title={grant.grantDate}>
                Granted {formatLong(grant.grantDate)}{" "}
                <span className="text-ink-400">
                  ({relativeDays(grant.grantDateMs)})
                </span>
              </div>
              <div className="flex gap-2 mt-2">
                {isProvisional && (
                  <span className="text-[11px] uppercase tracking-widest px-2 py-0.5 rounded bg-warn-100 text-warn-700 border border-warn-300">
                    Provisional · 30-day appeal window
                  </span>
                )}
                {!isProvisional && (
                  <span className="text-[11px] uppercase tracking-widest text-ink-400">
                    {statusBadge}
                  </span>
                )}
                <span className="text-[11px] uppercase tracking-widest text-ink-400">
                  source: {data.grantsSource}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2 items-end">
              <a
                href={grant.detailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded border border-ink-300 hover:bg-ink-50 text-ink-700"
              >
                Open in MINEDEX
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                onClick={onEvidenceClick}
                disabled={evidenceState.kind === "running"}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-accent-500 hover:bg-accent-600 disabled:bg-ink-300 text-white"
              >
                <FileText className="w-3 h-3" />
                {evidenceState.kind === "running"
                  ? "Generating…"
                  : "Generate evidence pack"}
              </button>
            </div>
          </div>

          {evidenceState.kind === "picker" && (
            <div className="mt-3 p-3 border border-ink-200 rounded bg-ink-50">
              <div className="text-xs text-ink-700 mb-2">
                Multiple parcels intersect — pick one for the evidence pack:
              </div>
              <div className="flex flex-wrap gap-2">
                {evidenceState.options.map((a) => (
                  <button
                    key={a}
                    onClick={() => void runEvidencePack(a)}
                    className="text-xs font-mono px-2 py-1 rounded bg-white border border-ink-300 hover:bg-accent-50 hover:border-accent-300"
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}
          {evidenceState.kind === "done" && (
            <div className="mt-3 p-3 border border-success-300 rounded bg-success-50 text-xs text-ink-800">
              Evidence pack generated for{" "}
              <code className="text-accent-700">{evidenceState.assessment}</code>.
              Visit{" "}
              <Link
                href={`/recovery/${evidenceState.assessment}`}
                className="text-accent-700 underline"
              >
                /recovery/{evidenceState.assessment}
              </Link>{" "}
              to view.
            </div>
          )}
          {evidenceState.kind === "error" && (
            <div className="mt-3 p-3 border border-critical-300 rounded bg-critical-50 text-xs text-critical-700">
              <AlertTriangle className="w-3 h-3 inline mr-1" />
              {evidenceState.message}
            </div>
          )}
        </div>

        {/* Map panel */}
        <div className="bg-white border-b border-ink-200">
          <div className="h-[480px]">
            <PropertyMap
              focusMode="tenement"
              tenement={{
                id: grant.tenementId,
                idDisplay: grant.tenementIdDisplay,
                geometry: grant.geometry,
                holder: grant.holder,
              }}
              stats={{
                assessmentNumber: intersectingParcels[0]?.assessmentNumber,
                address: intersectingParcels[0]?.address,
                landUse: intersectingParcels[0]?.landUse,
                valuation: intersectingParcels[0]?.valuation,
                currentAnnualRates: intersectingParcels[0]?.annualRates,
                estimatedUplift: intersectingParcels[0]?.estimatedUpliftAmount,
              }}
              evidenceHref={
                intersectingParcels[0]
                  ? `/recovery/${intersectingParcels[0].assessmentNumber}`
                  : undefined
              }
            />
          </div>
        </div>

        {/* Aerial preview (collapsible) */}
        <div className="bg-white border-b border-ink-200">
          <button
            onClick={() => setAerialOpen((v) => !v)}
            className="w-full px-6 py-3 text-left flex items-center justify-between hover:bg-ink-50"
          >
            <span className="text-sm text-ink-700 inline-flex items-center gap-2">
              <Eye className="w-4 h-4 text-ink-500" />
              {aerialOpen ? "Hide" : "Show"} aerial imagery
            </span>
            <span className="text-[11px] uppercase tracking-widest text-ink-400">
              {process.env.NEXT_PUBLIC_NEARMAP_API_KEY ? "AERIAL: LIVE" : "AERIAL: SEEDED"}
            </span>
          </button>
          {aerialOpen && (
            <div className="px-6 pb-4">
              <div className="h-[320px] bg-ink-100 rounded border border-ink-200 flex items-center justify-center text-ink-500 text-sm">
                {process.env.NEXT_PUBLIC_NEARMAP_API_KEY ? (
                  <span>Aerial imagery embed (Nearmap)</span>
                ) : (
                  <div className="text-center">
                    <div className="text-[11px] uppercase tracking-widest text-ink-400 mb-1">
                      Aerial: seeded stand-in
                    </div>
                    <div>
                      Configure <code>NEXT_PUBLIC_NEARMAP_API_KEY</code> to
                      enable live aerial imagery.
                    </div>
                    <div className="mt-2">
                      <Link href="/aerial" className="text-accent-700 underline text-xs">
                        Open /aerial workspace →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Body grid: parcels + metadata */}
        <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Affected parcels table */}
          <IntersectionTable
            parcels={intersectingParcels}
            cadastreSource={cadastreSource}
            highlightedAssessment={highlightedParcel}
          />

          {/* Tenement metadata card */}
          <div className="card p-5 space-y-3">
            <div className="text-sm font-medium text-ink-900 inline-flex items-center gap-2">
              <MapPin className="w-4 h-4 text-ink-500" />
              Tenement metadata
            </div>
            <Field k="Raw tenement ID">
              <code className="text-xs text-accent-700 font-mono">
                {grant.tenementId}
              </code>
            </Field>
            <Field k="Status">
              {isProvisional ? (
                <span className="badge badge-warn">PROVISIONAL</span>
              ) : (
                <span className="badge badge-neutral">{statusBadge}</span>
              )}
            </Field>
            <Field k="Type">{grant.typeLabel}</Field>
            <Field k="Holder">{grant.holder}</Field>
            <Field k="Granted">{grant.grantDate}</Field>
            <Field k="Geometry">
              {grant.geometry.type}, {data.geometryVertexCount} vertices,{" "}
              {data.geometryAreaKm2.toFixed(1)} km²
            </Field>
            {data.geometryBbox && (
              <Field k="Bounding box">
                <div className="text-[10px] font-mono text-ink-500">
                  {data.geometryBbox.map((n) => n.toFixed(4)).join(", ")}
                </div>
              </Field>
            )}
            <Field k="Source">
              <span className="text-[11px] uppercase tracking-widest text-ink-500">
                {data.grantsSource === "live" ? "LIVE" : "SEEDED"}
              </span>
            </Field>

            {/* External registers — TENGRAPH + EMITS click-throughs.
                MINEDEX is already reachable from the header "Open in MINEDEX"
                button; we mirror it here for register-rail completeness. */}
            <div className="pt-2 border-t border-ink-200" />
            <Field k="MINEDEX (DMIRS textual register)">
              <a
                href={grant.detailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent-700 hover:underline inline-flex items-center gap-1"
              >
                Open in MINEDEX <ExternalLink className="w-3 h-3" />
              </a>
            </Field>
            <Field k="TENGRAPH (DMIRS spatial viewer)">
              <a
                href={buildTengraphUrl(grant.tenementId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent-700 hover:underline inline-flex items-center gap-1"
                title="TenGraph has no documented deep-link; paste the tenement id into the viewer search."
              >
                Open in TenGraph <ExternalLink className="w-3 h-3" />
              </a>
              <div className="text-[10px] text-ink-400 mt-0.5">
                Viewer search; paste id once loaded.
              </div>
            </Field>
            <Field k="Environmental approval (EMITS)">
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={buildEmitsSearchUrl(grant.tenementId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent-700 hover:underline inline-flex items-center gap-1"
                  title="EMITS portal requires a browser session; deep-linking not supported."
                >
                  Search EMITS <ExternalLink className="w-3 h-3" />
                </a>
                <span
                  className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-ink-100 text-ink-500 border border-ink-200"
                  title="EMITS publishes no machine-readable export; UI uses seeded fixtures for the recovery signal."
                >
                  Source: SEEDED
                </span>
              </div>
              <div className="text-[10px] text-ink-400 mt-0.5">
                Public search; browser session required.
              </div>
            </Field>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-ink-200 bg-white text-xs text-ink-500 space-y-1">
          <div>
            Last data refresh:{" "}
            <span className="font-mono text-ink-700">{refreshedAt}</span>
          </div>
          <div>
            RatesAssist computes the tenement→parcel intersection from public
            DMIRS and Landgate data. Council policy may vary on
            reclassification triggers. This page is decision-support, not
            authoritative.
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label text-[10px] uppercase tracking-widest text-ink-400">
        {k}
      </div>
      <div className="text-sm text-ink-800">{children}</div>
    </div>
  );
}
