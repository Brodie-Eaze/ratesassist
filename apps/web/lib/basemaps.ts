// Basemap + overlay registry. Multiple real mapping providers wired up.
// Premium providers (Mapbox/Nearmap/MapTiler) gracefully degrade when no
// API key is configured.

export type BasemapDef = {
  id: string;
  name: string;
  category: "Streets" | "Satellite" | "Hybrid" | "Terrain" | "AU-specific" | "Cadastral";
  url: string | null; // null = unavailable (no API key)
  attribution: string;
  maxZoom?: number;
  premium?: boolean;
  vendor: string;
  // Optional URL params
  subdomains?: string;
};

export type OverlayDef = {
  id: string;
  name: string;
  type: "wms" | "tile";
  url: string;
  layers?: string;        // for WMS
  format?: string;        // for WMS
  transparent?: boolean;
  attribution: string;
  vendor: string;
  description: string;
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const NEARMAP_KEY = process.env.NEXT_PUBLIC_NEARMAP_API_KEY ?? "";
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";

// Free interstate + national WMS overlays (E2 edge build). Each defaults to the
// public service URL and is NEXT_PUBLIC_-overridable (zero-config defaults;
// override per deployment) — same convention as the Landgate cadastre below.
const SARIG_TENEMENTS_WMS =
  process.env.NEXT_PUBLIC_SARIG_WMS ??
  "https://services.sarig.sa.gov.au/vector/mineral_tenements/wms";
const QLD_TENURE_WMS =
  process.env.NEXT_PUBLIC_QLD_TENURE_WMS ??
  "https://spatial-gis.information.qld.gov.au/arcgis/services/Economy/MinesPermitsCurrent/MapServer/WMSServer";
const DEA_OWS_WMS =
  process.env.NEXT_PUBLIC_DEA_WMS ?? "https://ows.dea.ga.gov.au/wms";

// WA Pastoral Stations (DPLH-083) — pastoral leases over Crown land (UV-rated;
// mining-on-pastoral is a classic rates mismatch). Layer 122 of the SLIP
// Property_and_Planning MapServer. ⚠ LICENCE: CC BY-NC 4.0 (NON-COMMERCIAL) —
// commercial use in a paid product needs confirmation with DPLH (spatialdata@dplh.wa.gov.au).
// Wired off by intent is not possible for an overlay, so it ships visible but the
// licence caveat is queued (Q-edge-pastoral-licence) before any commercial reliance.
const PASTORAL_WMS =
  process.env.NEXT_PUBLIC_PASTORAL_WMS ??
  "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Property_and_Planning/MapServer/WMSServer";

// Optional override for the Landgate SLIP cadastre WMS overlay endpoint.
// Defaults to the public SLIP cadastre WMS when unset. Must use the
// NEXT_PUBLIC_ prefix because this registry is consumed by client components
// (app/map/page.tsx, components/MapInner.tsx) — a bare server var would be
// undefined in the browser bundle and silently never apply.
const LANDGATE_CADASTRE_WMS =
  process.env.NEXT_PUBLIC_LANDGATE_SLIP_WMS ??
  "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Cadastre/MapServer/WMSServer";

// Landgate WA aerial imagery — the SLIP "Locate" MapServer (whole-of-state,
// flattened/seamless; ~400-day-old free public tier; current capture is the paid
// Capture WA subscription). Confirmed dynamic-only (singleFusedMapCache: false) —
// the /tile/{z}/{y}/{x} endpoint 404s. Use as a WMS overlay (see OVERLAYS below).
// NEXT_PUBLIC_ so the client bundle resolves it.
const LANDGATE_AERIAL_WMS =
  process.env.NEXT_PUBLIC_LANDGATE_AERIAL_WMS ??
  "https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Locate/MapServer/WMSServer";

// ===== Basemaps (free + premium with graceful fallback) =====

export const BASEMAPS: BasemapDef[] = [
  // ----- FREE / public -----
  {
    id: "osm",
    name: "OpenStreetMap",
    category: "Streets",
    url: "https://{s}.tile.openstreetmap.org/{z}/{y}/{x}.png",
    subdomains: "abc",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    vendor: "OpenStreetMap",
  },
  {
    id: "carto-positron",
    name: "Carto Positron",
    category: "Streets",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    attribution:
      '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com">CARTO</a>',
    maxZoom: 20,
    vendor: "CARTO",
  },
  {
    id: "carto-dark",
    name: "Carto Dark Matter",
    category: "Streets",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    attribution:
      '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com">CARTO</a>',
    maxZoom: 20,
    vendor: "CARTO",
  },
  {
    id: "esri-streets",
    name: "Esri World Streets",
    category: "Streets",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    maxZoom: 19,
    vendor: "Esri",
  },
  {
    id: "esri-imagery",
    name: "Esri World Imagery",
    category: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, USGS",
    maxZoom: 19,
    vendor: "Esri / Maxar",
  },
  {
    id: "landgate-aerial",
    name: "Landgate WA Aerial (SLIP Locate)",
    category: "Satellite",
    // SLIP Locate is a dynamic WMS service (singleFusedMapCache: false confirmed).
    // The /tile/{z}/{y}/{x} endpoint returns HTTP 404 — no tile cache exists.
    // Aerial imagery is available as the WMS overlay "landgate-aerial-wms" below.
    // The paid Capture WA subscription is the current-capture deep-zoom tier.
    url: null,
    attribution: "Imagery &copy; Landgate (WA) / Capture WA",
    maxZoom: 20,
    vendor: "Landgate",
  },
  {
    id: "esri-hybrid",
    name: "Esri Hybrid (Imagery + Labels)",
    category: "Hybrid",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    maxZoom: 19,
    vendor: "Esri",
  },
  {
    id: "esri-topo",
    name: "Esri World Topographic",
    category: "Terrain",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    maxZoom: 19,
    vendor: "Esri",
  },
  {
    id: "opentopo",
    name: "OpenTopoMap",
    category: "Terrain",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    subdomains: "abc",
    attribution:
      "&copy; OpenStreetMap, SRTM &copy; OpenTopoMap (CC-BY-SA)",
    maxZoom: 17,
    vendor: "OpenTopoMap",
  },
  // ----- Premium (require API key) -----
  {
    id: "mapbox-streets",
    name: "Mapbox Streets",
    category: "Streets",
    url: MAPBOX_TOKEN
      ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`
      : null,
    attribution:
      '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/about/">OpenStreetMap</a>',
    maxZoom: 22,
    premium: true,
    vendor: "Mapbox",
  },
  {
    id: "mapbox-satellite",
    name: "Mapbox Satellite",
    category: "Satellite",
    url: MAPBOX_TOKEN
      ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`
      : null,
    attribution: '&copy; Mapbox &copy; Maxar',
    maxZoom: 22,
    premium: true,
    vendor: "Mapbox",
  },
  {
    id: "mapbox-hybrid",
    name: "Mapbox Satellite Streets (Hybrid)",
    category: "Hybrid",
    url: MAPBOX_TOKEN
      ? `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`
      : null,
    attribution: '&copy; Mapbox &copy; OpenStreetMap',
    maxZoom: 22,
    premium: true,
    vendor: "Mapbox",
  },
  {
    id: "mapbox-outdoors",
    name: "Mapbox Outdoors",
    category: "Terrain",
    url: MAPBOX_TOKEN
      ? `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`
      : null,
    attribution: '&copy; Mapbox &copy; OpenStreetMap',
    maxZoom: 22,
    premium: true,
    vendor: "Mapbox",
  },
  {
    id: "maptiler-satellite",
    name: "MapTiler Satellite",
    category: "Satellite",
    url: MAPTILER_KEY
      ? `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`
      : null,
    attribution:
      '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>',
    maxZoom: 20,
    premium: true,
    vendor: "MapTiler",
  },
  {
    id: "nearmap-vert",
    name: "Nearmap (Vertical)",
    category: "Satellite",
    url: NEARMAP_KEY
      ? `https://api.nearmap.com/tiles/v3/Vert/{z}/{x}/{y}.jpg?apikey=${NEARMAP_KEY}`
      : null,
    attribution:
      'Imagery &copy; <a href="https://www.nearmap.com">Nearmap</a>',
    maxZoom: 22,
    premium: true,
    vendor: "Nearmap",
  },
];

// ===== Map overlays (added on top of basemap) =====

export const OVERLAYS: OverlayDef[] = [
  {
    id: "landgate-cadastre",
    name: "Landgate SLIP — Cadastre (WA)",
    type: "wms",
    url: LANDGATE_CADASTRE_WMS,
    layers: "1",
    format: "image/png",
    transparent: true,
    attribution: "&copy; Landgate SLIP (WA)",
    vendor: "Landgate",
    description: "WA cadastral parcel boundaries via Landgate SLIP public WMS.",
  },
  {
    id: "dmirs-tenements-wms",
    name: "DMIRS Mining Tenements (WA)",
    type: "wms",
    url: "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Industry_and_Mining/MapServer/WMSServer",
    layers: "1",
    format: "image/png",
    transparent: true,
    attribution: "&copy; DMIRS",
    vendor: "DMIRS",
    description: "WA mining tenement boundaries (live, mining lease, exploration etc.) via DMIRS public WMS.",
  },
  {
    id: "sa-sarig-tenements",
    name: "SA SARIG Mineral Tenements",
    type: "wms",
    url: SARIG_TENEMENTS_WMS,
    // Confirmed via GetCapabilities (2026-06-07): SARIG GeoServer exposes individual
    // tenement-type layers — not a combined "mineral_tenements" group. Active-granted
    // types: mineral_leases (ML), mineral_and_or_opal_exploration_licence (MEL),
    // mineral_claims (MC). Comma-separated for a combined overlay.
    layers: "mineral_leases,mineral_and_or_opal_exploration_licence,mineral_claims",
    format: "image/png",
    transparent: true,
    attribution: "&copy; SARIG (SA Dept for Energy and Mining) — CC BY 3.0 AU",
    vendor: "SARIG",
    description: "SA mineral tenement boundaries via SARIG public WMS (CC BY 3.0 AU). Covers mineral leases, exploration licences, and mining claims. The SA sibling of the WA DMIRS overlay.",
  },
  {
    id: "qld-tenure-tenements",
    name: "QLD Mining & Exploration Tenure",
    type: "wms",
    url: QLD_TENURE_WMS,
    // Confirmed via GetCapabilities (2026-06-07): ArcGIS WMS layer names are
    // descriptive (not numeric). Granted mineral tenement types for rating purposes:
    //   EPM_granted39674  — Exploration Permits for Minerals
    //   ML_permit_granted6668  — Mining Lease permit areas
    //   MDL_permit_granted2280 — Mineral Development Licences
    //   MC_permit_granted32595 — Mining Claims
    // Additional granted types available (PL, GL, QL, ATP etc.) — these four
    // cover the rating-material mineral tenements.
    layers: "EPM_granted39674,ML_permit_granted6668,MDL_permit_granted2280,MC_permit_granted32595",
    format: "image/png",
    transparent: true,
    attribution: "&copy; State of Queensland (QSpatial)",
    vendor: "QSpatial",
    description: "QLD current mining/exploration permits via QSpatial public WMS — granted EPM, ML, MDL, and MC tenements.",
  },
  {
    id: "dea-national",
    name: "Digital Earth Australia (national)",
    type: "wms",
    url: DEA_OWS_WMS,
    // Confirmed via GetCapabilities (2026-06-07): correct layer name is
    // "ga_ls_landcover" (annual Landsat land-cover product). Related layers
    // also available: ga_ls_landcover_descriptors, ga_ls_landcover_c3,
    // ga_ls_landcover_c3_descriptors (continuous change). Using the standard
    // annual product as a strong land-use / change signal.
    layers: "ga_ls_landcover",
    format: "image/png",
    transparent: true,
    attribution: "&copy; Geoscience Australia — Digital Earth Australia, CC BY 4.0",
    vendor: "DEA",
    description: "Free national satellite-derived land cover products via DEA OWS — annual Landsat land-cover layer (strong land-use / change signal).",
  },
  {
    id: "wa-pastoral-stations",
    name: "WA Pastoral Stations (DPLH-083)",
    type: "wms",
    url: PASTORAL_WMS,
    // Layer 122 of Property_and_Planning MapServer (polygon pastoral-lease boundaries).
    layers: "122",
    format: "image/png",
    transparent: true,
    // ⚠ CC BY-NC 4.0 (Non-Commercial) — see Q-edge-pastoral-licence before commercial reliance.
    attribution: "&copy; DPLH (WA) — Pastoral Stations, CC BY-NC 4.0",
    vendor: "DPLH",
    description: "WA pastoral lease boundaries (Crown-land grazing leases, UV-rated) — the mining-on-pastoral mismatch layer. NON-COMMERCIAL licence — confirm commercial use with DPLH.",
  },
  {
    id: "landgate-aerial-wms",
    name: "Landgate WA Aerial (SLIP Locate WMS)",
    type: "wms",
    url: LANDGATE_AERIAL_WMS,
    // SLIP Locate is a dynamic WMS (singleFusedMapCache: false — confirmed 2026-06-07).
    // Layer "0" renders the default composite whole-of-state aerial view.
    // Free public tier is ~400+ days old. Current-capture imagery requires the
    // paid Capture WA subscription (queued: Q-edge-captureWA).
    layers: "0",
    format: "image/jpeg",
    transparent: false,
    attribution: "Imagery &copy; Landgate (WA) / Capture WA — SLIP Locate free tier",
    vendor: "Landgate",
    description: "WA whole-of-state aerial imagery via Landgate SLIP Locate WMS. Free public tier ~400+ days old. Toggle on top of any basemap for WA-specific aerial coverage.",
  },
];

// Filter out unavailable basemaps (no API key)
export function availableBasemaps(): BasemapDef[] {
  return BASEMAPS.filter((b) => b.url !== null);
}

export function getBasemap(id: string): BasemapDef | undefined {
  return BASEMAPS.find((b) => b.id === id);
}

// Fallback chain for "default" basemaps by category
export function defaultStreets(): BasemapDef {
  return (
    availableBasemaps().find((b) => b.id === "mapbox-streets") ??
    availableBasemaps().find((b) => b.id === "carto-positron")!
  );
}
export function defaultSatellite(): BasemapDef {
  return (
    availableBasemaps().find((b) => b.id === "mapbox-hybrid") ??
    availableBasemaps().find((b) => b.id === "nearmap-vert") ??
    availableBasemaps().find((b) => b.id === "esri-imagery")!
  );
}

// Status report — used by the Connections page
export function basemapStatus() {
  return {
    mapbox: !!MAPBOX_TOKEN,
    nearmap: !!NEARMAP_KEY,
    maptiler: !!MAPTILER_KEY,
    osm: true,
    esri: true,
    carto: true,
    opentopo: true,
    landgate: true,
    dmirs: true,
  };
}
