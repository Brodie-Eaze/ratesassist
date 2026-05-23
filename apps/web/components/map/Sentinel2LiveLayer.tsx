"use client";

/**
 * Sentinel2LiveLayer — daily-refresh Sentinel-2 imagery, rendered into
 * Leaflet via Esri's `exportImage` ImageServer endpoint.
 *
 * Why this isn't a plain `<TileLayer>`:
 *
 *   Esri serves Sentinel-2 through an ImageServer
 *   (https://sentinel.arcgis.com/arcgis/rest/services/Sentinel2/ImageServer),
 *   which is NOT a tiled cache — it does not respond to the standard
 *   `tile/{z}/{y}/{x}` URL shape. Instead it renders an arbitrary bbox
 *   on demand via the `exportImage` action. To plug that into Leaflet's
 *   tiled rendering model we subclass `L.TileLayer` and override
 *   `getTileUrl` to:
 *     1. Compute the tile's Web Mercator (EPSG:3857) extent from (z,x,y).
 *     2. Build an `exportImage` URL that asks for a 256×256 JPEG of that
 *        exact extent.
 *
 *   Leaflet then treats the per-tile response like a normal tile and
 *   caches/composes it the same way.
 *
 * The result is daily-fresh Sentinel-2 imagery (per Esri's service
 * description: "updated daily with new imagery") delivered as ordinary
 * raster tiles. No API key, no Esri-leaflet dependency, no separate
 * basemap service.
 */

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import {
  SENTINEL_LATEST_EXPORT_IMAGE,
  SENTINEL_LATEST_ATTR,
  SENTINEL_LATEST_MAX_NATIVE,
  ESRI_IMAGERY_MAX_DISPLAY,
} from "./types";

/**
 * Web Mercator (EPSG:3857) constants — the projection Leaflet uses for
 * every tile coordinate. The full world extent is a square from
 * (-EXTENT/2, -EXTENT/2) to (+EXTENT/2, +EXTENT/2).
 */
const MERCATOR_ORIGIN_M = -20037508.342789244;
const MERCATOR_EXTENT_M = 40075016.685578487;

/**
 * Translate a tile coordinate (z, x, y) to the bounding box in EPSG:3857
 * that the tile covers, then return the `exportImage` URL that asks Esri
 * to render that bbox as a 256×256 JPEG.
 *
 * `coords.y` is in Leaflet's TMS-inverted form already (top-down), which
 * matches the Esri Mercator coordinate convention where north has a
 * higher Y value.
 */
function tileCoordToExportImageUrl(coords: {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}): string {
  const tileSizeM = MERCATOR_EXTENT_M / Math.pow(2, coords.z);
  const west = MERCATOR_ORIGIN_M + coords.x * tileSizeM;
  const east = west + tileSizeM;
  // y=0 is the topmost row (north pole) — that's MERCATOR_ORIGIN_M
  // flipped to positive (= +20037508). North of a tile row at y_idx is:
  const north = -MERCATOR_ORIGIN_M - coords.y * tileSizeM;
  const south = north - tileSizeM;
  const params = new URLSearchParams({
    bbox: `${west},${south},${east},${north}`,
    bboxSR: "3857",
    imageSR: "3857",
    size: "256,256",
    format: "jpg",
    f: "image",
  });
  return `${SENTINEL_LATEST_EXPORT_IMAGE}?${params.toString()}`;
}

/**
 * Custom TileLayer subclass — exists outside React because Leaflet's
 * class hierarchy is the only clean way to override `getTileUrl`.
 *
 * Created once per layer mount, not once per render. The React component
 * below ({@link Sentinel2LiveLayer}) handles the imperative add/remove.
 */
class EsriExportImageTileLayer extends L.TileLayer {
  public getTileUrl(coords: L.Coords): string {
    return tileCoordToExportImageUrl({
      x: coords.x,
      y: coords.y,
      z: coords.z,
    });
  }
}

/**
 * React-Leaflet wrapper. Imperatively mounts the custom layer to the
 * containing `<MapContainer>` on first render, removes it on unmount.
 *
 * Render this conditionally from `<BasemapLayer>` when
 * `basemap === "sentinel-latest"`, the same way the other basemap
 * options are conditionally mounted.
 */
export default function Sentinel2LiveLayer(): null {
  const map = useMap();
  useEffect(() => {
    const layer = new EsriExportImageTileLayer("", {
      attribution: SENTINEL_LATEST_ATTR,
      maxNativeZoom: SENTINEL_LATEST_MAX_NATIVE,
      maxZoom: ESRI_IMAGERY_MAX_DISPLAY,
      // tileSize defaults to 256 — matches the 256,256 we ask Esri for.
      // Cross-origin isn't required (Esri sends * ACAO), but setting it
      // explicitly stops Leaflet from tainting the canvas when a clerk
      // takes a print export.
      crossOrigin: true,
    });
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map]);
  return null;
}
