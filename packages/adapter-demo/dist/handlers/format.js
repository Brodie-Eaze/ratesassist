/**
 * Shared formatting helpers used across handlers.
 *
 * Centralised so AU locale + currency formatting is consistent for every
 * user-facing string the adapter emits.
 */
/** Cached AUD currency formatter. Reused across calls (cheap to construct, cheaper to reuse). */
const AUD = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
});
/**
 * Format an amount as Australian dollars, rounded to the nearest dollar.
 * The contract's monetary fields are whole-dollar; if a callsite ever has
 * cents to display it should construct its own formatter.
 */
export function aud(amount) {
    return AUD.format(Math.round(amount));
}
/** Format an integer with AU locale thousands separators. */
export function intAu(n) {
    return Math.round(n).toLocaleString("en-AU");
}
/** Format a 0..1 score as e.g. `"87%"`. */
export function pct(score) {
    return `${Math.round(score * 100)}%`;
}
/** ISO-8601 calendar date in UTC, e.g. `2026-05-08`. */
export function isoDate(d) {
    const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = d.getUTCDate().toString().padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}
//# sourceMappingURL=format.js.map