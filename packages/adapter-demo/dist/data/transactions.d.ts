/**
 * Seeded transaction history for the demo adapter.
 *
 * Keyed by assessment number. Only properties with notable transaction
 * histories carry entries — the bulk of the synthetic portfolio has no
 * recorded transactions, which the `get_transaction_history` handler
 * surfaces as an honest empty result rather than fabricating data.
 */
import type { Transaction } from "@ratesassist/contract";
/**
 * The full transaction map. Frozen at the outer level; per-assessment
 * arrays are also frozen so callers cannot accidentally mutate the seed.
 */
export declare const TRANSACTIONS: Readonly<Record<string, readonly Transaction[]>>;
//# sourceMappingURL=transactions.d.ts.map