# RatesAssist — Edge Data Strategy

Date: 2026-06-04 · Source: deep-research harness (`wf_f17a3f25-0f7`, 106 agents, 24 sources fetched, 110 claims,
25 adversarially verified). **Honesty note:** the verify phase hit a tooling glitch on ~15 claims (they ABSTAINED,
not refuted) — so per-state mining + premium-imagery specifics are **UNRESOLVED, not disproven**, and flagged for a
second focused pass. The Geoscape / G-NAF / NSW-VG / QLD-QSpatial findings passed clean 3-0 verification.

---

## The headline: the edge is Geoscape **Buildings**

The single highest-leverage source found — **Geoscape Buildings** (national, all 8 states, ~16–18M buildings,
refreshed QUARTERLY). Per *building* it carries: footprint polygon, **area + volume**, eave/roof height,
**roof colour/material/type**, **solar-panel indicator**, **swimming-pool indicator**, **planning zone**, meshblock.

Why it's the edge for *us specifically*: our whole thesis is detecting parcels rated rural/vacant/under-improved
that actually have value. A parcel the rates roll calls "vacant" that Geoscape shows has **a building + a pool + solar
panels** is a near-automatic recovery flag — nationally, refreshed quarterly, with quarter-over-quarter **change
detection** built in. No competitor relying on the rates roll alone sees this. **It's PAID (Geoscape commercial
licence; pricing not independently verified → get a quote).** *(verified 3-0)*

---

## Ranked opportunities (edge value vs effort/cost)

| # | Source | Edge | Cost | Build | Verified |
|---|---|---|---|---|---|
| 1 | **Geoscape Buildings** | building/pool/solar/roof per parcel nationally → the mis-classification goldmine | **PAID** (quote) | adapter, after contract | ✅ 3-0 |
| 2 | **G-NAF** (national address file) | free national address spine to join cadastre↔valuation↔buildings↔business | **FREE** (CC BY 4.0 + mail/APP caveat) | adapter now | ✅ 3-0 |
| 3 | **Geoscape National Cadastre + Property** | all-8-states parcels, **MONTHLY** (vs annual) — one layer, not 8 | **PAID** (quote) | adapter, after contract | ✅ 3-0 |
| 4 | **NSW Valuer-General bulk land values** | free monthly per-LGA land-value CSVs → NSW value-change recovery targeting | **FREE** (CC BY 4.0; email for bulk) | adapter now | ✅ 3-0 |
| 5 | **Geoscape Planning + Planning Insights** | zone code + permitted/prohibited uses joinable to cadastre → zoning-vs-rating mismatch | **PAID** (add-ons) | adapter, after contract | ✅ 3-0 |
| 6 | **QLD QSpatial** (cadastre/land/mining/imagery WMS) | extends detection into QLD via live WMS (like our WA SLIP pattern) | **FREE** WMS | adapter now | ✅ 3-0 |
| 7 | **CER small-scale solar postcode data** | free solar-install counts → improvement signal competitors ignore | **FREE** | adapter now | source found |
| 8 | **NSW ePlanning DA API** | development-application feed = *leading* indicator of new improvements | **FREE-ish** API | adapter now | source found |
| 9 | **Vicmap Planning zones / ABARES land use** | free VIC zoning + national land-use classification → mismatch signals | **FREE** | adapter now | source found |
| 10 | **Digital Earth Australia (DEA)** OWS | free national satellite + change products (clearing, water, built-up) | **FREE** OWS/WMS | adapter now | source found |

**Premium change-detection imagery** (Nearmap AI / MetroMap Insights / Planet / Maxar) — the auto-detect-new-structures
imagery edge — came back **UNVERIFIED** (verify glitch). Needs the 2nd pass + a contract. MetroMap Insights *claims*
AI feature-extraction (buildings/pools/solar/trees) + temporal change detection AU-wide — if it holds, it overlaps
Geoscape Buildings and is worth a bake-off.

---

## The honest truth about "live data"

**There is no true real-time push/webhook feed for AU cadastre/valuation/tenements.** The freshness ceiling for the
authoritative sources is **monthly (cadastre/property/land-values) to quarterly (buildings/planning)** — batch file or
WMS republication. So "live data flowing in" realistically means:
1. **Live map serving** — WMS/WMTS tiles served in real time at the *latest published* vintage (this is what "zoom
   right in" + fresh overlays actually is). ✅ buildable now.
2. **Frequent polling + change-delta** — poll OGC/REST on a schedule, diff against last ingest (the ArcGIS
   *Extract Changes* pattern), surface only what moved. As close to "live" as the data gets.
3. **Leading indicators** — DA approvals + solar installs change *faster* than the rates roll, so they're our
   earliest signal of an improvement before the cadastre/valuation catches up.

I'd rather tell you the ceiling now than sell you a real-time feed that doesn't exist in this domain.

## Two things that need YOU (queued)
- **Geoscape quote** (Buildings + National Cadastre/Property + Planning Insights) at government scale — the #1 edge,
  cost unknown. → `Q-edge-geoscape`.
- **Premium imagery decision** (Nearmap AI upgrade vs MetroMap Insights vs Planet) — bake-off after the 2nd research
  pass confirms specifics + cost. → `Q-edge-imagery`.

## What the loop builds next (reversible, no contract needed)
- **E0b — 2nd research pass** on the unresolved gaps: per-state mining registers (QLD GeoResGlobe, NSW MinView, SA
  SARIG, VIC, NT) + premium imagery change-detection — the verify glitch left these open.
- **E5a — national data-source registry + free-adapter pattern**: a clean adapter interface (like the DMIRS/Landgate
  clients) + the first concrete FREE adapters (NSW VG land values, CER solar, QLD QSpatial WMS) feeding new recovery
  signals — graceful fallback, tests, tenant-scoped. Proves the pattern; the paid ones slot in after contract.
- **E2 — mapping**: wire the new free WMS overlays (QLD/VIC/NSW) into the map with deep-zoom + the imagery ladder.

---

## E0b findings — the gaps, RESOLVED (2026-06-04, focused pass)

The first verifier glitched on these; this bounded pass confirmed concrete endpoints. **Headline: we can extend
mining-tenement mis-classification detection to QLD + SA + NSW + VIC with FREE OGC services — mirroring our existing
WA DMIRS/SLIP pattern — and get free national satellite change from DEA.**

### Per-state mining registers (the WA DMIRS pattern, extended) — buildable now, FREE
| State | Source | Endpoint (confirmed) | Licence / freshness |
|---|---|---|---|
| **SA** | SARIG Mineral Tenements | WMS `https://services.sarig.sa.gov.au/vector/mineral_tenements/wms` · WFS `…/wfs` | **CC BY 3.0 AU (free)**; "as needed" + DAILY generated files. Current + historic, Mining Act 1971. **Best-confirmed — build first.** |
| **QLD** | Qld mining & exploration tenure series (data.qld.gov.au) | WMS `https://spatial-gis.information.qld.gov.au/arcgis/services/Economy/MinesPermitsCurrent/MapServer/WMSServer` | Open Data Portal (open licence); SHP/TAB/FGDB/KMZ/GPKG. MDL/claims/leases. (Caveat: DCDB cadastre updates ceased Apr-2026 — tenure series separate.) |
| **NSW** | MinView / SEED — NSW Exploration & Mining Titles | WFS + WMS + CSV (GeoServer), via datasets.seed.nsw.gov.au | "Check licensing conditions" — some layers may need permission. Current + historic titles + applications. |
| **VIC** | GeoVic / data.vic — Current Mining Licences & Leases + Mineral Exploration Licences | data.vic.gov.au datasets (KML/Excel; WFS/WMS endpoint to confirm) | Open data; GeoVic is the viewer. Endpoint needs one more confirm. |

### Imagery / change detection
- **Digital Earth Australia (DEA)** — **FREE**, national. OWS confirmed `https://ows.dea.ga.gov.au/` (WMS/WMTS/WCS),
  Landsat + Sentinel-2 archive + change products, also AWS S3. → free national satellite + change overlay, buildable now.
- **MetroMap Insights (Aerometrex)** — **CONFIRMED** the imagery edge: AI feature extraction across ALL of Australia —
  **buildings, swimming pools (incl. covered/empty/dirty), solar arrays (with CSV + address), trees, grass, driveways**
  as GIS polygon layers, PLUS **temporal change detection** ("building approvals vs actual"). API access; **pricing is
  custom (not public)**. → This is a direct imagery-based alternative/complement to Geoscape Buildings for the
  mis-classification signal. Strengthens `Q-edge-imagery` — worth a real bake-off vs Geoscape Buildings on cost+coverage.

### Updated build priority (free, decision-independent → E5)
1. **SA SARIG** mining WFS/WFS (free CC BY, endpoints confirmed) — extends mining detection to SA, mirrors WA DMIRS exactly.
2. **DEA** OWS WMS overlay (free national satellite/change) — map + change signal.
3. **QLD** tenure WMS — extends mining detection to QLD.
4. **NSW** MinView WFS (licence-check) + **VIC** (confirm endpoint).
The paid edge (Geoscape Buildings vs MetroMap Insights) is a Brodie bake-off → `Q-edge-geoscape` + `Q-edge-imagery`.
