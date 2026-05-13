# Rate-recovery uplift formula

This is the math the recovery engine uses to convert a "this parcel is mis-rated" signal into a defensible dollar figure. Every number the platform surfaces — annual uplift, backdated arrears, total recoverable — has its inputs visible in the formula trail and its provenance visible on the rate-table source URL. The council CFO who reviews an evidence pack should be able to recompute every line by hand against the published schedule of rates.

## The WA rate formula

The Local Government Act 1995 (WA) s.6.32-6.36 lets councils strike differential rates against one of two valuation bases:

```
annual_rates = max(value × rate_in_dollar, minimum_payment) + service_charges
```

- **GRV** (Gross Rental Value) — set by the WA Valuer-General, used for non-rural categories (Residential, Commercial, Industrial, Vacant).
- **UV** (Unimproved Value) — used for rural, pastoral and mining categories.
- **rate_in_dollar** — the council's differential, expressed in cents per dollar of the valuation (e.g. 0.10254 = 10.254 c/$ of GRV). Set annually in the council's budget.
- **minimum_payment** — the floor. If `value × rate` is below the minimum, the ratepayer pays the minimum.
- **service_charges** — rubbish, ESL (Emergency Services Levy), state-government pass-throughs. These do not change on reclassification and are excluded from uplift math.

### Worked example — Lot 4412 Goldfields Highway (KAL)

| Field | Value |
|---|---|
| UV (Valuer-General) | $63,100 |
| Current rate (Rural @ 4.78c/$) | $63,100 × 0.0478 = $3,016/yr |
| Correct rate (Mining @ 23.95c/$) | $63,100 × 0.2395 = $15,112/yr |
| Annual uplift | **$12,096/yr** |
| Years since change (detected 2024-02-15, eval'd 2026-05-14) | 2.25y |
| Backdated 3y conservative | $12,096 × 2.25 = **$27,216** |
| Backdated 5y statutory (LGA s.6.81) | $12,096 × 2.25 = **$27,216** (under both caps) |
| Total recoverable | $27,216 + $12,096 = **$39,312** |

## Backdating: s.6.81

Under WA LGA 1995 s.6.81 ("rates that ought to have been imposed"), a council may issue a rates correction notice backdated up to **5 years** from when the correction is made. We surface two figures:

- **Conservative (3 years)** — the practical ceiling most WA councils self-impose because of audit and administrative friction.
- **Statutory (5 years)** — the LGA s.6.81 hard ceiling.

The engine returns both:

```
backdated_amount_conservative = annual_uplift × min(years_since_change, 3)
backdated_amount_statutory    = annual_uplift × min(years_since_change, 5)
```

A change detected within the last 3 years gives identical figures for both. A change detected 7 years ago caps conservative at 3y and statutory at 5y; the engine adds an explicit caveat to the result.

## Differential rates and why mining is 5×+ rural

Mining-class differentials are typically 4-6× the rural rate in the same shire. East Pilbara's published 2024-25 schedule, for example, ran Rural at ~4.4c/$ UV and Mining at ~23c/$ UV — a 5.2× ratio. This is the entire reason an uncorrected rural-classified mining parcel is the single highest-value recovery: every year the change persists, the council collects rural rates against UVs an order of magnitude smaller than the mining-class rates they're entitled to strike.

## GRV vs UV — when each applies

The basis is set per rate line in the council's schedule, not per property. Our calculator routes accordingly:

- A property's `correctLandUse` resolves to a rate line.
- That rate line declares its basis (`GRV` or `UV`).
- The calculator reads `property.grv` or `property.uv` accordingly. If the relevant value is missing it returns a typed error (`missing_grv` / `missing_uv`) rather than guessing.

This means a rural-to-mining reclassification on the same parcel uses the same UV against both rate lines — the change is the rate-in-dollar, not the valuation.

## Stale GRV handling

The Valuer-General revalues GRVs on a 3-year cycle (5-year in some rural shires). When a parcel has had documented physical change since the last revaluation, the rate calc is honest about the input being stale: the `change.gru_revaluation_pending` signal fires, and the evidence pack carries a caveat that the projected `correctAnnualRates` will move further once revaluation flows through.

## Rate-table provenance

Every rate line ships with:

- `councilCode` — stable internal council code.
- `financialYear` — e.g. `"2025-26"`.
- `sourceUrl` — the council's published schedule of rates URL.
- `retrievedAt` — ISO date we pulled it.
- `verified: boolean` — true only when pulled from the council's own published schedule for this financial year.
- `carriedForward: boolean` — true when figures were rolled forward from the previous FY because the current-year schedule was not retrievable.
- `note` — honest provenance string surfaced on every UI rate-breakdown card.

`verified: false` always renders in the UI as `[unverified — see caveats]` next to the source URL. We never silently use unverified numbers.

## The formula audit trail

Every `UpliftResult` carries a single `formula` string in plain English:

> Current (Rural): UV $63,100 × 4.78c/$ = $3,016 → $3,016/yr. Correct (Mining): UV $63,100 × 23.95c/$ = $15,112 → $15,112/yr. Annual uplift = $12,096/yr. Years since change: 2.25. Backdated 3y (conservative): $27,216. Backdated 5y (LGA s.6.81 statutory): $27,216.

Plus a `caveats` array (rate-table provenance, minimum-payment floors hit, statutory cap breached) and the rate table's `sourceUrl`. The evidence pack quotes both verbatim.

## Failure modes

The calculator does not throw on bad input — it returns a typed error code:

| Code | When |
|---|---|
| `no_rate_table` | Caller passed null/undefined for the table. |
| `no_rate_line` | Council has no rate line for the supplied `currentLandUse` or `correctLandUse`. |
| `missing_grv` | A GRV-basis rate line is required and the property has no GRV. |
| `missing_uv` | A UV-basis rate line is required and the property has no UV. |
| `invalid_change_date` | `changeDetectedAt` is not a parseable ISO date. |

The downstream `findMismatches` falls back to the heuristic multiplier in any of these cases and flags the candidate's `rateFormula` accordingly so the UI surfaces the gap rather than printing a fabricated number.
