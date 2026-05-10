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
  MismatchCandidate,
  Owner,
  Property,
  SignalHit,
  Tenement,
} from "@ratesassist/contract";

import {
  computeComposite,
  estimateUplift,
  evaluateSignals,
  severityForScore,
  type EvaluationContext,
} from "./scoring.js";

/**
 * The terminal value of a successful pack build.
 */
export type EvidencePack = {
  readonly packId: string;
  /** ISO-8601 date (YYYY-MM-DD) — packs are reproducible per day. */
  readonly generatedAt: string;
  readonly candidate: MismatchCandidate;
  readonly markdown: string;
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
  });

  return {
    kind: "ok",
    pack: { packId, generatedAt, candidate, markdown },
  };
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
};

/**
 * Single linear markdown template — easier to audit than fragmented helpers.
 * Section ordering matches the brief: header → property → owner → signals →
 * external evidence → headline → statutory basis → reclassification →
 * draft notice → audit trail.
 */
function renderMarkdown(input: RenderInput): string {
  const { packId, generatedAt, candidate, owner, tenements } = input;
  const { property, signals, severity, compositeScore, kind, reason } = candidate;

  const signalLines = [...signals]
    .sort((a, b) => b.weight - a.weight)
    .map(renderSignalLine)
    .join("\n");

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
    `## 8. Draft notice to ratepayer`,
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
    `## 9. Audit trail`,
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
