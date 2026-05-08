"use client";

import dynamic from "next/dynamic";
import type { Council, Property, Tenement } from "@/lib/types";

// Australia geographic centroid
export const AUSTRALIA_CENTRE: [number, number] = [-25.27, 133.78];
export const AUSTRALIA_ZOOM = 4;

const MapInner = dynamic(() => import("./MapInner"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-ink-100 rounded-lg flex items-center justify-center text-ink-400 text-sm">
      Loading map…
    </div>
  ),
});

type Props = {
  properties: readonly Property[];
  tenements?: readonly Tenement[];
  councils?: readonly Council[];
  centre?: [number, number];
  zoom?: number;
  height?: string;
  highlightAssessment?: string;
  basemapId?: string;
  overlayIds?: string[];
  /** Convenience flag: when true, picks an aerial basemap automatically (Mapbox/Nearmap/Esri). */
  showAerial?: boolean;
  /** When true, fetch real vector polygons from DMIRS + Landgate for the current bbox/zoom */
  liveVectors?: boolean;
  /** Optional: selected tenement to highlight + buffer */
  selectedTenementId?: string;
  onSelectProperty?: (assessment: string) => void;
  onSelectTenement?: (tenementId: string) => void;
};

export function PortfolioMap({
  properties,
  tenements = [],
  councils = [],
  centre,
  zoom,
  height = "100%",
  highlightAssessment,
  basemapId,
  overlayIds = [],
  showAerial = false,
  liveVectors = false,
  selectedTenementId,
  onSelectProperty,
  onSelectTenement,
}: Props) {
  const c: [number, number] = centre ?? AUSTRALIA_CENTRE;
  const z = zoom ?? AUSTRALIA_ZOOM;

  // Resolve basemap. Allow showAerial as a shortcut.
  const resolvedBasemap =
    basemapId ??
    (showAerial
      ? process.env.NEXT_PUBLIC_MAPBOX_TOKEN
        ? "mapbox-hybrid"
        : process.env.NEXT_PUBLIC_NEARMAP_API_KEY
          ? "nearmap-vert"
          : "esri-imagery"
      : "carto-positron");

  return (
    <div
      style={{ height, width: "100%" }}
      className="rounded-lg overflow-hidden bg-ink-100"
    >
      <MapInner
        properties={properties}
        tenements={tenements}
        councils={councils}
        centre={c}
        zoom={z}
        highlightAssessment={highlightAssessment}
        basemapId={resolvedBasemap}
        overlayIds={overlayIds}
        liveVectors={liveVectors}
        selectedTenementId={selectedTenementId}
        onSelectProperty={onSelectProperty}
        onSelectTenement={onSelectTenement}
      />
    </div>
  );
}
