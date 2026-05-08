/**
 * Recovery handlers — composed over `@ratesassist/recovery-engine`.
 *
 * The adapter does not re-implement signal evaluation; it plugs the
 * recovery engine into the demo's data store via the shared
 * `EvaluationContext` on the request context.
 */
import { buildEvidencePack, findMismatches, recoveryStats, } from "@ratesassist/recovery-engine";
import { notFound } from "../runtime/errors.js";
import { aud, intAu } from "./format.js";
/** Cap on candidates rendered in the human-readable text. */
const MAX_MISMATCH_LINES = 25;
/** Friendly label for a tenement type letter. */
function tenementTypeLabel(type) {
    switch (type) {
        case "M":
            return "Mining Lease";
        case "E":
            return "Exploration Licence";
        case "P":
            return "Prospecting Licence";
        case "G":
            return "General-Purpose Lease";
        case "L":
            return "Misc / Infrastructure Licence";
        default:
            return type;
    }
}
/** `find_mining_mismatches` — composed over `findMismatches`. */
export async function findMiningMismatchesHandler(input, ctx) {
    const candidates = findMismatches(ctx.evaluationContext, {
        ...(input.council !== undefined ? { council: input.council } : {}),
        ...(input.minSeverity !== undefined ? { minSeverity: input.minSeverity } : {}),
    });
    if (candidates.length === 0) {
        const filterDesc = input.minSeverity ?? "low";
        return {
            ok: true,
            output: `No mining-classification mismatches found at severity >= ${filterDesc}.`,
            data: { candidates: [] },
            mutated: false,
        };
    }
    const totalUplift = candidates.reduce((s, c) => s + c.estUplift, 0);
    const totalArrears = candidates.reduce((s, c) => s + c.estArrears3y, 0);
    const shown = candidates.slice(0, MAX_MISMATCH_LINES);
    const overflow = candidates.length - shown.length;
    const lines = shown.map((c, i) => {
        const tenList = c.tenements
            .map((t) => `${t.tenementId} (${t.status}, ${t.commodity.join("/")}${t.isProducing ? ", producing" : ""})`)
            .join("; ");
        return [
            `${i + 1}. ${c.assessmentNumber} — ${c.property.address}, ${c.property.suburb}`,
            `   Current: ${c.property.landUse} → Proposed: Mining (${c.severity}, composite ${(c.compositeScore * 100).toFixed(0)}%)`,
            `   Tenements: ${tenList || "(none)"}`,
            `   Reason: ${c.reason}`,
            `   Est. annual uplift: ${aud(c.estUplift)} (${aud(c.property.annualRates)} → ${aud(c.estAnnualRatesNew)}); 3-yr arrears ${aud(c.estArrears3y)}`,
        ].join("\n");
    });
    const trailer = overflow > 0 ? `\n... and ${overflow} more (truncated; see structured data)` : "";
    const text = [
        `Mining-classification mismatch audit (severity >= ${input.minSeverity ?? "low"}${input.council ? `, council ${input.council}` : ""}):`,
        `${candidates.length} candidate(s). Estimated total annual uplift: ${aud(totalUplift)}; 3-year arrears window: ${aud(totalArrears)}.`,
        ``,
        ...lines,
        trailer,
        ``,
        `Use generate_evidence_pack with an assessment number to produce the council-grade reclassification case file.`,
    ].join("\n");
    return {
        ok: true,
        output: text,
        data: { candidates: [...candidates] },
        mutated: false,
    };
}
/** `generate_evidence_pack` — composed over `buildEvidencePack`. */
export async function generateEvidencePackHandler(input, ctx) {
    const result = buildEvidencePack(input.assessmentNumber, ctx.evaluationContext, {
        now: ctx.now,
    });
    switch (result.kind) {
        case "no_property":
            return notFound(`No property with assessment number "${input.assessmentNumber}".`, ctx.correlationId);
        case "no_signals":
            return {
                ok: true,
                output: `No signals fired against ${input.assessmentNumber} — no evidence pack required.`,
                data: { kind: "no_signals", property: result.property },
                mutated: false,
            };
        case "no_owner":
            return {
                ok: true,
                output: `${input.assessmentNumber} has signals but no resolvable owner of record. Reconcile the rating system before drafting a reclassification notice.`,
                data: { kind: "no_owner", property: result.property },
                mutated: false,
            };
        case "ok": {
            const pack = result.pack;
            return {
                ok: true,
                output: pack.markdown,
                data: {
                    packId: pack.packId,
                    generatedAt: pack.generatedAt,
                    severity: pack.candidate.severity,
                    compositeScore: pack.candidate.compositeScore,
                    candidate: pack.candidate,
                },
                mutated: false,
            };
        }
        default:
            // Exhaustive — the discriminated union has no other variants.
            return {
                ok: false,
                code: "internal_error",
                error: "unhandled evidence pack outcome",
                correlationId: ctx.correlationId,
                retryable: false,
            };
    }
}
/** `recovery_summary` — aggregate stats across the candidate set. */
export async function recoverySummaryHandler(input, ctx) {
    const candidates = findMismatches(ctx.evaluationContext, {
        ...(input.council !== undefined ? { council: input.council } : {}),
    });
    const stats = recoveryStats(candidates);
    const scope = input.council ? `council ${input.council}` : "all councils";
    const text = [
        `Recovery summary — ${scope}`,
        ``,
        `Total candidates: ${stats.total}`,
        `  High: ${stats.bySeverity.high}`,
        `  Medium: ${stats.bySeverity.medium}`,
        `  Low: ${stats.bySeverity.low}`,
        ``,
        `Estimated annual uplift: ${aud(stats.totalUpliftAud)} (high-severity only: ${aud(stats.highSeverityUpliftAud)})`,
        `Estimated 3-year arrears: ${aud(stats.totalArrears3yAud)}`,
        `Total recovery opportunity (uplift + arrears): ${aud(stats.totalRecoveryAud)}`,
        ``,
        `Top contributing signals: ${Object.entries(stats.signalCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([id, n]) => `${id}×${intAu(n)}`)
            .join(", ") || "(none)"}`,
    ].join("\n");
    return {
        ok: true,
        output: text,
        data: { stats, candidates: [...candidates] },
        mutated: false,
    };
}
/** `get_tenement_for_property` — list tenements that intersect one assessment. */
export async function getTenementForPropertyHandler(input, ctx) {
    const property = ctx.store.getProperty(input.assessmentNumber);
    if (property === undefined) {
        return notFound(`No property with assessment number "${input.assessmentNumber}".`, ctx.correlationId);
    }
    const tenements = ctx.store.tenementsForAssessment(input.assessmentNumber);
    if (tenements.length === 0) {
        return {
            ok: true,
            output: `No mining tenements intersect ${input.assessmentNumber}.`,
            data: { assessmentNumber: input.assessmentNumber, tenements: [] },
            mutated: false,
        };
    }
    const lines = tenements
        .map((t) => [
        `${t.tenementId} — ${tenementTypeLabel(t.type)}`,
        `  Status: ${t.status} | Holder: ${t.holder} (ABN ${t.holderAbn ?? "—"})`,
        `  Commodity: ${t.commodity.join(", ")}`,
        `  Granted: ${t.grantedDate} | Expires: ${t.expiryDate}`,
        `  Area: ${intAu(t.areaHectares)} ha | Producing: ${t.isProducing ? "yes" : "no"}${t.lastWorkProgramYear !== null
            ? ` | Last work program: ${t.lastWorkProgramYear}`
            : ""}`,
    ].join("\n"))
        .join("\n\n");
    return {
        ok: true,
        output: `Tenements intersecting ${input.assessmentNumber}:\n\n${lines}`,
        data: { assessmentNumber: input.assessmentNumber, tenements: [...tenements] },
        mutated: false,
    };
}
//# sourceMappingURL=recovery.js.map