/**
 * Shared formatting helpers used across handlers.
 *
 * Centralised so AU locale + currency formatting is consistent for every
 * user-facing string the adapter emits.
 */
/**
 * Format an amount as Australian dollars, rounded to the nearest dollar.
 * The contract's monetary fields are whole-dollar; if a callsite ever has
 * cents to display it should construct its own formatter.
 */
export declare function aud(amount: number): string;
/** Format an integer with AU locale thousands separators. */
export declare function intAu(n: number): string;
/** Format a 0..1 score as e.g. `"87%"`. */
export declare function pct(score: number): string;
/** ISO-8601 calendar date in UTC, e.g. `2026-05-08`. */
export declare function isoDate(d: Date): string;
//# sourceMappingURL=format.d.ts.map