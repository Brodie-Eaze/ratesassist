"use client";

/**
 * Affected-parcels table for /alerts/[tenementId].
 *
 * Extracted to keep the page entry-point thin. Renders the cadastre
 * intersection between a granted tenement and council-rated parcels,
 * with severity-coloured uplift estimates and parcel-row highlighting
 * driven by the parent map's selection state.
 */

import Link from "next/link";
import { formatAud } from "@/lib/utils";

export type IntersectingParcel = {
  assessmentNumber: string;
  address: string;
  landUse: string;
  valuation: number;
  annualRates: number;
  estimatedUpliftSeverity: "high" | "medium" | "low";
  estimatedUpliftAmount: number;
};

export type IntersectionTableProps = {
  parcels: ReadonlyArray<IntersectingParcel>;
  cadastreSource: "live" | "seeded";
  highlightedAssessment: string | null;
};

export function IntersectionTable({
  parcels,
  cadastreSource,
  highlightedAssessment,
}: IntersectionTableProps) {
  return (
    <div className="lg:col-span-2 card overflow-hidden">
      <div className="px-5 py-3 border-b border-ink-200 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-ink-900">
            Affected parcels
          </div>
          <div className="text-xs text-ink-500">
            {cadastreSource === "live"
              ? "Live cadastre intersection (Landgate)."
              : "Synthetic intersection — demo data only. Real cadastre joins land in Phase 2."}
          </div>
        </div>
        <span className="text-[11px] uppercase tracking-widest text-ink-400">
          cadastre: {cadastreSource}
        </span>
      </div>

      {parcels.length === 0 ? (
        <div className="p-6 text-sm text-ink-600">
          No council-registered parcels intersect this tenement geometry. The
          tenement may sit over Crown land, pastoral lease, or unrated parcels.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium text-ink-700">Assessment</th>
              <th className="px-4 py-2 font-medium text-ink-700">Address</th>
              <th className="px-4 py-2 font-medium text-ink-700">Land use</th>
              <th className="px-4 py-2 font-medium text-ink-700 text-right">
                Valuation
              </th>
              <th className="px-4 py-2 font-medium text-ink-700 text-right">
                Annual rates
              </th>
              <th className="px-4 py-2 font-medium text-ink-700 text-right">
                Estimated uplift
              </th>
            </tr>
          </thead>
          <tbody>
            {parcels.map((p) => (
              <tr
                key={p.assessmentNumber}
                className={`border-t border-ink-200 ${
                  highlightedAssessment === p.assessmentNumber
                    ? "bg-accent-50"
                    : "hover:bg-ink-50"
                }`}
              >
                <td className="px-4 py-2">
                  <Link
                    href={`/properties?assessment=${p.assessmentNumber}`}
                    className="font-mono text-accent-700 hover:underline"
                  >
                    {p.assessmentNumber}
                  </Link>
                </td>
                <td className="px-4 py-2 text-ink-700">{p.address}</td>
                <td className="px-4 py-2">
                  <span className="badge badge-neutral">{p.landUse}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-700">
                  {formatAud(p.valuation)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-700">
                  {formatAud(p.annualRates)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  <span
                    className={
                      p.estimatedUpliftSeverity === "high"
                        ? "text-critical-700 font-medium"
                        : p.estimatedUpliftSeverity === "medium"
                          ? "text-warn-700 font-medium"
                          : "text-ink-600"
                    }
                  >
                    +{formatAud(p.estimatedUpliftAmount)}/yr
                  </span>
                  <div className="text-[10px] uppercase tracking-widest text-ink-400">
                    {p.estimatedUpliftSeverity}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default IntersectionTable;
