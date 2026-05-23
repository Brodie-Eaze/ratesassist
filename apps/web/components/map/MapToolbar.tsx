"use client";

/**
 * MapToolbar — basemap toggle pills + zoom-to-parcel/tenement + measure + print.
 *
 * Single responsibility: render the top-left control stack and emit user
 * intent back to the parent via the supplied callbacks. Stateless — the
 * parent owns every piece of state this surface reflects.
 */

import { Ruler, Printer } from "lucide-react";
import type { BasemapKey, SlipAerialProbeResult, ZoomTarget } from "./types";

export type MapToolbarProps = {
  /** The currently active basemap. */
  activeBasemap: BasemapKey;
  /** Called when the user picks a new basemap. */
  onBasemapChange: (key: BasemapKey) => void;
  /** SLIP probe — used to decide whether to show the SLIP Aerial pill. */
  slipProbe: SlipAerialProbeResult | null;

  /** The currently active zoom target. */
  zoomTarget: ZoomTarget;
  /** Called when the user picks a new zoom target. */
  onZoomTargetChange: (target: ZoomTarget) => void;

  /** True if a parcel polygon is loaded — disables the parcel zoom button when false. */
  hasParcel: boolean;
  /** True if a tenement polygon is loaded — disables the tenement zoom button when false. */
  hasTenement: boolean;

  /** Whether the measure tool is on. */
  measureOn: boolean;
  /** Called when the user toggles the measure tool. */
  onMeasureToggle: () => void;

  /** Called when the user wants the print view. */
  onPrint: () => void;
};

const pillRowStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.95)",
  borderRadius: 6,
  padding: 2,
  display: "flex",
  gap: 2,
  boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
};

function pillButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    background: active ? "#1a52d4" : "transparent",
    color: active ? "white" : "#374151",
    fontWeight: active ? 600 : 500,
    fontSize: 12,
    fontFamily: "inherit",
  };
}

/**
 * Basemap pill registry — ordered for the toolbar.
 *
 * "Sentinel‑2 Live" (key: `sentinel-latest`) is the freshest publicly-
 * available layer: rolling latest cloud-free Sentinel-2 scene served by
 * Esri Living Atlas, typically <14 days old. It sits next to the older
 * "Sentinel‑2" yearly composite so clerks can flip between "what's on
 * the ground RIGHT NOW" and "the stable annual baseline" — the
 * difference between the two is where the audit signal lives.
 *
 * The static composite is kept (rather than dropped) because cloud-cover
 * gaps still happen during the Pilbara wet season — clerks need the
 * yearly cloudless mosaic as a fallback.
 */
const BASEMAP_PILLS: ReadonlyArray<readonly [BasemapKey, string]> = [
  ["hybrid", "Hybrid"],
  ["satellite", "Satellite"],
  ["sentinel-latest", "Sentinel‑2 Live"],
  ["sentinel", "Sentinel‑2"],
  ["street", "Street"],
  ["topo", "Topo"],
];

export default function MapToolbar({
  activeBasemap,
  onBasemapChange,
  slipProbe,
  zoomTarget,
  onZoomTargetChange,
  hasParcel,
  hasTenement,
  measureOn,
  onMeasureToggle,
  onPrint,
}: MapToolbarProps): JSX.Element {
  const slipAvailable = Boolean(slipProbe && slipProbe.ok);
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {/* Basemap pills */}
      <div style={pillRowStyle}>
        {BASEMAP_PILLS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onBasemapChange(key)}
            style={pillButtonStyle(activeBasemap === key)}
          >
            {label}
          </button>
        ))}
        {slipAvailable && (
          <button
            type="button"
            onClick={() => onBasemapChange("slip-aerial")}
            style={pillButtonStyle(activeBasemap === "slip-aerial")}
          >
            SLIP Aerial
          </button>
        )}
      </div>

      {/* Imagery currency badge — surfaces the freshness of the active
          basemap so council clerks understand whether what they're
          looking at is days-old or 1+ year old. */}
      <ImageryCurrencyBadge basemap={activeBasemap} slipProbe={slipProbe} />

      {/* Zoom-to-detail buttons */}
      <div style={pillRowStyle}>
        <button
          type="button"
          onClick={() => onZoomTargetChange("parcel")}
          style={pillButtonStyle(zoomTarget === "parcel")}
          disabled={!hasParcel}
          title="Zoom to parcel boundary"
        >
          Zoom to parcel
        </button>
        <button
          type="button"
          onClick={() => onZoomTargetChange("tenement")}
          style={pillButtonStyle(zoomTarget === "tenement")}
          disabled={!hasTenement}
          title="Zoom to tenement boundary"
        >
          Zoom to tenement
        </button>
      </div>

      {/* Measure + print */}
      <div style={pillRowStyle}>
        <button
          type="button"
          onClick={onMeasureToggle}
          style={pillButtonStyle(measureOn)}
          title="Click to measure distance (2 clicks) or area (3+ clicks). Double-click to clear."
        >
          <Ruler className="inline w-3 h-3 mr-1" />
          {measureOn ? "Measuring" : "Measure"}
        </button>
        <button
          type="button"
          onClick={onPrint}
          style={pillButtonStyle(false)}
          title="Open print view"
        >
          <Printer className="inline w-3 h-3 mr-1" />
          Print view
        </button>
      </div>
    </div>
  );
}

/**
 * Static freshness metadata per basemap.
 *
 * The labels here are deliberately conservative — they describe the
 * SOURCE'S typical refresh cadence, not a guarantee that the very tile
 * a clerk is looking at was acquired on a given date. For the "Sentinel-2
 * Live" layer, the Esri Living Atlas service rolls in the freshest
 * cloud-free Sentinel-2 L2A scene per area, which is usually <14 days
 * old in WA (Sentinel-2 has a 5-day revisit cycle and Esri rejects
 * scenes >60% cloud cover).
 *
 * When the daily Planet PlanetScope pipeline lands (see
 * internal/IMAGERY-CADENCE-PLAN.md), a new "planet-daily" basemap entry
 * will be added with `freshness: "daily, 3m"`.
 */
const BASEMAP_FRESHNESS: Record<
  BasemapKey,
  { readonly label: string; readonly tone: "live" | "recent" | "static" }
> = {
  "sentinel-latest": { label: "~14-day cadence · 10m", tone: "live" },
  "slip-aerial":     { label: "WA Landgate · ~6-12mo cadence · 7.5cm", tone: "recent" },
  hybrid:            { label: "Esri composite · 1-3yr old", tone: "static" },
  satellite:         { label: "Esri composite · 1-3yr old", tone: "static" },
  sentinel:          { label: "2024 yearly composite", tone: "static" },
  street:            { label: "Carto OSM basemap", tone: "static" },
  topo:              { label: "Esri topo basemap", tone: "static" },
};

const FRESHNESS_TONE_STYLE: Record<
  "live" | "recent" | "static",
  React.CSSProperties
> = {
  live: {
    background: "rgba(16, 122, 87, 0.95)", // success-700-ish, high-contrast
    color: "white",
  },
  recent: {
    background: "rgba(180, 83, 9, 0.95)", // warn-700
    color: "white",
  },
  static: {
    background: "rgba(55, 65, 81, 0.92)", // ink-700
    color: "white",
  },
};

function ImageryCurrencyBadge({
  basemap,
  slipProbe,
}: {
  basemap: BasemapKey;
  slipProbe: SlipAerialProbeResult | null;
}): JSX.Element | null {
  // Hide the badge for SLIP-aerial when the probe failed — the basemap
  // isn't actually rendering anything so labelling it would be confusing.
  if (basemap === "slip-aerial" && !(slipProbe && slipProbe.ok)) {
    return null;
  }
  const meta = BASEMAP_FRESHNESS[basemap];
  if (!meta) return null;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "flex-start",
        padding: "3px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: 0.2,
        boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
        ...FRESHNESS_TONE_STYLE[meta.tone],
      }}
      title={
        meta.tone === "live"
          ? "Rolling latest cloud-free Sentinel-2 acquisition — typically within the last fortnight."
          : meta.tone === "recent"
            ? "Landgate aerial captures refresh on a 6-12 month cycle (metro faster than remote)."
            : "Static composite — useful as a reference but not for change detection."
      }
    >
      Imagery currency: {meta.label}
    </div>
  );
}
