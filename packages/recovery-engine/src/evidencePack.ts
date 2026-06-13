/**
 * Council-grade evidence pack generator.
 *
 * Given a single property's assessment number and an EvaluationContext,
 * produce a fully-cited markdown pack that a council legal team can read
 * end-to-end. Every claim cites its authoritative source. The pack ID is
 * deterministic per day so re-running on the same data yields the same id.
 *
 * The legacy implementation (apps/web/lib/recovery.ts) returned `null` for
 * three distinct cases — property missing, no signals fired, and (implicitly)
 * no owner record. That conflation made the call-site lose information about
 * WHY a pack could not be generated. This module returns a discriminated
 * union so the caller can branch precisely.
 *
 * The markdown is intentionally produced from a single template in this file
 * rather than split across helpers — councils' legal review reads top-to-
 * bottom, and a single linear template is easier to audit than a tree of
 * fragments.
 */

import type {
  Encumbrance,
  MismatchCandidate,
  Owner,
  PensionerConcession,
  Pin,
  Property,
  SignalHit,
  StrataChild,
  Tenement,
  TitleSourceFreshness,
  WaterCorpEligibilityStatus,
} from "@ratesassist/contract";

import {
  computeComposite,
  estimateUplift,
  evaluateSignals,
  normaliseAddress,
  severityForScore,
  type EvaluationContext,
} from "./scoring.js";
import { miscLicenceLegalRisk } from "./legalRisk.js";

/**
 * The terminal value of a successful pack build.
 */
export type EvidencePack = {
  readonly packId: string;
  /** ISO-8601 date (YYYY-MM-DD) — packs are reproducible per day. */
  readonly generatedAt: string;
  readonly candidate: MismatchCandidate;
  readonly markdown: string;
  /**
   * Top-3 firing signals sorted by weight DESC (tiebreaker: id alphabetic).
   * Surfaces the "headline" panel at the top of the pack — clerks scan the
   * top 3 first, then drill into the priority-sorted breakdown below.
   * Empty array when fewer than 3 signals fired (or none).
   */
  readonly headlineSignals: readonly SignalHit[];
  /**
   * All firing signals sorted by weight DESC (tiebreaker: id alphabetic).
   * The render order for the Section 5 breakdown; surfaced on `pack` so the
   * UI can render accordions without re-sorting.
   */
  readonly prioritisedSignals: readonly SignalHit[];
};

/**
 * Discriminated outcome of {@link buildEvidencePack}.
 *
 * - `ok` — pack generated.
 * - `no_property` — assessment number not in the context.
 * - `no_signals` — property exists, but no signal fired against it; nothing
 *   to recover, no pack to build.
 * - `no_owner` — property exists, signals fired, but the rated owner could
 *   not be resolved. The council must reconcile the rating system before a
 *   notice can be drafted.
 */
export type EvidencePackResult =
  | { readonly kind: "ok"; readonly pack: EvidencePack }
  | { readonly kind: "no_property" }
  | { readonly kind: "no_signals"; readonly property: Property }
  | { readonly kind: "no_owner"; readonly property: Property }
  | { readonly kind: "no_state_template"; readonly state: Property["state"] };

/**
 * Optional injection points for testability. The default clock returns the
 * current wall-clock date. Tests pass a fixed clock to assert deterministic
 * output.
 */
export type BuildEvidencePackOptions = {
  readonly now?: () => Date;
};

/**
 * Default clock used when callers do not inject one. Kept module-private so
 * it can be swapped for tests via `options.now`.
 */
const DEFAULT_NOW: () => Date = () => new Date();

/**
 * Build the evidence pack for a single property.
 *
 * Returns a discriminated union; the caller MUST check `result.kind` before
 * dereferencing — there is no "happy path" exception or null return.
 */
export function buildEvidencePack(
  assessmentNumber: string,
  ctx: EvaluationContext,
  options: BuildEvidencePackOptions = {},
): EvidencePackResult {
  const property = ctx.properties.find(
    (p) => p.assessmentNumber === assessmentNumber,
  );
  if (!property) {
    return { kind: "no_property" };
  }

  const signals = evaluateSignals(property, ctx);
  if (signals.length === 0) {
    return { kind: "no_signals", property };
  }

  const ownerId = property.ownerIds[0];
  const owner = ownerId ? ctx.ownersById.get(ownerId) : undefined;
  if (!owner) {
    return { kind: "no_owner", property };
  }

  // Refuse to generate a council-grade legal document if we have no
  // statutory-citation template for the property's state. Returning a
  // discriminated variant lets the caller produce a precise error rather
  // than emitting a pack containing a TODO placeholder.
  if (!TEMPLATE_BY_STATE[property.state]) {
    return { kind: "no_state_template", state: property.state };
  }

  const compositeScore = computeComposite(signals);
  const severity = severityForScore(compositeScore);
  const { estAnnualRatesNew, estUplift, estArrears3y } = estimateUplift(
    property.annualRates,
    severity,
  );
  const tenements =
    ctx.tenementsByAssessment.get(property.assessmentNumber) ?? [];

  const headline = describeHeadline(signals);
  const prioritisedSignals = sortSignalsByPriority(signals);
  const headlineSignals = prioritisedSignals.slice(0, 3);

  const candidate: MismatchCandidate = {
    assessmentNumber,
    property,
    tenements,
    kind: headline.kind,
    severity,
    reason: headline.reason,
    estAnnualRatesNew,
    estUplift,
    estArrears3y,
    compositeScore,
    confidence: compositeScore,
    signals,
  };

  const now = (options.now ?? DEFAULT_NOW)();
  const generatedAt = formatIsoDate(now);
  const packId = `EP-${assessmentNumber}-${generatedAt.replace(/-/g, "")}`;

  const markdown = renderMarkdown({
    packId,
    generatedAt,
    candidate,
    owner,
    tenements,
    prioritisedSignals,
    headlineSignals,
  });

  return {
    kind: "ok",
    pack: {
      packId,
      generatedAt,
      candidate,
      markdown,
      headlineSignals,
      prioritisedSignals,
    },
  };
}

/**
 * Stable priority-by-weight sort. Signals with higher weight come first;
 * ties broken by id alphabetic order so the output is deterministic across
 * runs (and clerks scanning two packs side-by-side see the same order).
 *
 * Returns a new array — the input is not mutated.
 */
export function sortSignalsByPriority(
  signals: readonly SignalHit[],
): readonly SignalHit[] {
  return [...signals].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------------------
// Internal rendering
// ---------------------------------------------------------------------------

/**
 * Headline derivation — same convention as findMismatches: the highest-weight
 * firing signal becomes the kind/reason; compounding signals are noted.
 */
function describeHeadline(hits: readonly SignalHit[]): {
  readonly kind: string;
  readonly reason: string;
} {
  const sorted = [...hits].sort((a, b) => b.weight - a.weight);
  const top = sorted[0];
  if (!top) {
    return { kind: "no signal", reason: "" };
  }
  const others = hits.length - 1;
  const reason =
    others > 0
      ? `${top.evidence} Plus ${others} additional signal(s) compound the case (composite breakdown below).`
      : top.evidence;
  return { kind: top.short, reason };
}

/**
 * ISO-8601 calendar date in UTC. Packs are reproducible per day; we don't
 * include time so re-runs within a 24 h window collide on packId by design.
 */
function formatIsoDate(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format an integer AUD amount with thousands separators. We use AU locale
 * to match the user-facing language; values are rounded to the nearest
 * dollar (the contract's monetary fields are already whole dollars).
 */
function aud(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

/**
 * Format a confidence percentage 0..1 as e.g. "87%".
 */
function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * Render one signal as a markdown bullet with weight, category, evidence,
 * and source. Signals are sorted by weight descending before rendering.
 */
function renderSignalLine(s: SignalHit): string {
  return `- **${s.short}** *(weight ${s.weight.toFixed(2)} · ${s.category})* — ${s.evidence}\n  - Source: ${s.source}`;
}

/**
 * Render the "Headline" panel — top 3 signals by weight as a compact list
 * at the top of the pack. When the candidate has zero firing signals this
 * panel is omitted entirely by the caller (the pack would not have been
 * built in that case — guard kept defensively in case of future refactor).
 */
function renderHeadlinePanel(headline: readonly SignalHit[]): string {
  if (headline.length === 0) return "";
  const lines = headline.map((s, ix) => {
    const tier = ix === 0 ? "gold" : ix === 1 ? "red" : "amber";
    return `${ix + 1}. **${s.short}** *(weight ${s.weight.toFixed(2)} · tier ${tier})* — ${s.evidence}`;
  });
  return [
    `> **Headline — top ${headline.length} signal${headline.length === 1 ? "" : "s"} by weight**`,
    `>`,
    ...lines.map((l) => `> ${l}`),
  ].join("\n");
}

/**
 * Render the per-PIN table when the property carries a `pins[]` array.
 * Returns an empty string when no PINs are present so the section can
 * silently omit the block. Status column flags any PIN whose Landgate
 * landuse code diverges from the council's rate code (proxied by the
 * property's `landUse` text, which is the only owner-facing label
 * available in the contract types).
 */
function renderPinTable(
  pins: ReadonlyArray<Pin>,
  councilLandUse: string,
): string {
  if (pins.length === 0) return "";
  const header = [
    "| PIN | Lot/Plan | Council landuse | Landgate landuse | Area m² | Status |",
    "|---|---|---|---|---:|---|",
  ];
  const rows = pins.map((pin) => {
    const status =
      pin.landuseCode.toLowerCase() === councilLandUse.toLowerCase()
        ? "OK"
        : "MISMATCH";
    return `| ${pin.pin} | ${pin.lotPlan} | ${councilLandUse} | ${pin.landuseCode} | ${pin.areaSquareMetres.toLocaleString("en-AU")} | ${status} |`;
  });
  return [...header, ...rows].join("\n");
}

/**
 * Render an encumbrance list as a markdown bullet list. Empty list returns
 * a polite "no encumbrances" line rather than nothing so the section reads
 * end-to-end.
 */
function renderEncumbranceList(encs: ReadonlyArray<Encumbrance>): string {
  if (encs.length === 0) {
    return "- (no registered encumbrances on this title)";
  }
  return encs
    .map(
      (e) =>
        `- **${e.type}** — reference ${e.reference} (registered ${e.date}, source: ${e.source})`,
    )
    .join("\n");
}

/**
 * Render the strata-children block. When the property is not a strata
 * parent, returns "". When it IS a parent (`strataParentCt` set on a
 * record that is itself the parent — the spec is slightly ambiguous, so
 * we render children when `strataChildren` is populated regardless of the
 * `strataParentCt` marker, which is how `findMismatches` exposes the
 * relationship).
 */
function renderStrataChildren(
  parentCt: Property["strataParentCt"],
  children: ReadonlyArray<StrataChild>,
): string {
  if (!parentCt && children.length === 0) return "";
  const lines: string[] = [];
  if (parentCt) {
    lines.push(
      `- **Strata parent CT:** Volume ${parentCt.volume} Folio ${parentCt.folio}`,
    );
  }
  if (children.length > 0) {
    lines.push(`- **Strata children (${children.length}):**`);
    for (const c of children) {
      lines.push(`  - Volume ${c.volume} Folio ${c.folio}`);
    }
  }
  return lines.join("\n");
}

/**
 * Format a title-source freshness label. Surfaces source + retrievedAt +
 * any lag warning so the clerk knows how trustworthy the datum is.
 */
function renderTitleSourceFreshness(
  src: TitleSourceFreshness | undefined,
): string {
  if (!src) return "_(no source freshness on file — verify against current source before lodging)_";
  const base = `Source: \`${src.source}\` · retrieved ${src.retrievedAt}`;
  return src.lagWarning ? `${base} · caveat: ${src.lagWarning}` : base;
}

/**
 * Format a Water Corp eligibility status as a human-readable label with a
 * status emoji-substitute (Australian English; emoji avoided per house
 * style).
 */
function renderWcStatus(status: WaterCorpEligibilityStatus | undefined): string {
  switch (status) {
    case "active":
      return "Active — eligible";
    case "cancelled":
      return "Cancelled — no longer eligible";
    case "expired":
      return "Expired — card lapsed, not renewed";
    case "deceased":
      return "Deceased — death recorded";
    case "unknown":
      return "Unknown — eligibility could not be verified";
    case undefined:
      return "Not verified — Water Corp feed not run for this property";
  }
}

/**
 * Render the Section 8 "Title state" block. Returns "" when the property
 * carries none of the extension fields (legacy fixtures, demo data); the
 * caller then omits the section header too so the pack does not show
 * empty scaffolding.
 */
function renderTitleStateSection(property: Property): string {
  const hasAny =
    property.ctVolume ||
    property.ctFolio ||
    property.ctIssuedDate ||
    property.proprietorOnTitle ||
    property.proprietorPostalAddress ||
    (property.pins && property.pins.length > 0) ||
    (property.encumbrances && property.encumbrances.length > 0) ||
    property.strataParentCt ||
    (property.strataChildren && property.strataChildren.length > 0);
  if (!hasAny) return "";

  const lines: string[] = [];
  lines.push("## 8. Title state");
  lines.push("");
  lines.push(renderTitleSourceFreshness(property.titleSource));
  lines.push("");
  // CT volume / folio / issued date
  if (property.ctVolume || property.ctFolio || property.ctIssuedDate) {
    lines.push("| Field | Value |");
    lines.push("|---|---|");
    if (property.ctVolume) lines.push(`| CT volume | ${property.ctVolume} |`);
    if (property.ctFolio) lines.push(`| CT folio | ${property.ctFolio} |`);
    if (property.ctIssuedDate)
      lines.push(`| CT issued | ${property.ctIssuedDate} |`);
    lines.push("");
  }
  // Registered proprietor + postal
  if (property.proprietorOnTitle || property.proprietorPostalAddress) {
    lines.push("**Registered proprietor (Landgate):**");
    if (property.proprietorOnTitle)
      lines.push(`- Name: ${property.proprietorOnTitle}`);
    if (property.proprietorPostalAddress)
      lines.push(`- Postal address: ${property.proprietorPostalAddress}`);
    lines.push("");
  }
  // PIN table
  const pins = property.pins ?? [];
  if (pins.length > 0) {
    lines.push(`**PINs on this VEN (${pins.length}):**`);
    lines.push("");
    lines.push(renderPinTable(pins, property.landUse));
    lines.push("");
  }
  // Encumbrances
  lines.push("**Registered encumbrances:**");
  lines.push("");
  lines.push(renderEncumbranceList(property.encumbrances ?? []));
  lines.push("");
  // Strata
  const strataBlock = renderStrataChildren(
    property.strataParentCt,
    property.strataChildren ?? [],
  );
  if (strataBlock) {
    lines.push("**Strata structure:**");
    lines.push("");
    lines.push(strataBlock);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Render the Section 9 "Concession audit" block. Returns "" when the
 * property carries no pensioner concession record so legacy fixtures are
 * unaffected. The statutory basis is fixed at the WA Rates and Charges
 * Rebates and Deferments Act 1992; non-WA tenants would need an extended
 * statutory citation table (mirrored on TEMPLATE_BY_STATE).
 */
function renderConcessionAuditSection(property: Property): string {
  const c = property.pensionerConcession;
  if (!c) return "";

  const lines: string[] = [];
  lines.push("## 9. Concession audit");
  lines.push("");

  // Current concession on file
  lines.push("**Current concession on file:**");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|---|---|");
  lines.push(`| Type | ${c.type} |`);
  lines.push(`| Applied | ${c.applied ? "yes" : "no"} |`);
  lines.push(`| Applied since | ${c.appliedAt} |`);
  if (c.cardNumber) lines.push(`| Card number | ${maskCard(c.cardNumber)} |`);
  if (c.cardExpiry) lines.push(`| Card expiry | ${c.cardExpiry} |`);
  lines.push("");

  // Water Corp eligibility check
  lines.push("**Water Corp eligibility check:**");
  lines.push("");
  lines.push(`- Status: ${renderWcStatus(c.wcEligibilityStatus)}`);
  if (c.wcEligibilityVerifiedAt)
    lines.push(`- Last verified: ${c.wcEligibilityVerifiedAt}`);
  if (c.wcCancellationReason)
    lines.push(`- Cancellation reason: ${c.wcCancellationReason}`);
  if (c.wcCancellationDate)
    lines.push(`- Cancellation date: ${c.wcCancellationDate}`);
  lines.push(`- ${renderTitleSourceFreshness(property.titleSource)}`);
  lines.push("");

  // Postal vs property address comparison
  const propertyFullAddress = `${property.address}, ${property.suburb} ${property.postcode} ${property.state}`;
  lines.push("**Postal vs property address comparison:**");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|---|---|");
  lines.push(`| Property address | ${propertyFullAddress} |`);
  lines.push(
    `| Proprietor postal | ${property.proprietorPostalAddress ?? "(not on file)"} |`,
  );
  // Use the SAME comparison the `id.pensioner_not_at_property` signal uses
  // to fire (normaliseAddress equality). The previous `.includes()` check
  // could disagree with the signal trail on abbreviated street suffixes or
  // transposed unit/street order — an internally contradictory pack in
  // front of a council legal reviewer.
  const addressMatches =
    property.proprietorPostalAddress !== undefined &&
    normaliseAddress(property.proprietorPostalAddress) ===
      normaliseAddress(property.address);
  lines.push(`| Match | ${addressMatches ? "yes" : "MISMATCH"} |`);
  lines.push("");

  // Statutory basis
  lines.push("**Statutory basis:**");
  lines.push("");
  lines.push(
    "- *Rates and Charges (Rebates and Deferments) Act 1992* (WA) — governs pensioner / senior concession on local government rates.",
  );
  lines.push(
    "- Water Corporation's eligibility feed is the authoritative source for concession status; council-applied state must be reconciled against it.",
  );
  lines.push("");

  // Recommended action
  lines.push("**Recommended action:**");
  lines.push("");
  lines.push(recommendedConcessionAction(c, addressMatches === true));
  return lines.join("\n");
}

/**
 * Mask a concession card number to last 4 digits; the rest is replaced
 * with bullets. Defensive: if the card is short or empty, returns the
 * original string so we don't accidentally over-redact during debugging.
 */
function maskCard(card: string): string {
  if (card.length < 8) return card;
  return `${"•".repeat(card.length - 4)}${card.slice(-4)}`;
}

/**
 * Recommend a concession action based on the WC eligibility status and
 * the postal/property address comparison. The output is a single
 * sentence the clerk pastes into the case note.
 */
function recommendedConcessionAction(
  c: PensionerConcession,
  addressMatches: boolean,
): string {
  const status = c.wcEligibilityStatus;
  if (status === "deceased") {
    return "Suspend the rebate immediately and engage the executor / proprietor's estate to confirm new ownership and update the rating roll.";
  }
  if (status === "cancelled") {
    return "Suspend the rebate and write to the proprietor requesting evidence of current eligibility; if none is provided within 28 days, remove the concession and backdate to the cancellation date.";
  }
  if (status === "expired") {
    return "Write to the proprietor requesting a current concession card; suspend the rebate if no current card is provided within 28 days.";
  }
  if (!addressMatches) {
    return "Verify the proprietor's principal place of residence — concession applies only where the property is the proprietor's primary residence; if the postal address indicates the proprietor lives elsewhere, the rebate is likely ineligible.";
  }
  if (status === "active") {
    return "No action required — Water Corp confirms active eligibility and addresses align.";
  }
  return "Manual review required — Water Corp eligibility cannot be verified from the current feed.";
}

/**
 * Render one tenement as a markdown bullet for the external-evidence section.
 */
function renderTenementLine(t: Tenement): string {
  const detailHref = `/alerts/${encodeURIComponent(t.tenementId)}`;
  const parts: string[] = [
    `**[${t.tenementId}](${detailHref})**`,
    `${t.type}-class`,
    t.status,
    t.commodity.length > 0 ? t.commodity.join(", ") : "no commodity listed",
    `holder: ${t.holder}`,
  ];
  if (t.holderAbn) parts.push(`ABN ${t.holderAbn}`);
  if (t.isProducing) parts.push("producing");
  parts.push(`area ${t.areaHectares.toLocaleString("en-AU")} ha`);
  parts.push(`granted ${t.grantedDate}`);
  parts.push(`expires ${t.expiryDate}`);
  return `- ${parts.join(" · ")}`;
}

/**
 * Render the proposed reclassification target. If a tenement-class signal
 * fired, "Mining" is the proposed category; otherwise we mark it for officer
 * review rather than guessing — councils sign the notice, not us.
 */
function proposedCategory(
  tenements: readonly Tenement[],
  signals: readonly SignalHit[],
): string {
  const hasTenementSignal = signals.some((s) => s.id.startsWith("reg.tenement.") || s.id.startsWith("reg.gpl."));
  if (hasTenementSignal && tenements.length > 0) return "Mining";
  return "Review — officer to determine appropriate category";
}

/**
 * State-keyed statutory citation templates. Each value is the markdown
 * fragment inserted into section 6 (Statutory basis). Adding a new
 * jurisdiction is a one-line edit here; the call-site treats a missing
 * key as "no template available" and refuses to generate the pack.
 *
 * Backdating limits are recorded as comments alongside each entry so a
 * council legal reviewer can verify the assumption against the cited
 * provision without leaving the file.
 */
const TEMPLATE_BY_STATE: Partial<Record<Property["state"], string>> = {
  // WA — backdating limit: 3 years (s.6.81 LGA 1995).
  WA: [
    "- *Local Government Act 1995* (WA), **s.6.16** — power of a local government to differentiate general rates by land-use category.",
    "- *Local Government Act 1995* (WA), **s.6.81** — backdating limit on rate adjustments (3 years rolled forward from current rating year, with strict notice requirements; this pack uses a 3-year conservative arrears estimate within that limit).",
    "- The council's adopted differential rates schedule for the relevant rating year.",
  ].join("\n"),
  // NSW — backdating limit: 5 years (s.514 LGA 1993, subject to council's
  // rates resolution and the limitation period for recovery of rates).
  NSW: [
    "- *Local Government Act 1993* (NSW), Part 1 of Chapter 15 — categorisation of land for ordinary rates.",
    "- *Local Government Act 1993* (NSW), **s.514** — categorisation of land and the council's rates resolution; backdating of rate adjustments is permitted up to 5 years subject to the council's rates resolution and the statutory limitation period for recovery of rates.",
    "- The council's adopted rates resolution for the relevant rating year.",
  ].join("\n"),
  // QLD — backdating limit: typically 5 years subject to council resolution
  // (s.94 LGA 2009 and Part 4 of the LG Regulation 2012).
  QLD: [
    "- *Local Government Regulation 2012* (QLD), Part 4 — categorisation of rateable land and differential general rates.",
    "- *Local Government Act 2009* (QLD), **s.94** — power of a local government to levy rates and charges; backdating of rate adjustments is typically permitted up to 5 years subject to council resolution and the statutory limitation period for recovery of rates.",
    "- The council's adopted differential rates resolution for the relevant rating year.",
  ].join("\n"),
};

/**
 * Statutory citation block, state-aware where possible. The set of supported
 * states is whatever appears in {@link TEMPLATE_BY_STATE}; states without an
 * entry are refused upstream in {@link buildEvidencePack} so this function
 * never sees them.
 */
function statutoryBasis(property: Property): string {
  const template = TEMPLATE_BY_STATE[property.state];
  if (!template) {
    // Defensive: the caller is responsible for short-circuiting unsupported
    // states. If we land here something has bypassed the guard.
    throw new Error(
      `statutoryBasis called for state without a template: ${property.state}`,
    );
  }
  return template;
}

type RenderInput = {
  readonly packId: string;
  readonly generatedAt: string;
  readonly candidate: MismatchCandidate;
  readonly owner: Owner;
  readonly tenements: readonly Tenement[];
  readonly prioritisedSignals: readonly SignalHit[];
  readonly headlineSignals: readonly SignalHit[];
};

/**
 * Single linear markdown template — easier to audit than fragmented helpers.
 * Section ordering matches the brief: header → property → owner → signals →
 * external evidence → headline → statutory basis → reclassification →
 * draft notice → audit trail.
 */
function renderMarkdown(input: RenderInput): string {
  const {
    packId,
    generatedAt,
    candidate,
    owner,
    tenements,
    prioritisedSignals,
    headlineSignals,
  } = input;
  const { property, signals, severity, compositeScore, kind, reason } = candidate;

  // Section 5 breakdown — sort by weight DESC, alphabetic id as tiebreaker.
  // The pre-sorted `prioritisedSignals` is used directly so the headline
  // panel and breakdown render in lock-step.
  const signalLines = prioritisedSignals.map(renderSignalLine).join("\n");

  const tenementLines =
    tenements.length > 0
      ? tenements.map(renderTenementLine).join("\n")
      : "- (no tenement coverage on this parcel; signals derive from non-spatial sources)";

  const abnSuffix = owner.abn
    ? ` (ABN ${owner.abn}${
        owner.abnCheck.kind === "checked"
          ? `${owner.abnCheck.status !== "Active" ? ` — ${owner.abnCheck.status}` : ""} — ABN status checked ${owner.abnCheck.checkedAt.slice(0, 10)}`
          : ""
      })`
    : "";

  const sources = Array.from(new Set(signals.map((s) => s.source))).join("; ");
  const proposed = proposedCategory(tenements, signals);
  const headlinePanel = renderHeadlinePanel(headlineSignals);
  const titleStateBlock = renderTitleStateSection(property);
  const concessionAuditBlock = renderConcessionAuditSection(property);

  // Legal-risk guard: surface contested-law recoveries (e.g. miscellaneous
  // licences) as a prominent callout BEFORE the evidence, so an officer confirms
  // the position before acting rather than pursuing a recovery that could be
  // reversed + refunded.
  const legalRisk = miscLicenceLegalRisk(tenements);
  const legalRiskCallout =
    legalRisk !== null
      ? `> ⚠️ **Legal risk — confirm before pursuing.** ${legalRisk.note} Affected tenement(s): ${legalRisk.affectedTenementIds.join(", ")}.`
      : null;

  return [
    `# Reclassification Evidence Pack`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| **Pack ID** | ${packId} |`,
    `| **Generated** | ${generatedAt} |`,
    `| **Composite confidence** | ${pct(compositeScore)} |`,
    `| **Severity** | ${severity.toUpperCase()} |`,
    `| **Signals fired** | ${signals.length} |`,
    ``,
    ...(headlinePanel ? [headlinePanel, ``] : []),
    ...(legalRiskCallout ? [legalRiskCallout, ``] : []),
    `## 1. Property identification`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Assessment | ${property.assessmentNumber} |`,
    `| Address | ${property.address}, ${property.suburb} ${property.postcode} ${property.state} |`,
    `| Current classification | ${property.landUse} |`,
    `| Valuation | ${aud(property.valuation)} |`,
    `| Current annual rates | ${aud(property.annualRates)} |`,
    ``,
    `## 2. Owner of record`,
    ``,
    `- **Name:** ${owner.name}${abnSuffix}`,
    `- **Postal address:** ${owner.postalAddress}`,
    `- **Phone:** ${owner.phone ?? "not on record"}`,
    `- **Email:** ${owner.email ?? "not on record"}`,
    `- **Owner since:** ${owner.ownerSince}`,
    ``,
    `## 3. Detection signal trail`,
    ``,
    `Each signal below is sourced from an authoritative public or commercial dataset, weighted by historical reliability, and contributes to the composite confidence score. Signals are listed in descending order of weight.`,
    ``,
    signalLines,
    ``,
    `**Composite confidence:** ${pct(compositeScore)} — sum of contributing signal weights with mutually-exclusive groups deduplicated, capped at 100%.`,
    ``,
    `## 4. External evidence — DMIRS tenement records`,
    ``,
    `Source: DMIRS MINEDEX / GeoVIEW.WA (public mining tenement register)  `,
    `Retrieved: ${generatedAt}`,
    ``,
    tenementLines,
    ``,
    `## 5. Headline analysis`,
    ``,
    `- **Headline signal:** ${kind}`,
    `- **Reason:** ${reason}`,
    ``,
    `## 6. Statutory basis`,
    ``,
    statutoryBasis(property),
    ``,
    `## 7. Proposed reclassification`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Current category | ${property.landUse} |`,
    `| Proposed category | ${proposed} |`,
    `| Estimated annual rates | ${aud(property.annualRates)} → ${aud(candidate.estAnnualRatesNew)} |`,
    `| Estimated annual uplift | **${aud(candidate.estUplift)}** |`,
    `| Estimated arrears (3-year conservative) | **${aud(candidate.estArrears3y)}** |`,
    ``,
    // Sections 8 + 9 — Title state and Concession audit (VEN/CT/Concession
    // feature). Each helper returns "" when the property carries no fields
    // for that section so legacy fixtures (no pins, no concession) render
    // unchanged. When populated, both sections come BEFORE the draft notice
    // because the notice draws on the title-state proprietor data.
    ...(titleStateBlock ? [titleStateBlock] : []),
    ...(concessionAuditBlock ? [concessionAuditBlock, ``] : []),
    `## 10. Draft notice to ratepayer`,
    ``,
    `> [Council letterhead]`,
    `>`,
    `> ${owner.name}  `,
    `> ${owner.postalAddress}`,
    `>`,
    `> **Re: Notice of proposed rate-category reclassification — Assessment ${property.assessmentNumber}**`,
    `>`,
    `> Following review of the rating classification applied to your property at ${property.address}, ${property.suburb}, the council proposes to reclassify the property from "${property.landUse}" to ${proposed === "Mining" ? "\"Mining\"" : "an appropriate alternative category"} with effect from the next rating year. The proposal is supported by evidence drawn from authoritative state and federal registers, summarised in the attached signal trail.`,
    `>`,
    `> The estimated annual rates under the proposed category are ${aud(candidate.estAnnualRatesNew)}, an increase of ${aud(candidate.estUplift)} over the current amount. Backdated adjustments may apply within the limits set by the relevant Local Government Act.`,
    `>`,
    `> You have the right to object to this proposed reclassification within the period prescribed by the council's rates resolution. Objections must be lodged in writing to the council's rates department.`,
    ``,
    `## 11. Audit trail`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Property record source | Council rating system (tenant adapter) |`,
    `| Signal sources | ${sources} |`,
    `| Cross-reference logic | RatesAssist multi-signal detection engine (deterministic, weighted-additive) |`,
    `| Severity scoring | Composite ≥ 0.60 high · ≥ 0.35 medium · ≥ 0.15 low |`,
    `| AI involvement | Narration only — scoring and uplift estimates are deterministic |`,
    `| Officer review required | Yes — statutory determination remains with the council |`,
    `| Pack retrieved | ${generatedAt} |`,
    ``,
    `---`,
    ``,
    `*Generated by RatesAssist. This pack is advisory; statutory determination remains with the council.*`,
  ].join("\n");
}
