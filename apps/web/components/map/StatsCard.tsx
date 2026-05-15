"use client";

/**
 * StatsCard — collapsible top-right card with assessment / valuation / uplift.
 *
 * Single responsibility: render the property snapshot. Stateless apart from
 * the open/closed UI state, which the parent owns and pipes in via props.
 *
 * Also surfaces the cadastre-source label (LIVE / Provided / Synthetic) and
 * the overlap stats badge inside the card body when an overlap is available.
 */

import { ChevronDown, ChevronUp } from "lucide-react";
import { m2ToHa } from "@/lib/polygonClip";
import type {
  CadastreSource,
  OverlapStats,
  PropertyMapStats,
} from "./types";

export type StatsCardProps = {
  /** Whether the card is currently expanded. */
  open: boolean;
  /** Toggles the open/closed state. */
  onToggle: () => void;
  /** Stats payload — every field is optional. */
  stats: PropertyMapStats | undefined;
  /** Where the parcel polygon came from. */
  cadastreSource: CadastreSource;
  /** Pre-computed overlap stats, if any. */
  overlap: OverlapStats | null;
  /** Optional "open evidence pack" link. */
  evidenceHref?: string;
};

function formatAud(n: number | undefined): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

function landUseColour(landUse: string): { bg: string; fg: string } {
  const u = landUse.toLowerCase();
  if (u.includes("rural")) return { bg: "#dcfce7", fg: "#166534" };
  if (u.includes("vacant")) return { bg: "#fef3c7", fg: "#92400e" };
  if (u.includes("commercial") || u.includes("industrial"))
    return { bg: "#dbeafe", fg: "#1e40af" };
  if (u.includes("residential")) return { bg: "#ede9fe", fg: "#5b21b6" };
  return { bg: "#f3f4f6", fg: "#374151" };
}

function Row({
  k,
  v,
}: {
  k: string;
  v: React.ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "3px 0",
        borderTop: "1px solid #f3f4f6",
      }}
    >
      <span style={{ color: "#6b7280", fontSize: 11 }}>{k}</span>
      <span style={{ fontSize: 12 }}>{v}</span>
    </div>
  );
}

export default function StatsCard({
  open,
  onToggle,
  stats,
  cadastreSource,
  overlap,
  evidenceHref,
}: StatsCardProps): JSX.Element {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 1000,
        width: open ? 288 : 44,
        background: "rgba(255,255,255,0.96)",
        borderRadius: 8,
        boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
        fontSize: 12,
        overflow: "hidden",
        transition: "width 0.15s",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={open ? "Collapse property snapshot" : "Expand property snapshot"}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontWeight: 600,
          color: "#1f2937",
        }}
      >
        {open ? <span>Property snapshot</span> : <span>›</span>}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div style={{ padding: "0 12px 12px 12px", color: "#374151" }}>
          {stats?.assessmentNumber && (
            <div
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 13,
                color: "#1f2937",
              }}
            >
              {stats.assessmentNumber}
            </div>
          )}
          {stats?.address && (
            <div
              style={{
                fontSize: 11,
                color: "#6b7280",
                marginBottom: 4,
              }}
            >
              {stats.address}
            </div>
          )}
          {stats?.landUse && (
            <span
              style={{
                display: "inline-block",
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 1,
                padding: "2px 6px",
                borderRadius: 3,
                background: landUseColour(stats.landUse).bg,
                color: landUseColour(stats.landUse).fg,
                marginBottom: 8,
              }}
            >
              {stats.landUse}
            </span>
          )}
          {stats?.valuation != null && (
            <Row k="Valuation" v={formatAud(stats.valuation)} />
          )}
          {(stats?.currentAnnualRates != null ||
            stats?.projectedAnnualRates != null) && (
            <Row
              k="Annual rates"
              v={
                <span>
                  {formatAud(stats?.currentAnnualRates)}
                  {" → "}
                  <strong>{formatAud(stats?.projectedAnnualRates)}</strong>
                </span>
              }
            />
          )}
          {stats?.estimatedUplift != null && (
            <Row
              k="Estimated uplift"
              v={
                <strong style={{ color: "#059669" }}>
                  +{formatAud(stats.estimatedUplift)}/yr
                </strong>
              }
            />
          )}
          {overlap && (
            <Row
              k={
                overlap.method === "bbox_fallback"
                  ? "Overlap (approximate)"
                  : "Tenement coverage"
              }
              v={
                <span>
                  {m2ToHa(overlap.areaM2).toFixed(2)} ha (
                  {overlap.percentOfParcel.toFixed(0)}% of parcel)
                </span>
              }
            />
          )}
          <Row
            k="Cadastre source"
            v={
              <span
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color:
                    cadastreSource === "live" ? "#059669" : "#b45309",
                }}
              >
                {cadastreSource === "live"
                  ? "LIVE (Landgate SLIP)"
                  : cadastreSource === "prop"
                    ? "Provided"
                    : "Synthetic (real cadastre unavailable)"}
              </span>
            }
          />
          {evidenceHref && (
            <a
              href={evidenceHref}
              style={{
                display: "block",
                marginTop: 10,
                padding: "6px 8px",
                textAlign: "center",
                background: "#1a52d4",
                color: "white",
                borderRadius: 4,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Click to open evidence pack →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
