"use client";

/**
 * MapChrome — the static, presentational decorations layered over the map.
 *
 * Single responsibility: render the north arrow, legend, and print watermark.
 * Stateless — the parent decides what's shown via props.
 *
 * The overlap tooltip was moved to PolygonLayers (fires on hover, not page-load).
 *
 * Pulled out of the orchestrator so PropertyMap stays close to pure
 * composition.
 */

import { Compass } from "lucide-react";

export type MapChromeProps = {
  /** True if the stats card is currently open — shifts the north arrow left. */
  statsOpen: boolean;
  /** When true, show the bottom "confidential" print watermark. */
  isPrint: boolean;
};

export default function MapChrome({
  statsOpen,
  isPrint,
}: MapChromeProps): JSX.Element {
  return (
    <>
      {/* North arrow (top-right, above stats card) */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: statsOpen ? 308 : 64,
          zIndex: 1000,
          background: "rgba(255,255,255,0.92)",
          borderRadius: "50%",
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
          transition: "right 0.15s",
        }}
        title="North"
      >
        <Compass size={22} color="#1a52d4" />
      </div>

      {/* Overlap badge removed — tooltip now lives on the overlap polygon in
          PolygonLayers.tsx and fires on hover only (not page-load). */}

      {/* Legend (bottom-left, above scale) */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          left: 12,
          zIndex: 1000,
          background: "rgba(255,255,255,0.94)",
          padding: "8px 10px",
          borderRadius: 6,
          fontSize: 11,
          boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
          color: "#1f2937",
        }}
      >
        <LegendRow swatch="#dc2626" dashed label="Parcel boundary (rated parcel)" />
        <LegendRow swatch="#f59e0b" label="Mining tenement (DMIRS)" />
        <LegendRow
          swatch="#facc15"
          label="Overlap area (reclassification candidate)"
        />
      </div>

      {/* Print watermark */}
      {isPrint && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: "rgba(15, 23, 42, 0.85)",
            color: "#fff",
            textAlign: "center",
            padding: "6px 0",
            fontSize: 11,
            letterSpacing: 1,
            zIndex: 1000,
          }}
        >
          RatesAssist — Confidential, decision-support only
        </div>
      )}

      {/* Animated dashed parcel stroke + measure tooltip styles. Kept inline
          so the component is self-contained — no global stylesheet edit
          required. */}
      <style>{`
        @keyframes ratesassistDash {
          to { stroke-dashoffset: -28; }
        }
        .ratesassist-parcel-stroke {
          animation: ratesassistDash 1.6s linear infinite;
        }
        .ratesassist-measure-tip {
          background: rgba(8, 47, 73, 0.92);
          color: #fff;
          border: none;
          border-radius: 4px;
          padding: 4px 8px;
          font: 600 11px/1.2 ui-sans-serif, system-ui;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        }
        .ratesassist-measure-tip:before { display: none; }
      `}</style>
    </>
  );
}

function LegendRow({
  swatch,
  label,
  dashed,
}: {
  swatch: string;
  label: string;
  dashed?: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "1px 0",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 14,
          height: 8,
          background: swatch,
          opacity: 0.65,
          border: `2px ${dashed ? "dashed" : "solid"} ${swatch}`,
          borderRadius: 2,
        }}
      />
      <span>{label}</span>
    </div>
  );
}
