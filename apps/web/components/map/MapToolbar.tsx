"use client";

/**
 * MapToolbar — basemap toggle pills + zoom-to-parcel/tenement + measure + print.
 *
 * Single responsibility: render the top-left control stack and emit user
 * intent back to the parent via the supplied callbacks. Stateless — the
 * parent owns every piece of state this surface reflects.
 */

import { useEffect, useState } from "react";
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
 * Labels describe the source's typical refresh cadence as a fallback.
 * For `sentinel-latest`, the `ImageryCurrencyBadge` fetches the ACTUAL
 * acquisition date from `/api/imagery/sentinel-freshness` (a server-side
 * Esri ImageServer probe) and replaces this label with a real date string
 * ("Acquired yesterday · 10m · 0.4% cloud"). The static label is the
 * graceful fallback when the probe is unavailable or loading.
 *
 * When the daily Planet PlanetScope pipeline lands (see
 * internal/IMAGERY-CADENCE-PLAN.md), a "planet-daily" entry will be added
 * with `freshness: "daily, 3m"`.
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

/**
 * Build the human-readable label for the Sentinel-2 Live badge given the
 * real acquisition data returned by `/api/imagery/sentinel-freshness`.
 *
 * Examples:
 *   daysAgo 0  → "Acquired today · 10m · 0.4% cloud"
 *   daysAgo 1  → "Acquired yesterday · 10m"
 *   daysAgo 5  → "Acquired 5 days ago · 10m · 12.0% cloud"
 *   null input → fallback static label ("~14-day cadence · 10m")
 */
function sentinelLiveLabel(
  freshness: { daysAgo: number; cloudCoverPercent: number | null } | null,
): string {
  if (!freshness) return BASEMAP_FRESHNESS["sentinel-latest"].label;
  const { daysAgo, cloudCoverPercent } = freshness;
  let dateStr: string;
  if (daysAgo === 0) dateStr = "Acquired today";
  else if (daysAgo === 1) dateStr = "Acquired yesterday";
  else dateStr = `Acquired ${daysAgo} days ago`;
  const ccStr =
    cloudCoverPercent !== null ? ` · ${cloudCoverPercent}% cloud` : "";
  return `${dateStr} · 10m${ccStr}`;
}

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
  // Listen for tile-error events from Sentinel2LiveLayer. When Esri's
  // exportImage endpoint fails, the layer fires `ratesassist:imagery_degraded`
  // on window and we flip the badge from "live" (green) to "recent" (amber)
  // so the officer sees the degradation at a glance.
  const [degraded, setDegraded] = useState(false);
  useEffect(() => {
    const handler = (): void => setDegraded(true);
    window.addEventListener("ratesassist:imagery_degraded", handler);
    return () => window.removeEventListener("ratesassist:imagery_degraded", handler);
  }, []);

  // Fetch the REAL Sentinel-2 acquisition date from the server-side Esri
  // ImageServer probe (cached 1h). On success, the badge shows the actual
  // date ("Acquired yesterday · 10m · 0.4% cloud") instead of the static
  // "~14-day cadence" fallback. On failure, the fallback is used silently.
  const [sentinelFreshness, setSentinelFreshness] = useState<{
    daysAgo: number;
    cloudCoverPercent: number | null;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch("/api/imagery/sentinel-freshness")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => {
        if (!alive) return;
        if (
          d !== null &&
          typeof d === "object" &&
          (d as { ok?: unknown }).ok === true
        ) {
          const payload = (d as { data?: { daysAgo?: unknown; cloudCoverPercent?: unknown } }).data;
          if (
            payload !== undefined &&
            typeof payload.daysAgo === "number"
          ) {
            setSentinelFreshness({
              daysAgo: payload.daysAgo,
              cloudCoverPercent:
                typeof payload.cloudCoverPercent === "number"
                  ? payload.cloudCoverPercent
                  : null,
            });
          }
        }
      })
      .catch((): void => {
        /* fallback to static label — probe failure is non-critical */
      });
    return (): void => {
      alive = false;
    };
  }, []);

  // Hide the badge for SLIP-aerial when the probe failed — the basemap
  // isn't actually rendering anything so labelling it would be confusing.
  if (basemap === "slip-aerial" && !(slipProbe && slipProbe.ok)) {
    return null;
  }
  const meta = BASEMAP_FRESHNESS[basemap];
  if (!meta) return null;

  // For sentinel-latest, use the real acquisition date when available.
  const displayLabel =
    basemap === "sentinel-latest" && !degraded
      ? sentinelLiveLabel(sentinelFreshness)
      : meta.label;

  // Override the tone to "recent" (amber) when degraded — keeps the label
  // text so the officer can still see the source, but the amber colour
  // signals that the tiles may be stale or partial.
  const effectiveTone = (degraded && meta.tone === "live") ? "recent" : meta.tone;

  const titleText = (() => {
    if (degraded && meta.tone === "live") {
      return "Sentinel-2 imagery may be degraded — one or more tiles failed to load (Esri upstream issue).";
    }
    if (effectiveTone === "live") {
      return sentinelFreshness !== null
        ? `Most recent cloud-free Sentinel-2 scene over WA — acquired ${
            sentinelFreshness.daysAgo === 0
              ? "today"
              : sentinelFreshness.daysAgo === 1
                ? "yesterday"
                : `${sentinelFreshness.daysAgo} days ago`
          }${
            sentinelFreshness.cloudCoverPercent !== null
              ? ` with ${sentinelFreshness.cloudCoverPercent}% cloud cover`
              : ""
          }. 10 m/pixel (ESA Sentinel-2 L2A).`
        : "Rolling latest cloud-free Sentinel-2 acquisition — typically within the last fortnight.";
    }
    if (effectiveTone === "recent") {
      return "Landgate aerial captures refresh on a 6-12 month cycle (metro faster than remote).";
    }
    return "Static composite — useful as a reference but not for change detection.";
  })();

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
        ...FRESHNESS_TONE_STYLE[effectiveTone],
      }}
      title={titleText}
    >
      {degraded && meta.tone === "live" ? "⚠ Imagery degraded — " : "Imagery: "}
      {displayLabel}
    </div>
  );
}
