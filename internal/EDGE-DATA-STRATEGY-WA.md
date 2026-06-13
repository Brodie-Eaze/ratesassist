# RatesAssist — WA Edge Data Strategy (Western Australia ONLY)

Date: 2026-06-04 · Source: deep-research re-run (`wf_78781590-89f`, 110 agents, 28 sources, 97 claims).
**Confidence note:** the harness's verify step hit a tooling glitch — every claim got a 0-0 *abstention* the harness
mislabels as "refuted/killed." So these are **primary-sourced but un-cross-verified** (all citations are official
Landgate / data.wa.gov.au pages). Treat as **high-signal leads — confirm the specific access tier + cost before
committing money/contract**, not as audited fact. The TechOne question did NOT resolve (vendor pages were low-quality).

---

## THE answer: the recovery-$ source is the Landgate **Client Portal** valuation roll
**`val.clientportal.landgate.wa.gov.au`** — the channel through which **rating authorities (councils) receive
parcel-level GRV + UV valuations** from the Valuer-General, delivered as **CSV / LIS / PDF**, searchable by VEN or
property address. Replaces the legacy ValSys Online; delivers **1M+ rating/taxing valuations a year.** A council *is*
a rating authority, so **the parcel-level valuation the recovery-$ calc needs already arrives at the council as a CSV
roll** — the platform ingests that (or a council export of it), it doesn't have to buy it parcel-by-parcel.
> `recovery $ = (correct basis − current basis) × rate-in-the-dollar` — and the basis (GRV/UV) is in that CSV.

Per-parcel **verification/spot-check**: Landgate **Valuation Extract reports — $9.90 each** ($21.40 certified),
returning the latest **3 GRV/UV figures + their valuation dates** (exactly the delta + date series for a recovery calc).
Free GRV/UV statistics are **aggregate per-LGA only** — not parcel-level. **UV is reassessed ANNUALLY** (valuation date
1 Aug prior year — correcting the earlier "3-6yr" assumption; GRV is the multi-year cycle). Pastoral leases, mining
tenements + Crown leases are valued on **UV** under special statutory formulas → confirms producing-mine + mining-on-
pastoral parcels are UV-rated.

## ⚠ Critical correctness finding (saves a wrong build)
Do **NOT** build mining-on-Crown / pastoral mis-classification on the cadastre **`land_type`** attribute. The SLIP
Cadastre data dictionary explicitly warns `land_type` (CROWN/FHOLD/EASMT) is only the **subdivision Act the lot was
created under — NOT current tenure/ownership.** A CROWN lot can be freehold; freehold can be State-owned. Real tenure
lives in the **separate SLIP Tenure layer (LGATE-226)**, linked via `polygon_number`/`land_id`. Any naive land_type
logic would generate false recoveries.

## The ranked WA opportunities (edge vs effort/cost)
| # | Source | What it gives | Cost | Build |
|---|---|---|---|---|
| 1 | **Landgate Client Portal roll (CSV)** | parcel GRV+UV — the recovery-$ basis | council already has it (or data-share) | ingest CSV |
| 2 | **MINEDEX (DMIRS-001)** | producing **mine sites** (not just tenements), **daily** refresh, WFS/WMS/REST + CSV/GeoJSON | **FREE** | adapter now |
| 3 | **Valuation Extract $9.90** | per-parcel GRV/UV + dates (verify/spot-check) | ~$9.90/parcel | API/manual |
| 4 | **Pastoral Stations DPLH-083** | UV-rated pastoral/Crown leases (mining-on-pastoral) | **FREE** (Open WMS/ArcGIS + login bulk) | adapter now |
| 5 | **SLIP Tenure LGATE-226** | real tenure + owner name (privacy-restricted) | **PAID** (Personal Use Licence) | queue |
| 6 | **Cadastre (Land) LGATE-218** | full-attribute cadastre (vs your no-attr LGATE-001), WMS+WFS | **PAID** (SLIP subscription) | queue |
| 7 | **Landgate Imagery / Capture WA / LiDAR (LGATE-351)** | WA-captured aerial+satellite+elevation; change detection | free/subscription | overlay |
| 8 | **TechOne CiAnywhere valuation fields** | the in-council GRV/UV+rate — *unresolved by research* | n/a | confirm directly |

**Single best recovery-$ source: the Client Portal CSV valuation roll (the council's own).** Everything else sharpens
*which* parcels to flag; the roll is what turns a flag into a dollar.

## Build-now (FREE, decision-independent) vs queue (paid/licensed)
- **Build now:** MINEDEX producing-status adapter (free, daily, API — the strongest free signal + as "live" as WA gets);
  Pastoral Stations DPLH-083 overlay+adapter (free); Landgate imagery/LiDAR overlays.
- **Queue for Brodie (paid/licensed):** SLIP Tenure LGATE-226 (owner/tenure — PII licence + privacy review),
  Cadastre LGATE-218 (subscription), and the **valuation-roll ingestion path** (confirm: does the pilot council give us
  their Client Portal CSV export, or do we arrange a Landgate data-share? + does their TechOne expose it via API/OData?).

## Sources (all primary)
Landgate: new-valuation-system · valuation-extracts-reports · grv-and-uv-statistics · unimproved-value · tenure-data ·
slip-cadastre-data-dictionary-v1.7.pdf · slip-tenure-data-dictionary.pdf · aerial-imagery · satellite-imagery · capture-wa · lidar.
data.wa.gov.au: cadastre-land (LGATE-218) · land-tenure-226 · minedex-dmirs-001 · pastoral-stations-dplh-083.
