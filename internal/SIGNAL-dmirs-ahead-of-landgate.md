# Signal: DMIRS ahead of Landgate cadastre

`reg.dmirs_ahead_of_landgate` — the headline detection signal of RatesAssist. Weight: 0.50. Category: register. No exclusive group: stacks additively with every other signal.

## The product insight

WA mining tenements are issued by DMIRS and appear on MINEDEX / SLIP the same day the grant is registered. The Landgate cadastre — the authoritative landuse layer councils consume to drive rates classification — is updated on a separate cadence, refreshed every few weeks to several months depending on the council and the parcel's geometry. Between those two events sits a **lag window**: a parcel that is, on the ground, a producing mining lease, while the rating system still classifies it as Rural / Vacant / Pastoral.

The signal fires inside that window. The opportunity is concrete: the council can lawfully reclassify the parcel under s.6.81 of the WA LG Act with three years of backdated arrears, and our system is the only place that surfaces every such parcel automatically.

## Cross-register join

1. **DMIRS side.** `fetchRecentlyGrantedTenements` queries SLIP Industry_and_Mining/MapServer/3 with `tenstatus='LIVE' AND grantdate >= TIMESTAMP '<watermark>'`. Returns typed `GrantedTenement` rows with raw `tenid`, MINEDEX deep-link, and grant date.
2. **Landgate side (public proxy).** The SLIP public-tier cadastre is `(No Attributes)` — only OBJECTID + geometry. The closest public layer that carries parcel-scale landuse is DPIRD's *Generalised agricultural land use of Western Australia* (`Farming/MapServer/7`), which exposes a `land_use` field with the enum {Viticulture, Livestock grazing, Arid Interior, Forestry plantations, No production, Pastoral - Sheep and goats, Dairy, Perth Metropolitan Area, Horticulture, Cropping - Cereals and legumes, Conservation, Pastoral - Cattle}. We treat it as the public proxy for Landgate's classification.
3. **Join.** Each (tenement, parcel) pair is bbox-intersected. Polygon-precise intersection is a Phase-2 PostGIS upgrade; bbox is a strict superset and over-flagging surfaces officer-review candidates rather than auto-acting on them.
4. **Predicate.** Fire when `parcel.landuseCategory ∉ {mining, crown, conservation}` AND `tenement.type ∈ {M, G, L}`. Pastoral leases are excluded — councils have no general-rate reclassification basis on pastoral tenure.

## Severity heuristic

| Tenement type | Parcel landuse        | Hint     |
|---------------|-----------------------|----------|
| M (Mining Lease) | residential / rural | **high** |
| M             | vacant                | medium   |
| G (General-Purpose) | rural / vacant   | medium   |
| L (Miscellaneous)   | rural / vacant   | medium   |
| anything else surfaced | —              | low      |

`high` and `medium` cause the signal to fire in `evaluateSignals`; `low` is held back to avoid noisy alerts on exploration-adjacent edge cases (these still surface on the lag-window report under `--min-severity low`).

## Lag-window math

`lagDays = floor((now − grantDateMs) / 86 400 000)`. Reported in the evidence string ("Cadastre lag: N days"), surfaced as an amber badge in the UI, and graphed on the per-property evidence panel.

## Limitations

- **DPIRD refresh cadence.** DPIRD's landuse layer refreshes approximately twice per year. The lag we measure therefore conflates true reclassification lag with DPIRD's own refresh delay. The signal stays conservative: officers always confirm via Nearmap or site visit before issuing a reclassification notice.
- **Pastoral and Crown tenure.** Excluded by construction. False suppression on a pastoral lease that has been excised into mining tenure will be addressed when the Landgate restricted-tier cadastre (PIN + LOT/PLAN) becomes available to the platform.
- **Bbox-not-polygon intersection.** Over-includes a small number of near-adjacent parcels. The Phase-2 PostGIS join replaces it.
- **Public-tier-only.** The Landgate Locate deep-link uses centroid coordinates because the public DPIRD layer has no `pin` or `lot_plan` to embed in a search URL.

## Honest source labelling

The `LagFetchResult.source` discriminator is `live` only when both DMIRS grants and DPIRD landuse responses came from real upstream features. Cache-only paths return `cache`. Any seeded fallback — grant side, landuse side, or both — degrades the tag to `seeded`, and the `note` field discloses which side fell back.
