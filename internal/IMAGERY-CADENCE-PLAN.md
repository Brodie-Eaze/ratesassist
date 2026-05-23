# Imagery cadence — RatesAssist competitive moat

> "We need a better satellite image. How can we get daily updates or every-other-day? That's our edge."
> — Brodie, 2026-05-23

This doc maps the imagery layers we have today, the ones we're plugging in
next, and the commercial path to **daily 3 m** coverage that no Australian
council currently has against their TechOne rating roll.

## Current state (live in production)

| Layer | Source | Resolution | Cadence | API key? | Status |
|---|---|---|---|---|---|
| `hybrid` / `satellite` | Esri World Imagery | 30 cm composite | **1–3 years** | no | live |
| `sentinel` | EOX s2cloudless 2024 | 10 m | **annual composite** | no | live |
| `sentinel-latest` | Esri Living Atlas Sentinel-2 L2A | 10 m | **~14 days** | no | **shipping now** |
| `slip-aerial` | Landgate SLIP (WA) | 7.5 cm | 6–12 months metro | no (probe-gated) | live |

Default basemap is now **`sentinel-latest`** — clerks land on imagery that
is typically less than a fortnight old. The yearly composite is one click
away as the wet-season cloud-cover fallback.

## Why this matters (the moat)

Councils today buy stale imagery from Nearmap (quarterly metro) or rely on
Landgate aerial (annual or worse outside metro). The window between an
event happening on a property and the council seeing it is **6–18 months**.
That is where rates revenue leaks out:

- A mining tenement intersects a property; council still rates it as
  pastoral until the next survey.
- A subdivision splits a lot; council still bills the parent.
- A new shed / tank / clearing on a rural lot changes the GRV; clerks
  never see it.

Closing that window to **<14 days for free** and **<24 hours for paid**
moves RatesAssist from "smart audit tool" to "the only system that sees
the change before the cheque is missed." That is the moat.

## Layer roadmap

### Tier 0 — shipped today (this commit)
- `sentinel-latest` basemap (Esri Living Atlas, ~14-day cadence, 10 m).
- "Imagery currency" badge per basemap (live / recent / static).
- CSP updated for `sentinel.arcgis.com`.

### Tier 1 — Sentinel-2 daily via Sentinel Hub (free pilot tier)
- Sign up at https://www.sentinel-hub.com/ for the free 30k-PU/month tier.
- Create an OAuth client; store `SENTINEL_HUB_CLIENT_ID` /
  `SENTINEL_HUB_CLIENT_SECRET` as Railway env vars.
- New package `@ratesassist/imagery-sentinel-hub`:
  - `fetchLatestScene(bbox, maxCloud=20)` — Process API call returning
    the freshest cloud-free L2A scene for an AOI.
  - `fetchNDVI(bbox, dateRange)` — Statistical API for vegetation index
    timeseries.
- Daily cron `scripts/sentinel-change-detection.ts`:
  - For each property in scope, fetch yesterday's NDVI vs the rolling
    90-day baseline.
  - If NDVI delta > threshold → fire `change.vegetation_loss` signal
    (new register-level signal, weight 0.4).
  - If new high-reflectance polygon > 50 m² appears → fire
    `change.new_structure` signal (weight 0.5).
- New PropertyMap layer: "Vegetation change" overlay with date slider
  for the last 12 scenes.

### Tier 2 — Planet PlanetScope daily 3 m (paid, the differentiator)
- Apply to Planet's **Education & Research Program** for a 30-day free
  pilot covering one LGA (see `outreach/planet-pilot.md`).
- Negotiated annual: target **AUD $15–30k/council/yr** for a daily 3 m
  AOI. At 5+ councils, target $8–12k per council.
- Pass-through pricing or absorbed at scale.
- Integration: Planet Tile API → new `planet-daily` basemap key. Auth
  is per-API-key (each council gets its own scoped key).

### Tier 3 — Planet SkySat tasked 50 cm (on-demand)
- Targeted captures for high-value audits ($20–50 / km² per pass).
- Wire via the Planet Tasking API: a "Request high-res capture" button
  on a candidate's evidence pack lodges a tasking order.
- Use for the **top decile** of recovery candidates only — economics
  break otherwise.

## Why this isn't a "build it, they will come" play

The technical layer is the cheaper half. The harder half is **getting
the Planet contract and the council MoU lined up at the same time**, so
the pilot launch lands with daily imagery already in production. The
demo flow is:

1. Council CFO opens RatesAssist on their browser.
2. They click on a property in the Recovery list.
3. The map opens on Sentinel-2 Live (≤14 days).
4. They flip to Planet Daily (≤24 hours) and see a new shed that
   appeared since the last valuation.
5. They click "Request 50 cm capture" → SkySat task lodged → 50 cm
   image lands the next day.

No competitor in the AU council vertical can run that workflow today.

## Open items
- [ ] Brodie: register at sentinel-hub.com (free tier, 5 min).
- [ ] Brodie: send Planet pilot application (`outreach/planet-pilot.md`).
- [ ] Claude (next session): wire `@ratesassist/imagery-sentinel-hub`
      once credentials land.
- [ ] Claude (next session): daily change-detection cron + 2 new
      register signals.
- [ ] Claude (next session): "Imagery time-slider" PropertyMap control.
