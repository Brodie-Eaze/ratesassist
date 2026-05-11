# Landgate restricted-tier — access pathway

> Status: internal planning doc. RatesAssist does not currently hold a
> direct Landgate restricted-tier subscription. Production wiring
> consumes the council's already-licensed Landgate data via the
> rating-system adapter (TechOne CiAnywhere export). This doc exists
> so we know the direct pathway when a council asks (e.g. unwired-council
> demos) and so the cost picture is honest.

## 1. The data products RatesAssist actually needs

Western Australian Land Information Authority (Landgate) publishes WA's
authoritative cadastre. The restricted-tier products we depend on:

- **LGATE-002 — Cadastre With Attributes.** The headline. Each parcel
  carries a stable **Property Identifier Number (PIN)**, lot/plan,
  address, area in m², and the parcel's current **RPDLU landuse code**.
  This is the dataset our `addressDiscrepancy` classifier and the
  `reg.address_mismatch_landgate` signal read.
- **Notations on Title.** Interests, encumbrances, and — critically —
  mining-tenement notations. Tells us when DMIRS has granted a tenement
  but the parcel's title hasn't been updated (the cadastre-lag window).
- **Landuse Codes (RPDLU / LANDUSE\_CODE).** Landgate's numeric landuse
  classification (e.g. `211` residential, `513` industrial mining
  infrastructure, `523` mining production lease). The single most
  important attribute we cross-reference against the council's
  `landUse` string.
- **Property Sales Information (PSI).** Recent sale records. Useful for
  valuation sanity-checks and for catching ownership turnover that
  hasn't propagated to the council's rating roll.
- **Geocoded Addressing Service (GAS).** Address → coordinate +
  parcel-id resolver. Powers reliable property lookups when only an
  address is on hand.
- **Subdivisions / new-title events.** Push-style notifications when a
  parent lot is split. Drives the `subdivision` discrepancy class.

## 2. Access pathway

There are four routes; we prefer them in roughly this order.

1. **Council-as-licensee, RatesAssist-as-subcontractor.** Most WA
   councils already license Landgate data under the **Government
   Information Licence Framework (GILF)**. RatesAssist, as a contracted
   service provider, can use the council's existing licence under
   GILF's "approved subcontractor" provisions. This is the dominant
   pathway and the only one we use for production tenants today.
2. **Landgate Customer Service — direct subscription.** Email
   `customerservice@landgate.wa.gov.au` or phone **(08) 9273 7373** to
   initiate a commercial / government data subscription. Required for
   unwired councils or for sales-cycle demos where we need to show
   live Landgate data before a TechOne adapter is in place.
3. **Locate Data Portal — `landgate.wa.gov.au/locate`.** Self-serve
   API access to a curated subset (cadastre lookups, address
   geocoding, basic PSI). Priced per-record for low-volume callers and
   on a subscription tier for systematic consumers.
4. **MOU + Data Supply Agreement (DSA).** For high-volume systematic
   consumers Landgate requires a signed DSA on top of the standard
   licence. Typical onboarding is **6–12 weeks** including legal
   review, data-handling controls (storage, access, retention) and
   the WA Information Commissioner privacy review where personal
   information is in scope.

For AU-government and council-aligned use cases the **WA Spatial
Information Strategy** + the **SLIP Enhanced subscription tier** can
unlock discounted or no-fee access to selected products. We will
evaluate SLIP Enhanced once a third paying council signs.

## 3. Cost estimates (best-effort, published rates as at May 2026)

Landgate does not publish a single retail price-list — many products
are "by negotiation". The figures below are the indicative bands we
have collected from Locate documentation, council procurement records,
and conversations with two existing Landgate consumers.

| Product                              | Indicative cost                            | Notes                                                                                |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Locate API — per-record query        | $0.10–$0.40 / record                       | Sliding scale by volume; sub-1,000-call/month is at the high end.                    |
| Full cadastre subscription           | $18,000–$45,000 / yr                       | WA-wide; smaller LGAs pay the lower end. Typical WA council pays **$22–28k/yr**.     |
| Property Sales Information (PSI)     | $6,000–$12,000 / yr                        | Annualised. Often bundled with cadastre.                                             |
| Notations on Title (LGATE-002 addon) | Bundled in full cadastre subscription      | Standalone unavailable.                                                              |
| Geocoded Addressing Service (GAS)    | $0.02–$0.05 / call (subscription tier)     | Per-call. Free tier exists for <2,000 calls/month.                                   |
| MOU/DSA legal review                 | $0 (Landgate-borne) + ~30–60 person-hours  | Counted against the consumer's onboarding budget.                                    |

Where published rates aren't available we use the band-language above
in customer-facing material rather than fabricating point figures.

## 4. Integration interface

The TypeScript interface for restricted-tier Landgate calls lives at
`packages/spatial/src/landgateRestricted.ts`. The default factory
throws "Landgate restricted-tier not configured" with a pointer back
to this doc — we will not call Landgate from RatesAssist's own
infrastructure unless and until a council asks for it and a DSA is in
place.

A mock implementation in `packages/spatial/src/__fixtures__/landgateMock.ts`
returns ten plausible parcels covering Tom Price, Karratha, Newman,
Kalgoorlie, Meekatharra, Onslow and Pannawonica. The mock is used by
tests and by the demo path; production callers swap a real client at
the adapter layer.

```ts
import { createLandgateClient } from "@ratesassist/spatial";

// Default — throws on every call; tells the caller to read this doc.
const client = createLandgateClient({});

// With credentials — currently throws "live transport not implemented";
// the adapter layer is responsible for wiring a real transport.
const live = createLandgateClient({ apiKey: process.env.LANDGATE_API_KEY });
```

## 5. Honest caveats

- **We will not negotiate Landgate access directly for the average
  council.** Councils consume Landgate through their existing
  rating-platform vendors (TechOne, Synergysoft, Civica). RatesAssist's
  primary path to Landgate-derived data is the rating-system adapter —
  the council's data, surfaced via their licence. The direct-Landgate
  pathway exists only for unwired-council demos and for the small
  number of councils that ask us to broker the relationship.
- **Cost figures above are indicative.** Confirm in writing before
  quoting a council. Landgate's pricing is heterogenous and revised
  periodically; the figures here are point-in-time.
- **Subcontractor provisions are not automatic.** GILF requires the
  council to nominate RatesAssist as an approved subcontractor in
  writing before any sub-licensed data flows. This is a one-page
  letter from the council to Landgate; we ship a template at
  `internal/outreach/LANDGATE-SUBCONTRACT-LETTER.md` (TODO if not
  already present).
- **No personal information leaves the council tenant boundary.**
  Notations-on-title sometimes carry rate-payer name; RatesAssist
  treats those as tenant-private and never cross-publishes them in
  the cross-council benchmark pool.

## 6. Open follow-ups

- Confirm Locate Data Portal per-record price with Landgate Customer
  Service. Current band is from publicly-cached pricing as at 2025-Q3
  — refresh when the next pilot signs.
- Decide whether to pursue SLIP Enhanced membership ourselves or
  continue piggy-backing on council licences.
- Draft a one-page subcontractor letter template (see caveat above).
