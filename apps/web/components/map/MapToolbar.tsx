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

const BASEMAP_PILLS: ReadonlyArray<readonly [BasemapKey, string]> = [
  ["hybrid", "Hybrid"],
  ["satellite", "Satellite"],
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
