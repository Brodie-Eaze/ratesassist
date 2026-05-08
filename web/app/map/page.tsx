"use client";

import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import {
  PortfolioMap,
  AUSTRALIA_CENTRE,
  AUSTRALIA_ZOOM,
} from "@/components/PortfolioMap";
import { formatAud } from "@/lib/utils";
import type {
  Council,
  MismatchCandidate,
  Property,
  Tenement,
} from "@/lib/types";
import {
  BASEMAPS,
  OVERLAYS,
  basemapStatus,
} from "@/lib/basemaps";
import { Layers, MapPin, Globe, Zap } from "lucide-react";

type DataResponse = {
  councils: Council[];
  properties: Property[];
  tenements: Tenement[];
  mismatches: MismatchCandidate[];
};

export default function MapPage() {
  const [data, setData] = useState<DataResponse | null>(null);
  const [council, setCouncil] = useState<string>("");
  const [filterType, setFilterType] = useState<"all" | "mining" | "overdue">("all");
  const [basemapId, setBasemapId] = useState<string>("carto-positron");
  const [overlayIds, setOverlayIds] = useState<string[]>([]);
  const [liveVectors, setLiveVectors] = useState<boolean>(false);
  const [selectedTenementId, setSelectedTenementId] = useState<string | undefined>();

  // Filter to only available basemaps (premium fallbacks)
  const availableBasemaps = useMemo(
    () => BASEMAPS.filter((b) => b.url !== null),
    [],
  );

  const status = useMemo(() => basemapStatus(), []);

  useEffect(() => {
    fetch("/api/data").then((r) => r.json()).then(setData);
  }, []);

  if (!data) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center text-ink-500">
          Loading…
        </main>
      </div>
    );
  }

  const tenementCoverage = new Set(
    data.tenements.flatMap((t) => t.intersectsAssessmentNumbers),
  );

  let filteredProps = council
    ? data.properties.filter((p) => p.council === council)
    : data.properties;
  if (filterType === "mining") {
    filteredProps = filteredProps.filter((p) =>
      tenementCoverage.has(p.assessmentNumber),
    );
  } else if (filterType === "overdue") {
    filteredProps = filteredProps.filter((p) => p.balance > 0);
  }

  const filteredTenements = council
    ? data.tenements.filter((t) =>
        t.intersectsAssessmentNumbers.some((a) =>
          data.properties.some(
            (p) => p.assessmentNumber === a && p.council === council,
          ),
        ),
      )
    : data.tenements;

  const selectedCouncil = data.councils.find((c) => c.code === council);
  const centre: [number, number] = selectedCouncil
    ? [selectedCouncil.centerLat, selectedCouncil.centerLng]
    : AUSTRALIA_CENTRE;
  const zoom = selectedCouncil ? 11 : AUSTRALIA_ZOOM;

  const totalUplift = data.mismatches
    .filter((m) => !council || m.property.council === council)
    .reduce((s, m) => s + m.estUplift, 0);
  const overdueCount = filteredProps.filter((p) => p.balance > 0).length;
  const miningCount = filteredProps.filter((p) =>
    tenementCoverage.has(p.assessmentNumber),
  ).length;

  function toggleOverlay(id: string) {
    setOverlayIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // Group basemaps by category for the dropdown
  const grouped = availableBasemaps.reduce<Record<string, typeof availableBasemaps>>(
    (acc, b) => {
      acc[b.category] = acc[b.category] ?? [];
      acc[b.category].push(b);
      return acc;
    },
    {},
  );

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-accent-500" />
              Portfolio Map
            </h1>
            <div className="text-sm text-ink-500">
              {filteredProps.length} properties · {filteredTenements.length} tenement
              overlays · uplift visible: {formatAud(totalUplift)}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="input max-w-[200px]"
              value={council}
              onChange={(e) => setCouncil(e.target.value)}
            >
              <option value="">All councils</option>
              {data.councils.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="input max-w-[160px]"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as never)}
            >
              <option value="all">All properties</option>
              <option value="mining">Mining-affected</option>
              <option value="overdue">Overdue only</option>
            </select>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Map */}
          <div className="flex-1 bg-ink-100 p-3">
            <PortfolioMap
              properties={filteredProps}
              tenements={filteredTenements}
              councils={data.councils}
              centre={centre}
              zoom={zoom}
              basemapId={basemapId}
              overlayIds={overlayIds}
              liveVectors={liveVectors}
              selectedTenementId={selectedTenementId}
              onSelectTenement={setSelectedTenementId}
            />
          </div>

          {/* Side panel */}
          <aside className="w-80 border-l border-ink-200 bg-white overflow-y-auto">
            <div className="p-4 border-b border-ink-200">
              <div className="label flex items-center gap-1.5 mb-2">
                <Globe className="w-3 h-3" />
                Basemap
              </div>
              <select
                className="input"
                value={basemapId}
                onChange={(e) => setBasemapId(e.target.value)}
              >
                {Object.entries(grouped).map(([cat, bms]) => (
                  <optgroup key={cat} label={cat}>
                    {bms.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.premium ? "★ " : ""}
                        {b.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <div className="text-xs text-ink-500 mt-1.5">
                {BASEMAPS.find((b) => b.id === basemapId)?.vendor}
                {BASEMAPS.find((b) => b.id === basemapId)?.premium && (
                  <span className="badge bg-accent-50 text-accent-700 ml-2">
                    Premium
                  </span>
                )}
              </div>
            </div>

            <div className="p-4 border-b border-ink-200">
              <div className="label flex items-center gap-1.5 mb-2">
                <Zap className="w-3 h-3" />
                Live precision mode
              </div>
              <label className="flex items-start gap-2 cursor-pointer hover:bg-ink-50 -mx-2 px-2 py-2 rounded">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={liveVectors}
                  onChange={(e) => setLiveVectors(e.target.checked)}
                />
                <div className="text-sm flex-1">
                  <div className="font-medium text-ink-900 flex items-center gap-1.5">
                    Live vector polygons
                    <span className="badge bg-success-50 text-success-700 text-[9px]">Gotham</span>
                  </div>
                  <div className="text-xs text-ink-500 mt-0.5">
                    Fetches real DMIRS tenement and Landgate cadastral polygons (vector,
                    interactive, with full attribute popups) for the current viewport.
                    Tenements load at zoom ≥ 8; cadastral parcels at zoom ≥ 14.
                  </div>
                </div>
              </label>
            </div>

            <div className="p-4 border-b border-ink-200">
              <div className="label flex items-center gap-1.5 mb-2">
                <Layers className="w-3 h-3" />
                Raster overlays
              </div>
              <div className="space-y-2">
                {OVERLAYS.map((o) => (
                  <label
                    key={o.id}
                    className="flex items-start gap-2 cursor-pointer hover:bg-ink-50 -mx-2 px-2 py-1 rounded"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={overlayIds.includes(o.id)}
                      onChange={() => toggleOverlay(o.id)}
                    />
                    <div className="text-sm flex-1">
                      <div className="font-medium text-ink-900">{o.name}</div>
                      <div className="text-xs text-ink-500">{o.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="p-4 border-b border-ink-200">
              <div className="label mb-2">In view</div>
              <div className="space-y-1.5 text-sm">
                <Stat label="Properties" value={filteredProps.length.toString()} />
                <Stat label="Mining-affected" value={miningCount.toString()} />
                <Stat label="Overdue" value={overdueCount.toString()} />
                <Stat
                  label="Recovery uplift"
                  value={formatAud(totalUplift)}
                  highlight
                />
              </div>
            </div>

            <div className="p-4 border-b border-ink-200">
              <div className="label mb-2">Legend</div>
              <div className="space-y-2 text-sm">
                <LegendDot color="#1a52d4" label="Property" />
                <LegendDot color="#f59e0b" label="Overdue" />
                <LegendDot color="#ef4444" label="Mining-affected" />
                <LegendDot color="#10b981" label="Selected" />
                <div className="flex items-center gap-2 mt-2">
                  <span className="inline-block w-4 h-2 rounded-sm bg-warn-300/40 border border-warn-500"></span>
                  <span className="text-ink-700 text-xs">Tenement (exploration)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block w-4 h-2 rounded-sm bg-critical-500/30 border border-critical-700"></span>
                  <span className="text-ink-700 text-xs">Tenement (producing)</span>
                </div>
              </div>
            </div>

            <div className="p-4">
              <div className="label flex items-center gap-1.5 mb-2">
                <Zap className="w-3 h-3" />
                Provider status
              </div>
              <div className="space-y-1 text-xs">
                <ProviderRow ok={status.osm} label="OpenStreetMap" />
                <ProviderRow ok={status.esri} label="Esri (Streets/Imagery/Topo)" />
                <ProviderRow ok={status.carto} label="CARTO" />
                <ProviderRow ok={status.opentopo} label="OpenTopoMap" />
                <ProviderRow ok={status.mapbox} label="Mapbox" premium />
                <ProviderRow ok={status.maptiler} label="MapTiler" premium />
                <ProviderRow ok={status.nearmap} label="Nearmap" premium />
                <ProviderRow ok={status.landgate} label="Landgate SLIP (WMS)" />
                <ProviderRow ok={status.dmirs} label="DMIRS WMS" />
              </div>
              <div className="text-[11px] text-ink-500 mt-2 leading-relaxed">
                Premium providers show <span className="text-warn-700">●</span> when no
                API key is configured. Set <code>NEXT_PUBLIC_MAPBOX_TOKEN</code>,
                {" "}<code>NEXT_PUBLIC_NEARMAP_API_KEY</code>, or
                {" "}<code>NEXT_PUBLIC_MAPTILER_KEY</code> in <code>.env.local</code>{" "}
                and restart to enable.
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block w-3 h-3 rounded-full ring-2 ring-white"
        style={{ background: color, boxShadow: `0 0 0 1px ${color}30` }}
      ></span>
      <span className="text-ink-700">{label}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-ink-500 text-xs">{label}</span>
      <span
        className={`text-sm tabular-nums ${
          highlight ? "font-semibold text-success-700" : "text-ink-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function ProviderRow({
  ok,
  label,
  premium = false,
}: {
  ok: boolean;
  label: string;
  premium?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${
          ok ? "bg-success-500" : "bg-warn-500"
        }`}
      ></span>
      <span className="text-ink-700">{label}</span>
      {premium && (
        <span className="text-[9px] uppercase tracking-widest text-ink-400 ml-auto">
          {ok ? "Live" : "No key"}
        </span>
      )}
    </div>
  );
}
