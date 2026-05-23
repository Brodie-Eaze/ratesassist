# Planet Labs — Education & Research / Pilot outreach

## Target inbox
- Planet AU/NZ sales lead: `apac-sales@planet.com` (verify on
  planet.com → Contact)
- Planet Education & Research: https://www.planet.com/markets/education-and-research/
- LinkedIn: search "Planet Labs" + "Australia" + "Director, Government"

## Cold email — opening contact

> Subject: WA councils + daily PlanetScope for rates-recovery audits — pilot enquiry
>
> Hi {first name},
>
> I'm Brodie Eaze, co-founder of RatesAssist — a vertical AI product for
> Australian council rates departments. We cross-reference council
> rating rolls (TechOne CiAnywhere), DMIRS mining tenements, Landgate
> cadastre and aerial imagery to surface high-confidence revenue-recovery
> candidates. Our pilot council partner runs WA-leaning portfolios and
> currently recovers $30–50M/year manually through mis-classified
> mining/land-use overlays.
>
> Imagery is the lever where daily cadence creates a moat we can charge
> for. Today we serve Sentinel-2 L2A at ~14-day freshness (Esri Living
> Atlas) inside a Leaflet client backed by our composite-signal recovery
> engine. To go from "fortnightly" to "daily 3 m", we want to evaluate
> **PlanetScope** for one LGA (target: 5,000–15,000 km²) for a 30–60 day
> pilot.
>
> A few specifics if it helps you triage:
>
> 1. **Use case** — daily NDVI/RGB delta against rolling 90-day baseline
>    to flag vegetation clearance, new structures, mining-tenement
>    expansion. Output is a `change.*` signal on a candidate row inside
>    a council clerk's audit dashboard, not a public-facing map.
> 2. **AOI** — one of: Shire of Esperance (44,000 km²), Shire of
>    Ashburton (105,000 km², heavy mining overlap), Shire of Coolgardie
>    (30,000 km²). Final pick is the council that signs the MoU first.
> 3. **Volume** — 1 LGA, daily for 30–60 days, RGB + NIR.
> 4. **Production path** — Tile API + Data API. We have the engineering
>    side ready to wire as soon as access lands.
> 5. **Commercial path** — if the pilot proves the ROI we expect (a
>    single recovery candidate pays for the year), we're prepared to
>    contract annually at AUD $15–30k/LGA, scaling to 5+ LGAs in 12
>    months.
>
> Is there a path through Planet's Education & Research program for the
> pilot phase, or should we go straight to commercial? Happy to jump on
> a 20-min call this fortnight.
>
> Cheers,
> Brodie
> RatesAssist · brodie@amalafinance.com.au · +61 4xx xxx xxx
> Demo: https://ratesassist-web-production.up.railway.app
> Spec: https://ratesassist.com/spec (private link on request)

## Follow-up cadence
- Day 0 — send the cold email above
- Day 4 — bump in the same thread: "Just floating this back up — happy
  to wait if it's the wrong door."
- Day 10 — LinkedIn DM to the same person + cc apac-sales
- Day 20 — switch tactic: ping their Customer Success / Partnerships
  alias instead, or apply directly to Education & Research.

## Education & Research direct path
- https://www.planet.com/markets/education-and-research/ → "Apply"
- Eligibility is loose: pilots tied to research/public-sector benefit
  qualify. Frame ours as "Australian local-government revenue recovery,
  WA Pilbara/Goldfields focus, academic-partner agnostic."
- Expected access: 1 user, ~5,000 km²/day for up to 30 days.

## Specifics they will ask
- **Storage / re-distribution** — Planet imagery cannot be redistributed
  outside the licensed user. Our app shows tiles to the licensed council
  staff; tiles do not leave the council's authenticated session. This is
  legal under Planet's standard EULA.
- **Data residency** — Planet serves from US-CDN. The council screenshot
  / evidence pack is what gets archived; the live tiles are not stored
  by us. We can confirm with their legal team.
- **Replaceable with Sentinel-2?** — No. PlanetScope's daily 3 m is
  ~10× the spatial resolution and ~5× the cadence vs. free Sentinel-2.
  The audit signal we generate requires both.
