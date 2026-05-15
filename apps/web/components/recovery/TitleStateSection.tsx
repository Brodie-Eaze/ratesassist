"use client";

/**
 * TitleStateSection — Section 8 of the evidence pack rendered as a
 * dedicated React block (instead of the markdown variant) so multi-PIN
 * status colour-coding can be conveyed via classNames rather than monospace
 * table chrome.
 *
 * Renders:
 *  - CT volume / folio / issued date
 *  - Registered proprietor (Landgate)
 *  - Per-PIN table with status column colour-coded green (OK) / amber
 *    (MISMATCH)
 *  - Encumbrances list
 *  - Strata-parent block (with cross-links to each child via
 *    `/recovery/<childCT>`)
 *
 * Source-freshness label is shown at the top of the section so the clerk
 * knows how trustworthy the data is.
 */

import Link from "next/link";
import type {
  Encumbrance,
  Pin,
  StrataChild,
  TitleSourceFreshness,
} from "@ratesassist/contract";

export type TitleStateSectionProps = {
  readonly ctVolume: string | undefined;
  readonly ctFolio: string | undefined;
  readonly ctIssuedDate: string | undefined;
  readonly proprietor: string | undefined;
  readonly proprietorPostalAddress: string | undefined;
  readonly pins: ReadonlyArray<Pin>;
  readonly encumbrances: ReadonlyArray<Encumbrance>;
  readonly strataParentCt:
    | { readonly volume: string; readonly folio: string }
    | undefined;
  readonly strataChildren: ReadonlyArray<StrataChild>;
  readonly source: TitleSourceFreshness | undefined;
  /**
   * The council's rate-code label (used to compare against per-PIN Landgate
   * landuse codes for the colour-coded status column).
   */
  readonly councilLandUse: string;
};

/**
 * Human-readable source label. Mirrors the markdown renderer in the engine
 * so both surfaces agree on what "fresh" means.
 */
function sourceFreshnessLine(src: TitleSourceFreshness | undefined): string {
  if (!src) {
    return "No source freshness on file — verify against current source before lodging.";
  }
  const base = `Source: ${src.source} · retrieved ${src.retrievedAt}`;
  return src.lagWarning ? `${base} · caveat: ${src.lagWarning}` : base;
}

export function TitleStateSection(props: TitleStateSectionProps): JSX.Element {
  const {
    ctVolume,
    ctFolio,
    ctIssuedDate,
    proprietor,
    proprietorPostalAddress,
    pins,
    encumbrances,
    strataParentCt,
    strataChildren,
    source,
    councilLandUse,
  } = props;

  return (
    <section
      aria-labelledby="title-state-heading"
      className="card p-5 mb-4"
      data-testid="title-state-section"
    >
      <h2
        id="title-state-heading"
        className="text-base font-semibold text-ink-900 mb-2"
      >
        Section 8 — Title state
      </h2>
      <p className="text-xs text-ink-500 mb-4" data-testid="title-source-freshness">
        {sourceFreshnessLine(source)}
      </p>

      {(ctVolume || ctFolio || ctIssuedDate) && (
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <div className="label">CT volume</div>
            <div className="text-sm text-ink-900">{ctVolume ?? "—"}</div>
          </div>
          <div>
            <div className="label">CT folio</div>
            <div className="text-sm text-ink-900">{ctFolio ?? "—"}</div>
          </div>
          <div>
            <div className="label">CT issued</div>
            <div className="text-sm text-ink-900">{ctIssuedDate ?? "—"}</div>
          </div>
        </div>
      )}

      {(proprietor || proprietorPostalAddress) && (
        <div className="mb-4">
          <div className="label">Registered proprietor (Landgate)</div>
          <div className="text-sm text-ink-900">{proprietor ?? "—"}</div>
          {proprietorPostalAddress && (
            <div className="text-xs text-ink-600 mt-0.5">
              {proprietorPostalAddress}
            </div>
          )}
        </div>
      )}

      {pins.length > 0 && (
        <div className="mb-4" data-testid="pin-table-wrapper">
          <div className="label mb-1">PINs on this VEN ({pins.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse" data-testid="pin-table">
              <thead>
                <tr className="bg-ink-50 text-ink-700">
                  <th className="border border-ink-200 px-2 py-1 text-left font-medium">
                    PIN
                  </th>
                  <th className="border border-ink-200 px-2 py-1 text-left font-medium">
                    Lot / Plan
                  </th>
                  <th className="border border-ink-200 px-2 py-1 text-left font-medium">
                    Council landuse
                  </th>
                  <th className="border border-ink-200 px-2 py-1 text-left font-medium">
                    Landgate landuse
                  </th>
                  <th className="border border-ink-200 px-2 py-1 text-right font-medium">
                    Area m²
                  </th>
                  <th className="border border-ink-200 px-2 py-1 text-left font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {pins.map((pin) => {
                  const matches =
                    pin.landuseCode.toLowerCase() ===
                    councilLandUse.toLowerCase();
                  return (
                    <tr key={pin.pin} data-pin-status={matches ? "ok" : "mismatch"}>
                      <td className="border border-ink-200 px-2 py-1 font-mono">
                        {pin.pin}
                      </td>
                      <td className="border border-ink-200 px-2 py-1">
                        {pin.lotPlan}
                      </td>
                      <td className="border border-ink-200 px-2 py-1">
                        {councilLandUse}
                      </td>
                      <td className="border border-ink-200 px-2 py-1">
                        {pin.landuseCode}
                      </td>
                      <td className="border border-ink-200 px-2 py-1 text-right tabular-nums">
                        {pin.areaSquareMetres.toLocaleString("en-AU")}
                      </td>
                      <td
                        className={`border border-ink-200 px-2 py-1 font-medium ${
                          matches
                            ? "bg-success-50 text-success-700"
                            : "bg-warn-50 text-warn-700"
                        }`}
                      >
                        {matches ? "OK" : "MISMATCH"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-4" data-testid="encumbrance-block">
        <div className="label mb-1">Registered encumbrances</div>
        {encumbrances.length === 0 ? (
          <p className="text-xs text-ink-500">
            No registered encumbrances on this title.
          </p>
        ) : (
          <ul className="text-sm text-ink-800 space-y-1">
            {encumbrances.map((e, ix) => (
              <li key={`${e.type}-${e.reference}-${ix}`}>
                <span className="font-medium text-ink-900">{e.type}</span>{" "}
                — reference{" "}
                <code className="text-xs text-accent-700 bg-ink-100 px-1 py-0.5 rounded">
                  {e.reference}
                </code>{" "}
                <span className="text-xs text-ink-500">
                  (registered {e.date}; source {e.source})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(strataParentCt || strataChildren.length > 0) && (
        <div data-testid="strata-block">
          <div className="label mb-1">Strata structure</div>
          {strataParentCt && (
            <p className="text-sm text-ink-800">
              Strata parent CT: Volume {strataParentCt.volume} Folio{" "}
              {strataParentCt.folio}
            </p>
          )}
          {strataChildren.length > 0 && (
            <>
              <p className="text-sm text-ink-800 mt-1">
                Strata children ({strataChildren.length}):
              </p>
              <ul className="text-sm text-ink-800 ml-4 list-disc">
                {strataChildren.map((c) => (
                  <li key={`${c.volume}-${c.folio}`}>
                    <Link
                      href={`/recovery/${encodeURIComponent(`${c.volume}-${c.folio}`)}`}
                      className="text-accent-700 hover:underline"
                    >
                      Volume {c.volume} Folio {c.folio}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default TitleStateSection;
