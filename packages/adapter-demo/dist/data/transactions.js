/**
 * Seeded transaction history for the demo adapter.
 *
 * Keyed by assessment number. Only properties with notable transaction
 * histories carry entries — the bulk of the synthetic portfolio has no
 * recorded transactions, which the `get_transaction_history` handler
 * surfaces as an honest empty result rather than fabricating data.
 */
/**
 * The full transaction map. Frozen at the outer level; per-assessment
 * arrays are also frozen so callers cannot accidentally mutate the seed.
 */
export const TRANSACTIONS = Object.freeze({
    "TPS-3041-12": Object.freeze([
        { date: "2025-07-01", type: "Rates Levy", amount: 2_140, reference: "LVY-2025-26", balance: 2_140 },
        { date: "2025-08-12", type: "Payment", amount: -535, reference: "BPAY-882104", balance: 1_605 },
        { date: "2025-11-04", type: "Payment", amount: -535, reference: "BPAY-901188", balance: 1_070 },
        { date: "2026-02-04", type: "Payment", amount: -535, reference: "BPAY-918002", balance: 535 },
        { date: "2026-04-30", type: "Penalty Interest", amount: 12.5, reference: "INT-Q4", balance: 547.5 },
    ]),
    "ESH-7011-08": Object.freeze([
        { date: "2025-07-01", type: "Rates Levy", amount: 12_400, reference: "LVY-2025-26", balance: 12_400 },
        { date: "2025-09-01", type: "Adjustment", amount: -100, reference: "ARR-START", balance: 12_300 },
        { date: "2025-10-15", type: "Payment", amount: -3_100, reference: "BPAY-893221", balance: 9_200 },
        { date: "2026-01-10", type: "Payment", amount: -3_050, reference: "BPAY-910445", balance: 6_150 },
        { date: "2026-04-10", type: "Payment", amount: -3_050, reference: "BPAY-925910", balance: 3_100 },
    ]),
    "TPS-1102-44": Object.freeze([
        { date: "2025-07-01", type: "Rates Levy", amount: 1_820, reference: "LVY-2025-26", balance: 1_820 },
        { date: "2025-09-01", type: "Payment", amount: -455, reference: "BPAY-885012", balance: 1_365 },
        { date: "2025-12-01", type: "Payment", amount: -455, reference: "BPAY-905880", balance: 910 },
        { date: "2026-02-28", type: "Payment", amount: -455, reference: "BPAY-919221", balance: 455 },
        { date: "2026-04-01", type: "Payment", amount: -455, reference: "BPAY-925112", balance: 0 },
    ]),
    "ASH-9911-04": Object.freeze([
        { date: "2025-07-01", type: "Rates Levy", amount: 38_200, reference: "LVY-2025-26", balance: 38_200 },
        { date: "2025-09-15", type: "Payment", amount: -9_550, reference: "EFT-COMM-118", balance: 28_650 },
        { date: "2025-12-15", type: "Payment", amount: -9_550, reference: "EFT-COMM-227", balance: 19_100 },
        { date: "2026-03-15", type: "Payment", amount: -9_550, reference: "EFT-COMM-309", balance: 9_550 },
    ]),
    "MTI-6601-33": Object.freeze([
        { date: "2025-07-01", type: "Rates Levy", amount: 8_200, reference: "LVY-2025-26", balance: 8_200 },
        { date: "2025-09-01", type: "Payment", amount: -2_050, reference: "BPAY-771101", balance: 6_150 },
        { date: "2025-11-15", type: "Payment", amount: -2_050, reference: "BPAY-790222", balance: 4_100 },
        { date: "2026-02-15", type: "Payment", amount: -2_050, reference: "BPAY-810115", balance: 2_050 },
        { date: "2026-04-15", type: "Penalty Interest", amount: 41, reference: "INT-Q4", balance: 2_091 },
    ]),
});
//# sourceMappingURL=transactions.js.map