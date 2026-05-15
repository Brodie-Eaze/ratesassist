/**
 * Shared types and constants for the PropertyMap sub-components.
 *
 * Lives alongside the sub-components so each can import a single source of
 * truth for the basemap registry, geometry shape, and stats card payload.
 */

import type { Ring } from "@/lib/polygonClip";
import type { SlipAerialProbeResult } from "@/lib/slipBasemapProbe";

// ---- Geometry ---------------------------------------------------------------

export type Geometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "Point"; coordinates: number[] };

// ---- Focus mode -------------------------------------------------------------

export type PropertyMapFocus = "tenement" | "parcel";

// ---- Stats card -------------------------------------------------------------

export type PropertyMapStats = {
  assessmentNumber?: string;
  address?: string;
  landUse?: string;
  valuation?: number;
  currentAnnualRates?: number;
  projectedAnnualRates?: number;
  estimatedUplift?: number;
};

// ---- Basemap registry -------------------------------------------------------

export type BasemapKey =
  | "hybrid"
  | "satellite"
  | "sentinel"
  | "street"
  | "topo"
  | "slip-aerial";

export type ZoomTarget = "parcel" | "tenement" | "all";

export type CadastreSource = "prop" | "live" | "synthetic";

// ---- Overlap result (mirrors lib/polygonClip overlapStats) ------------------

export type OverlapStats = {
  ring: Ring;
  areaM2: number;
  percentOfParcel: number;
  method: "convex_clip" | "bbox_fallback";
};

// ---- Tile URLs + attributions (single source of truth) ----------------------

export const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const ESRI_REF =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
export const ESRI_TOPO =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}";
export const CARTO_LIGHT =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";

// Sentinel-2 cloudless mosaic from EOX (ESA Copernicus data, ~10m resolution,
// global coverage with no API key). Fixes the "Map data not yet available"
// blank tiles Esri shows for remote WA at high zoom.
export const SENTINEL_BASE =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
export const SENTINEL_ATTR =
  'Sentinel-2 cloudless 2024 by <a href="https://s2maps.eu">EOX IT</a> (ESA Copernicus)';

export const ESRI_ATTR =
  "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics";
export const CARTO_ATTR =
  '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>';

// Esri World Imagery serves real imagery to zoom 17 across remote WA.
// Capping maxNativeZoom at 17 makes Leaflet upsample the real zoom-17 tile
// when the viewport zooms further, instead of falling through to the
// placeholder.
export const ESRI_IMAGERY_MAX_NATIVE = 17;
export const ESRI_IMAGERY_MAX_DISPLAY = 22;

// ---- Probe re-export (so sub-components don't need to import lib directly) -

export type { SlipAerialProbeResult };
