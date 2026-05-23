"use client";

/**
 * BasemapLayer — renders the right TileLayer (or stack) for the active basemap.
 *
 * Single responsibility: given a {@link BasemapKey}, mount the corresponding
 * Leaflet tile layer(s). All tile URLs and attributions live in `./types` so
 * the registry is a single source of truth.
 *
 * The component is stateless — switching basemap is the parent's job.
 *
 * Notes:
 *   - "hybrid" stacks World_Imagery + a transparent labels reference layer.
 *   - "slip-aerial" only renders when the SLIP probe succeeded.
 *   - `maxNativeZoom` on the Esri imagery tiles forces Leaflet to upsample
 *     the deepest available tile, instead of showing Esri's "Map data not
 *     yet available" placeholder for remote WA at high zoom.
 */

import { TileLayer } from "react-leaflet";
import {
  type BasemapKey,
  type SlipAerialProbeResult,
  ESRI_IMAGERY,
  ESRI_REF,
  ESRI_TOPO,
  CARTO_LIGHT,
  SENTINEL_BASE,
  SENTINEL_ATTR,
  SENTINEL_LATEST,
  SENTINEL_LATEST_ATTR,
  SENTINEL_LATEST_MAX_NATIVE,
  ESRI_ATTR,
  CARTO_ATTR,
  ESRI_IMAGERY_MAX_NATIVE,
  ESRI_IMAGERY_MAX_DISPLAY,
} from "./types";

export type BasemapLayerProps = {
  /** The currently selected basemap. */
  basemap: BasemapKey;
  /** Result of the SLIP probe — required to render "slip-aerial". */
  slipProbe: SlipAerialProbeResult | null;
};

export default function BasemapLayer({
  basemap,
  slipProbe,
}: BasemapLayerProps): JSX.Element | null {
  if (basemap === "hybrid") {
    return (
      <>
        <TileLayer
          key="hybrid-base"
          url={ESRI_IMAGERY}
          attribution={ESRI_ATTR}
          maxNativeZoom={ESRI_IMAGERY_MAX_NATIVE}
          maxZoom={ESRI_IMAGERY_MAX_DISPLAY}
        />
        <TileLayer
          key="hybrid-ref"
          url={ESRI_REF}
          attribution=""
          maxNativeZoom={ESRI_IMAGERY_MAX_NATIVE}
          maxZoom={ESRI_IMAGERY_MAX_DISPLAY}
          opacity={0.85}
        />
      </>
    );
  }
  if (basemap === "satellite") {
    return (
      <TileLayer
        key="sat"
        url={ESRI_IMAGERY}
        attribution={ESRI_ATTR}
        maxNativeZoom={ESRI_IMAGERY_MAX_NATIVE}
        maxZoom={ESRI_IMAGERY_MAX_DISPLAY}
      />
    );
  }
  if (basemap === "sentinel") {
    // Sentinel-2 cloudless mosaic — 10m/pixel, global, always available.
    // Lower resolution than Esri at zoom 18 but never shows the
    // "Map data not yet available" placeholder.
    return (
      <TileLayer
        key="sentinel"
        url={SENTINEL_BASE}
        attribution={SENTINEL_ATTR}
        maxNativeZoom={14}
        maxZoom={ESRI_IMAGERY_MAX_DISPLAY}
      />
    );
  }
  if (basemap === "sentinel-latest") {
    // Sentinel-2 L2A latest acquisition — rolling-latest cloud-free scene
    // served by Esri Living Atlas. Same underlying ESA Sentinel-2 sensor
    // as `sentinel` but typically <14 days old instead of a yearly
    // composite. This is the "imagery currency" lever: clerks see what's
    // on the ground RIGHT NOW, not 12-18 months ago.
    return (
      <TileLayer
        key="sentinel-latest"
        url={SENTINEL_LATEST}
        attribution={SENTINEL_LATEST_ATTR}
        maxNativeZoom={SENTINEL_LATEST_MAX_NATIVE}
        maxZoom={ESRI_IMAGERY_MAX_DISPLAY}
      />
    );
  }
  if (basemap === "street") {
    return (
      <TileLayer
        key="street"
        url={CARTO_LIGHT}
        attribution={CARTO_ATTR}
        maxZoom={19}
      />
    );
  }
  if (basemap === "topo") {
    return (
      <TileLayer
        key="topo"
        url={ESRI_TOPO}
        attribution={ESRI_ATTR}
        maxZoom={19}
      />
    );
  }
  if (basemap === "slip-aerial" && slipProbe && slipProbe.ok) {
    return (
      <TileLayer
        key="slip"
        url={slipProbe.tileUrl}
        attribution="© Landgate SLIP (WA)"
        maxZoom={19}
      />
    );
  }
  return null;
}
