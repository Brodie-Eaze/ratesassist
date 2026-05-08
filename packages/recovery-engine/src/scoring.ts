/**
 * Composite scoring engine.
 *
 * Pure functions over the contract's domain types. No I/O, no global state.
 * Easily unit-testable. Adapters call `evaluateSignals(property, ctx)` to
 * get the firing signals; the host composes those into a candidate.
 *
 * The exclusive-group invariant is enforced at the scoring layer (not just
 * in `evaluateSignals`) so that any future signal added wrong cannot
 * silently double-count.
 */

import type {
  MismatchSeverity,
  Owner,
  Property,
  SignalDef,
  SignalHit,
  Tenement,
} from "@ratesassist/contract";

import {
  SEVERITY_BANDS,
  SIGNAL_CATALOGUE,
  UPLIFT_MULTIPLIER,
  getSignal,
} from "./signals.js";

/**
 * Construct a SignalHit from a definition + evidence string. Use this
 * helper rather than spreading the SignalDef so we don't accidentally
 * carry over fields like `description` or `exclusiveGroup` which the
 * contract forbids on a hit.
 */
function hit(sig: SignalDef, evidence: string): SignalHit {
  return {
    id: sig.id,
    name: sig.name,
    short: sig.short,
    category: sig.category,
    weight: sig.weight,
    source: sig.source,
    evidence,
  };
}

/**
 * Context passed into per-property signal evaluation. The host pre-computes
 * indexes once per sweep so signal evaluation is O(1) per property,
 * O(n) per portfolio.
 */
export type EvaluationContext = {
  /** All properties in the active tenant — used for portfolio + outlier signals. */
  readonly properties: readonly Property[];
  /** Owner records keyed by ownerId. */
  readonly ownersById: ReadonlyMap<string, Owner>;
  /** Live tenements that intersect each assessment, keyed by assessmentNumber. */
  readonly tenementsByAssessment: ReadonlyMap<string, readonly Tenement[]>;
};

const INDUSTRY_TERMS: readonly string[] = [
  "iron", "mining", "resources", "minerals", "metals", "gold", "lithium",
  "copper", "zinc", "nickel", "rare earth", "exploration", "prospecting",
  "pastoral", "solar", "energy", "infrastructure",
];

function containsIndustryTerm(name: string): string | null {
  const lower = name.toLowerCase();
  for (const term of INDUSTRY_TERMS) {
    if (lower.includes(term)) return term;
  }
  return null;
}

function ownerOf(p: Property, ctx: EvaluationContext): Owner | undefined {
  const ownerId = p.ownerIds[0];
  return ownerId ? ctx.ownersById.get(ownerId) : undefined;
}

function ownerPortfolio(
  ownerId: string,
  ctx: EvaluationContext,
): { total: number; withTenements: number; pct: number } {
  const props = ctx.properties.filter((p) => p.ownerIds.includes(ownerId));
  const withTen = props.filter(
    (p) => (ctx.tenementsByAssessment.get(p.assessmentNumber) ?? []).length > 0,
  );
  return {
    total: props.length,
    withTenements: withTen.length,
    pct: props.length > 0 ? withTen.length / props.length : 0,
  };
}

function suburbRuralValuationPercentile(
  p: Property,
  ctx: EvaluationContext,
): number {
  const peers = ctx.properties.filter(
    (q) =>
      q.suburb === p.suburb &&
      q.landUse === "Rural" &&
      q.assessmentNumber !== p.assessmentNumber,
  );
  // Insufficient peer set to establish percentile; suppress outlier signal
  // rather than risk false positive on lone-rural-parcel suburbs. A neutral
  // 0.5 keeps the property out of both the upper- and lower-decile triggers
  // that downstream signals key off.
  if (peers.length < 2) return 0.5;
  const lower = peers.filter((q) => q.valuation < p.valuation).length;
  return lower / peers.length;
}

/**
 * Evaluate every signal against a property. Returns the hits in declaration
 * order. The caller composes them via `computeComposite`.
 *
 * Note: tenement-class signals (`reg.tenement.*`) share an exclusive group
 * — the if/else if branching here ensures only one fires per property,
 * but the scoring layer also enforces this defensively.
 */
export function evaluateSignals(
  p: Property,
  ctx: EvaluationContext,
): readonly SignalHit[] {
  const hits: SignalHit[] = [];
  const tenements = ctx.tenementsByAssessment.get(p.assessmentNumber) ?? [];
  const owner = ownerOf(p, ctx);

  // ---- Tenement-class signals (mutually exclusive) ----
  if (tenements.length > 0 && (p.landUse === "Rural" || p.landUse === "Vacant")) {
    const live = tenements.filter((t) => t.status === "Live");
    const producing = live.filter((t) => t.isProducing);
    const gpls = live.filter((t) => t.type === "G");
    const miningLeases = live.filter((t) => t.type === "M");
    const explorationOnly =
      live.length > 0 && live.every((t) => t.type === "E" || t.type === "P");

    if (producing.some((t) => t.type === "M")) {
      const sig = getSignal("reg.tenement.producing.on_rural_or_vacant")!;
      hits.push(
        hit(
          sig,
          `${producing.length} producing mining lease(s) intersect this parcel: ${producing
            .map((t) => t.tenementId)
            .join(", ")}.`,
        ),
      );
    } else if (gpls.some((t) => t.isProducing) && p.landUse === "Vacant") {
      const sig = getSignal("reg.gpl.producing.on_vacant")!;
      const gpl = gpls.find((t) => t.isProducing)!;
      hits.push(
        hit(
          sig,
          `Producing general-purpose lease ${gpl.tenementId} (${gpl.commodity.join(", ")}) on parcel listed as vacant.`,
        ),
      );
    } else if (miningLeases.length > 0) {
      const sig = getSignal("reg.tenement.live_lease.on_rural_or_vacant")!;
      hits.push(
        hit(
          sig,
          `Live mining lease(s) intersect this parcel: ${miningLeases.map((t) => t.tenementId).join(", ")}.`,
        ),
      );
    } else if (explorationOnly) {
      const sig = getSignal("reg.tenement.exploration_only.on_rural")!;
      hits.push(
        hit(
          sig,
          `Only exploration / prospecting tenement(s) intersect this parcel: ${live
            .map((t) => t.tenementId)
            .join(", ")}.`,
        ),
      );
    }
  }

  // ---- Identity: ABN cancelled / suspended ----
  if (owner?.abnCheck.kind === "checked" && owner.abnCheck.status !== "Active") {
    const sig = getSignal("id.abn.cancelled_or_suspended")!;
    hits.push(
      hit(
        sig,
        `Owner ${owner.name} (ABN ${owner.abn ?? "?"}) ABN status: ${owner.abnCheck.status} (checked ${owner.abnCheck.checkedAt}).`,
      ),
    );
  }

  // ---- Identity: tenement holder ≠ rated owner ----
  if (owner && tenements.length > 0) {
    const ownerNameLower = owner.name.toLowerCase();
    const mismatch = tenements.find(
      (t) =>
        t.status === "Live" &&
        !t.holder.toLowerCase().includes(ownerNameLower) &&
        !ownerNameLower.includes(t.holder.toLowerCase()),
    );
    if (mismatch) {
      const sig = getSignal("id.holder_ne_owner")!;
      hits.push(
        hit(
          sig,
          `Tenement ${mismatch.tenementId} holder "${mismatch.holder}" differs from rated owner "${owner.name}".`,
        ),
      );
    }
  }

  // ---- Corporate: industry indicator in owner name vs rural/vacant rate ----
  if (owner && (p.landUse === "Rural" || p.landUse === "Vacant")) {
    const term = containsIndustryTerm(owner.name);
    if (term) {
      const sig = getSignal("id.industry_indicator_in_owner_name")!;
      hits.push(
        hit(
          sig,
          `Owner name "${owner.name}" contains industry term "${term}" but property rated ${p.landUse}.`,
        ),
      );
    }
  }

  // ---- Behavioural: owner portfolio tenement majority ----
  if (owner) {
    const pf = ownerPortfolio(owner.ownerId, ctx);
    if (pf.total >= 3 && pf.pct >= 0.5) {
      const sig = getSignal("beh.owner_portfolio_tenement_majority")!;
      hits.push(
        hit(
          sig,
          `Owner ${owner.name} holds ${pf.total} properties; ${pf.withTenements} (${(pf.pct * 100).toFixed(0)}%) intersect tenements — mining-dominant portfolio.`,
        ),
      );
    }
  }

  // ---- Spatial: high-value rural outlier ----
  if (p.landUse === "Rural") {
    const pct = suburbRuralValuationPercentile(p, ctx);
    if (pct >= 0.85) {
      const sig = getSignal("spat.outlier.high_value_rural")!;
      hits.push(
        hit(
          sig,
          `Valuation $${p.valuation.toLocaleString()} sits in the top ${((1 - pct) * 100).toFixed(0)}% of rural-rated parcels in ${p.suburb} — investigate for undeclared improvements.`,
        ),
      );
    }
  }

  return hits;
}

/**
 * Compose signal hits into a single composite confidence score (0..1),
 * enforcing exclusive-group constraints defensively. Among signals sharing
 * an exclusive group, only the highest-weight hit contributes; ungrouped
 * signals all contribute. Sum is capped at 1.0.
 */
export function computeComposite(hits: readonly SignalHit[]): number {
  if (hits.length === 0) return 0;

  const byGroup = new Map<string, SignalHit>();
  const ungrouped: SignalHit[] = [];

  for (const h of hits) {
    const def = SIGNAL_CATALOGUE.find((s) => s.id === h.id);
    const group = def?.exclusiveGroup;
    if (!group) {
      ungrouped.push(h);
      continue;
    }
    const existing = byGroup.get(group);
    if (!existing || h.weight > existing.weight) {
      byGroup.set(group, h);
    }
  }

  const sum =
    ungrouped.reduce((s, h) => s + h.weight, 0) +
    [...byGroup.values()].reduce((s, h) => s + h.weight, 0);
  return Math.min(1, sum);
}

export function severityForScore(score: number): MismatchSeverity {
  if (score >= SEVERITY_BANDS.high) return "high";
  if (score >= SEVERITY_BANDS.medium) return "medium";
  return "low";
}

export function estimateUplift(
  annualRatesNow: number,
  severity: MismatchSeverity,
): { estAnnualRatesNew: number; estUplift: number; estArrears3y: number } {
  const estAnnualRatesNew = Math.round(annualRatesNow * UPLIFT_MULTIPLIER[severity]);
  const estUplift = estAnnualRatesNew - annualRatesNow;
  const estArrears3y = estUplift * 3;
  return { estAnnualRatesNew, estUplift, estArrears3y };
}
