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
    url: "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Cadastre/MapServer/WMSServer",
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
