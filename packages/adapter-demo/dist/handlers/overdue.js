/**
 * `list_overdue` — surface every property with an outstanding balance.
 *
 * The contract's input also carries an optional `minDaysOverdue` filter.
 * The demo dataset does not record per-instalment due dates, so we treat
 * it as the floor on a derived metric (days since `lastPaymentDate`); when
 * `lastPaymentDate` is `null`, we treat the account as exceeding any
 * positive threshold (it is overdue from rate-strike date by definition).
 */
import { aud } from "./format.js";
/**
 * Days since `lastPaymentDate`, computed against the request clock.
 * Returns `Infinity` when no last-payment is on record so the account
 * always passes a `minDaysOverdue` filter.
 */
function daysSinceLastPayment(p, now) {
    if (p.lastPaymentDate === null)
        return Infinity;
    const last = Date.parse(p.lastPaymentDate);
    if (Number.isNaN(last))
        return Infinity;
    return Math.floor((now.getTime() - last) / (24 * 60 * 60 * 1_000));
}
/** `list_overdue` handler. */
export async function listOverdueHandler(input, ctx) {
    const all = ctx.store.listOverdue(input.council);
    const now = ctx.now();
    const min = input.minDaysOverdue ?? 0;
    const filtered = min > 0
        ? all.filter((p) => daysSinceLastPayment(p, now) >= min)
        : all;
    if (filtered.length === 0) {
        return {
            ok: true,
            output: input.council !== undefined
                ? `No overdue properties for council "${input.council}".`
                : `No overdue properties at this time.`,
            data: { total: 0, totalOutstanding: 0, properties: [] },
            mutated: false,
        };
    }
    const totalOutstanding = filtered.reduce((s, p) => s + p.balance, 0);
    const lines = filtered
        .map((p) => {
        const ownerNames = ctx.store
            .ownersForProperty(p)
            .map((o) => o.name)
            .join(", ");
        const arrSuffix = p.paymentArrangement ? " (arrangement)" : "";
        return `  - ${p.assessmentNumber} | ${p.address}, ${p.suburb} | ${ownerNames || "(no owner on file)"} | ${aud(p.balance)}${arrSuffix}`;
    })
        .join("\n");
    const text = [
        `${filtered.length} overdue propert${filtered.length === 1 ? "y" : "ies"}; total outstanding ${aud(totalOutstanding)}.`,
        lines,
    ].join("\n");
    return {
        ok: true,
        output: text,
        data: {
            total: filtered.length,
            totalOutstanding,
            properties: [...filtered],
        },
        mutated: false,
    };
}
//# sourceMappingURL=overdue.js.map