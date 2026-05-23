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
  | "sentinel-latest"
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
// blank tiles Esri shows for remote WA at high zoom. This is the YEARLY
// composite — every pixel is the median of all cloud-free 2024 scenes, so
// it's deeply stable but ~1 year old by the time you see it.
export const SENTINEL_BASE =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
export const SENTINEL_ATTR =
  'Sentinel-2 cloudless 2024 by <a href="https://s2maps.eu">EOX IT</a> (ESA Copernicus)';

// Esri Living Atlas Sentinel-2 L2A — the LATEST cloud-free scene per area,
// typically <14 days old. Same source data as `SENTINEL_BASE` (ESA Sentinel-2)
// but served as a rolling latest-acquisition layer instead of a yearly
// composite. No API key required (Esri serves it as a free public layer).
// This is the differentiator for council use: every time a clerk opens a
// property, they see imagery captured within the last fortnight — close
// enough to "real-time" to spot new buildings, vegetation clearance,
// mining-tenement expansion before the next valuation cycle.
//
// Resolution is the native Sentinel-2 10m/pixel (RGB true colour).
// For sub-10m detail clerks fall back to "satellite" (Esri World Imagery
// composite) or "slip-aerial" (Landgate WA, where available).
export const SENTINEL_LATEST =
  "https://sentinel.arcgis.com/arcgis/rest/services/Sentinel2L2A/ImageServer/tile/{z}/{y}/{x}";
export const SENTINEL_LATEST_ATTR =
  'Sentinel-2 L2A (latest) © <a href="https://livingatlas.arcgis.com/">Esri Living Atlas</a> · ESA Copernicus';
// Esri's Sentinel-2 L2A ImageServer serves tiles up to z=14 natively
// (~10m/pixel at the equator). At higher zooms Leaflet upsamples.
export const SENTINEL_LATEST_MAX_NATIVE = 14;

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
