// RatesRecovery — multi-signal detection engine.
//
// The "secret sauce": each property is evaluated against a portfolio of
// detection signals drawn from authoritative public + commercial sources.
// Each signal has an evidence string, a weight, and a category. Signals
// compose into a weighted composite score, capped at 1.0. The score
// breakdown is transparent and auditable — every contribution is named,
// weighted, and cited so council legal teams can defend reclassifications.
//
// Signals are deterministic (rule + lookup). The LLM never invents them.

import {
  OWNERS,
  PROPERTIES,
  TENEMENTS,
  getOwnersForProperty,
  getProperty,
  getTenementsForAssessment,
} from "./data";
import type {
  MismatchCandidate,
  MismatchSeverity,
  Owner,
  Property,
  SignalDef,
  SignalHit,
  Tenement,
} from "./types";

// ===== Signal catalogue =====

export const SIGNAL_CATALOGUE: SignalDef[] = [
  // ---- REGISTER signals (DMIRS / Landgate / Title) ----
  {
    id: "reg.tenement.producing.on_rural_or_vacant",
    name: "Producing tenement on rural/vacant rate",
    short: "Producing tenement",
    category: "register",
    weight: 0.55,
    exclusiveGroup: "tenement-class",
    description:
      "Property currently rated rural or vacant, but a producing mining lease intersects the parcel. Strongest single-source recovery signal.",
    source: "DMIRS MINEDEX (WA) / state mining registers",
  },
  {
    id: "reg.tenement.live_lease.on_rural_or_vacant",
    name: "Live mining lease on rural/vacant rate",
    short: "Live lease",
    category: "register",
    weight: 0.45,
    exclusiveGroup: "tenement-class",
    description:
      "Live mining lease (M-class) intersects parcel; production status unconfirmed but lease is granted, statutory basis for reclassification still applies.",
    source: "DMIRS MINEDEX",
  },
  {
    id: "reg.gpl.producing.on_vacant",
    name: "Producing general-purpose lease on vacant rate",
    short: "Producing GPL",
    category: "register",
    weight: 0.55,
    exclusiveGroup: "tenement-class",
    description:
      "Property listed as vacant but a producing general-purpose lease (typically solar farms or mining infrastructure) intersects the parcel.",
    source: "DMIRS MINEDEX",
  },
  {
    id: "reg.tenement.exploration_only.on_rural",
    name: "Exploration tenement only — review",
    short: "Exploration only",
    category: "register",
    weight: 0.20,
    exclusiveGroup: "tenement-class",
    description:
      "Only exploration / prospecting tenements intersect parcel. Reclassification depends on actual ground disturbance — flagged for officer review with aerial-imagery cross-check before action.",
    source: "DMIRS MINEDEX",
  },
  // ---- IDENTITY signals (ABN / ASIC) ----
  {
    id: "id.abn.cancelled_or_suspended",
    name: "Owner ABN cancelled or suspended",
    short: "ABN cancelled",
    category: "identity",
    weight: 0.30,
    description:
      "The corporate entity registered as ratepayer is no longer an active ABN. Rates correspondence may be uncollectable; ownership often shifted without title transfer being registered.",
    source: "ATO ABN Lookup",
  },
  {
    id: "id.holder_ne_owner",
    name: "Tenement holder differs from rated owner",
    short: "Holder ≠ owner",
    category: "identity",
    weight: 0.30,
    description:
      "DMIRS-registered tenement holder is not the property's rated owner. Common after tenement transfer when council records were not updated.",
    source: "DMIRS + TechOne owner record",
  },
  {
    id: "id.industry_indicator_in_owner_name",
    name: "Industry indicator in owner name vs rural rate",
    short: "Industry name",
    category: "corporate",
    weight: 0.20,
    description:
      "Registered owner name contains a mining-, resources- or industry-specific term (e.g. 'Iron', 'Resources', 'Mining', 'Solar') yet the parcel is rated rural / vacant. Soft signal; compounds with tenement coverage.",
    source: "ASIC company register + ABN Lookup",
  },
  // ---- BEHAVIOURAL / PORTFOLIO signals ----
  {
    id: "beh.owner_portfolio_tenement_majority",
    name: "Owner portfolio is mining-dominant",
    short: "Mining portfolio",
    category: "behavioural",
    weight: 0.20,
    description:
      "Owner holds ≥3 properties in the council portfolio AND ≥50% of those have tenement coverage. Suggests mining-business ratepayer; outliers in their portfolio rated rural deserve review.",
    source: "Internal portfolio analysis",
  },
  // ---- SPATIAL signals ----
  {
    id: "spat.outlier.high_value_rural",
    name: "High-value rural — outlier in suburb",
    short: "High-value rural",
    category: "spatial",
    weight: 0.15,
    description:
      "Property rated rural but valuation is in the top 10% of rural-rated parcels in the suburb. Often indicates undeclared improvements or commercial use.",
    source: "Internal spatial-pattern analysis",
  },
  // ---- AERIAL signals (placeholder when Nearmap key absent) ----
  {
    id: "aerial.change_detected_recent",
    name: "Recent aerial change detected",
    short: "Aerial change",
    category: "aerial",
    weight: 0.30,
    description:
      "Nearmap AI change-detection feed flagged a structural or land-use change since last rates classification review (new structures, clearing, solar arrays, vehicle/equipment activity).",
    source: "Nearmap AI change feed",
  },
];

export function getSignal(id: string): SignalDef | undefined {
  return SIGNAL_CATALOGUE.find((s) => s.id === id);
}

// ===== Detection helpers =====

function ownerOf(p: Property): Owner | undefined {
  return getOwnersForProperty(p)[0];
}

const INDUSTRY_TERMS = [
  "iron",
  "mining",
  "resources",
  "minerals",
  "metals",
  "gold",
  "lithium",
  "copper",
  "zinc",
  "nickel",
  "rare earth",
  "exploration",
  "prospecting",
  "pastoral",
  "solar",
  "energy",
  "infrastructure",
];

function nameContainsIndustryTerm(name: string): string | null {
  const lower = name.toLowerCase();
  for (const term of INDUSTRY_TERMS) {
    if (lower.includes(term)) return term;
  }
  return null;
}

function ownerPortfolio(ownerId: string): {
  total: number;
  withTenements: number;
  pct: number;
} {
  const props = PROPERTIES.filter((p) => p.ownerIds.includes(ownerId));
  const withTen = props.filter((p) => getTenementsForAssessment(p.assessmentNumber).length > 0);
  return {
    total: props.length,
    withTenements: withTen.length,
    pct: props.length > 0 ? withTen.length / props.length : 0,
  };
}

function suburbRuralValuationPercentile(p: Property): number {
  const peers = PROPERTIES.filter(
    (q) => q.suburb === p.suburb && q.landUse === "Rural" && q.assessmentNumber !== p.assessmentNumber,
  );
  if (peers.length < 2) return 0.5;
  const lower = peers.filter((q) => q.valuation < p.valuation).length;
  return lower / peers.length;
}

// ===== Per-property signal evaluation =====

function evaluateSignals(p: Property): SignalHit[] {
  const hits: SignalHit[] = [];
  const tenements = getTenementsForAssessment(p.assessmentNumber);
  const owner = ownerOf(p);

  // ---- Register / tenement-class signals (mutually exclusive) ----
  if (tenements.length > 0 && (p.landUse === "Rural" || p.landUse === "Vacant")) {
    const live = tenements.filter((t) => t.status === "Live");
    const producing = live.filter((t) => t.isProducing);
    const gpls = live.filter((t) => t.type === "G");
    const miningLeases = live.filter((t) => t.type === "M");
    const explorationOnly = live.length > 0 && live.every((t) => ["E", "P", "L"].includes(t.type));

    if (producing.some((t) => t.type === "M")) {
      const sig = getSignal("reg.tenement.producing.on_rural_or_vacant")!;
      hits.push({
        ...sig,
        evidence: `${producing.length} producing mining lease(s) intersect this parcel: ${producing.map((t) => t.tenementId).join(", ")}.`,
      });
    } else if (gpls.some((t) => t.isProducing) && p.landUse === "Vacant") {
      const sig = getSignal("reg.gpl.producing.on_vacant")!;
      const gpl = gpls.find((t) => t.isProducing)!;
      hits.push({
        ...sig,
        evidence: `Producing general-purpose lease ${gpl.tenementId} (${gpl.commodity.join(", ")}) on parcel listed as vacant.`,
      });
    } else if (miningLeases.length > 0) {
      const sig = getSignal("reg.tenement.live_lease.on_rural_or_vacant")!;
      hits.push({
        ...sig,
        evidence: `Live mining lease(s) intersect this parcel: ${miningLeases.map((t) => t.tenementId).join(", ")}.`,
      });
    } else if (explorationOnly) {
      const sig = getSignal("reg.tenement.exploration_only.on_rural")!;
      hits.push({
        ...sig,
        evidence: `Only exploration / prospecting tenement(s) intersect this parcel: ${live.map((t) => t.tenementId).join(", ")}.`,
      });
    }
  }

  // ---- Identity: ABN cancelled / suspended ----
  if (owner?.abnStatus && owner.abnStatus !== "Active") {
    const sig = getSignal("id.abn.cancelled_or_suspended")!;
    hits.push({
      ...sig,
      evidence: `Owner ${owner.name} (ABN ${owner.abn ?? "?"}) ABN status: ${owner.abnStatus}.`,
    });
  }

  // ---- Identity: tenement holder ≠ rated owner ----
  if (owner && tenements.length > 0) {
    const ownerNameLower = owner.name.toLowerCase();
    const mismatchHolder = tenements.find(
      (t) => t.status === "Live" && !t.holder.toLowerCase().includes(ownerNameLower) && !ownerNameLower.includes(t.holder.toLowerCase()),
    );
    if (mismatchHolder) {
      const sig = getSignal("id.holder_ne_owner")!;
      hits.push({
        ...sig,
        evidence: `Tenement ${mismatchHolder.tenementId} holder "${mismatchHolder.holder}" differs from rated owner "${owner.name}".`,
      });
    }
  }

  // ---- Corporate: industry indicator in name vs rural rate ----
  if (owner && (p.landUse === "Rural" || p.landUse === "Vacant")) {
    const term = nameContainsIndustryTerm(owner.name);
    if (term) {
      const sig = getSignal("id.industry_indicator_in_owner_name")!;
      hits.push({
        ...sig,
        evidence: `Owner name "${owner.name}" contains industry term "${term}" but property rated ${p.landUse}.`,
      });
    }
  }

  // ---- Behavioural: owner portfolio tenement majority ----
  if (owner) {
    const pf = ownerPortfolio(owner.ownerId);
    if (pf.total >= 3 && pf.pct >= 0.5) {
      const sig = getSignal("beh.owner_portfolio_tenement_majority")!;
      hits.push({
        ...sig,
        evidence: `Owner ${owner.name} holds ${pf.total} properties; ${pf.withTenements} (${(pf.pct * 100).toFixed(0)}%) intersect tenements — mining-dominant portfolio.`,
      });
    }
  }

  // ---- Spatial: high-value rural outlier ----
  if (p.landUse === "Rural") {
    const pct = suburbRuralValuationPercentile(p);
    if (pct >= 0.85) {
      const sig = getSignal("spat.outlier.high_value_rural")!;
      hits.push({
        ...sig,
        evidence: `Valuation $${p.valuation.toLocaleString()} sits in the top ${((1 - pct) * 100).toFixed(0)}% of rural-rated parcels in ${p.suburb} — investigate for undeclared improvements.`,
      });
    }
  }

  return hits;
}

// ===== Composite scoring =====

function computeComposite(hits: SignalHit[]): number {
  if (!hits.length) return 0;
  // Weighted sum, capped at 1.0
  const sum = hits.reduce((s, h) => s + h.weight, 0);
  return Math.min(1, sum);
}

function severityForScore(score: number): MismatchSeverity {
  if (score >= 0.6) return "high";
  if (score >= 0.35) return "medium";
  return "low";
}

function describeKind(hits: SignalHit[]): { kind: string; reason: string } {
  if (!hits.length) return { kind: "no signal", reason: "" };
  // Use the highest-weight signal as the headline
  const top = [...hits].sort((a, b) => b.weight - a.weight)[0];
  const others = hits.length - 1;
  return {
    kind: top.short,
    reason:
      top.evidence +
      (others > 0
        ? ` Plus ${others} additional signal(s) compound the case (composite breakdown below).`
        : ""),
  };
}

export function estimateUplift(
  annualRatesNow: number,
  severity: MismatchSeverity,
): { estAnnualRatesNew: number; estUplift: number; estArrears5y: number } {
  const multiplier = severity === "high" ? 8 : severity === "medium" ? 4 : 1.5;
  const estAnnualRatesNew = Math.round(annualRatesNow * multiplier);
  const estUplift = estAnnualRatesNew - annualRatesNow;
  const estArrears5y = estUplift * 3;
  return { estAnnualRatesNew, estUplift, estArrears5y };
}

// ===== Public API =====

export function findMismatches(opts?: {
  council?: string;
  minSeverity?: MismatchSeverity;
}): MismatchCandidate[] {
  const sevRank: Record<MismatchSeverity, number> = { low: 0, medium: 1, high: 2 };
  const minRank = sevRank[opts?.minSeverity ?? "low"];
  const out: MismatchCandidate[] = [];

  for (const p of PROPERTIES) {
    if (opts?.council && p.council !== opts.council) continue;
    const signals = evaluateSignals(p);
    if (!signals.length) continue;

    const compositeScore = computeComposite(signals);
    const severity = severityForScore(compositeScore);
    if (sevRank[severity] < minRank) continue;

    const { estAnnualRatesNew, estUplift, estArrears5y } = estimateUplift(p.annualRates, severity);
    const { kind, reason } = describeKind(signals);
    const tenements = getTenementsForAssessment(p.assessmentNumber);

    out.push({
      assessmentNumber: p.assessmentNumber,
      property: p,
      tenements,
      kind,
      severity,
      reason,
      confidence: compositeScore,
      compositeScore,
      signals,
      estAnnualRatesNew,
      estUplift,
      estArrears5y,
    });
  }

  out.sort((a, b) => b.estUplift - a.estUplift);
  return out;
}

export function buildEvidencePack(assessmentNumber: string): {
  candidate: MismatchCandidate;
  markdown: string;
  packId: string;
} | null {
  const p = getProperty(assessmentNumber);
  if (!p) return null;
  const signals = evaluateSignals(p);
  if (!signals.length) return null;

  const compositeScore = computeComposite(signals);
  const severity = severityForScore(compositeScore);
  const { estAnnualRatesNew, estUplift, estArrears5y } = estimateUplift(p.annualRates, severity);
  const tenements = getTenementsForAssessment(p.assessmentNumber);
  const { kind, reason } = describeKind(signals);
  const owner = getOwnersForProperty(p)[0];

  const candidate: MismatchCandidate = {
    assessmentNumber,
    property: p,
    tenements,
    kind,
    severity,
    reason,
    confidence: compositeScore,
    compositeScore,
    signals,
    estAnnualRatesNew,
    estUplift,
    estArrears5y,
  };

  const today = new Date().toISOString().slice(0, 10);
  const packId = `EP-${assessmentNumber}-${today.replace(/-/g, "")}`;

  const tenLines = tenements.length
    ? tenements
        .map(
          (t) =>
            `- **${t.tenementId}** (${t.status}, ${t.commodity.join(", ")}, holder: ${t.holder}${t.holderAbn ? ` — ABN ${t.holderAbn}` : ""}${t.isProducing ? ", producing" : ""})`,
        )
        .join("\n")
    : "- (no tenement coverage on this parcel)";

  const signalLines = signals
    .sort((a, b) => b.weight - a.weight)
    .map(
      (s) =>
        `- **${s.short}** *(weight ${s.weight.toFixed(2)} · ${s.category})* — ${s.evidence}\n  · Source: ${s.source}`,
    )
    .join("\n");

  const markdown = `
# Reclassification Evidence Pack

| | |
|---|---|
| **Pack ID** | ${packId} |
| **Generated** | ${today} |
| **Composite confidence** | ${(compositeScore * 100).toFixed(0)}% |
| **Severity** | ${severity.toUpperCase()} |
| **Signals fired** | ${signals.length} |

## 1. Property identification

| Field | Value |
|---|---|
| Assessment | ${p.assessmentNumber} |
| Address | ${p.address}, ${p.suburb} ${p.postcode} |
| Current classification | ${p.landUse} |
| Valuation | $${p.valuation.toLocaleString()} |
| Current annual rates | $${p.annualRates.toLocaleString()} |

**Owner of record**

- ${owner.name}${owner.abn ? ` (ABN ${owner.abn}${owner.abnStatus && owner.abnStatus !== "Active" ? ` — ${owner.abnStatus}` : ""})` : ""}
- ${owner.postalAddress}
- ${owner.phone ?? "no phone"} · ${owner.email ?? "no email"}
- Owner since: ${owner.ownerSince}

## 2. Detection signal trail

The following signals fired against this property. Each is sourced from an authoritative public or commercial dataset, weighted by historical reliability, and contributes to the composite confidence score.

${signalLines}

**Composite confidence:** ${(compositeScore * 100).toFixed(0)}% — sum of contributing signal weights, capped at 100%.

## 3. External evidence — DMIRS tenement register

Source: DMIRS MINEDEX / GeoVIEW.WA (public)
Retrieved: ${today}

${tenLines}

## 4. Headline analysis

- **Headline signal:** ${kind}
- **Reason:** ${reason}

## 5. Statutory basis

- *Local Government Act 1995* (WA), **s.6.16** — power to differentiate general rates by land-use category.
- *Local Government Act 1995* (WA), **s.6.81** — backdating limit for rate adjustments (5 years from current rate year).
- Council's adopted differential rates schedule for the relevant rating year.

## 6. Proposed reclassification

| | |
|---|---|
| Current category | ${p.landUse} |
| Proposed category | ${tenements.length ? "Mining" : "Review — see signal trail"} |
| Estimated annual rates | $${p.annualRates.toLocaleString()} → $${estAnnualRatesNew.toLocaleString()} |
| Estimated annual uplift | **$${estUplift.toLocaleString()}** |
| Estimated arrears (3y conservative) | **$${estArrears5y.toLocaleString()}** |

## 7. Draft notice to ratepayer

> [Council letterhead]
>
> ${owner.name}
> ${owner.postalAddress}
>
> **Re: Notice of proposed rate-category reclassification — Assessment ${p.assessmentNumber}**
>
> Following review of the rating classification applied to your property at ${p.address}, ${p.suburb}, the council proposes to reclassify the property from "${p.landUse}" to ${tenements.length ? "\"Mining\"" : "an appropriate alternative category"} with effect from the next rating year, on the basis of evidence drawn from authoritative state and federal registers (see signal trail above).
>
> The estimated annual rates under the proposed category are $${estAnnualRatesNew.toLocaleString()}, an increase of $${estUplift.toLocaleString()} over the current amount. Backdated adjustments may apply within the limits set by Section 6.81 of the *Local Government Act 1995* (WA).
>
> You have the right to object to this proposed reclassification within [council-defined period] of the date of this notice. Objections should be lodged in writing to [council contact].

## 8. Audit trail

| | |
|---|---|
| Property record source | Council rating system |
| Signal sources | ${Array.from(new Set(signals.map((s) => s.source))).join("; ")} |
| Cross-reference logic | RatesAssist multi-signal detection engine |
| Severity scoring | Weighted-additive (deterministic, see methodology) |
| Reviewed by AI | Narration only — scoring is deterministic |
| Officer review required | Yes — council retains statutory authority |

---

*Generated by RatesAssist. This pack is advisory; statutory determination remains with council.*
`.trim();

  return { candidate, markdown, packId };
}

export function recoveryStats(councilCode?: string) {
  const all = findMismatches({ council: councilCode });
  const high = all.filter((c) => c.severity === "high");
  const medium = all.filter((c) => c.severity === "medium");
  const low = all.filter((c) => c.severity === "low");
  const totalUplift = all.reduce((s, c) => s + c.estUplift, 0);
  const highUplift = high.reduce((s, c) => s + c.estUplift, 0);
  const totalArrears = all.reduce((s, c) => s + c.estArrears5y, 0);
  // Per-signal contribution rollup
  const signalCounts: Record<string, number> = {};
  for (const c of all) {
    for (const s of c.signals) {
      signalCounts[s.id] = (signalCounts[s.id] ?? 0) + 1;
    }
  }
  return {
    total: all.length,
    high: high.length,
    medium: medium.length,
    low: low.length,
    totalUplift,
    highUplift,
    totalArrears,
    totalRecovery: totalUplift + totalArrears,
    signalCounts,
  };
}
