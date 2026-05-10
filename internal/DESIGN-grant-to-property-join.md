# DESIGN: Grant -> Property spatial join

Status: design only. Implement after the in-flight "newly granted tenement" feature lands. Do not start coding until that work is merged.

## 1. Why

The in-flight feature surfaces *tenement* grant events. The user's actual product question is different: **"when does a *property* get approved for mining?"** A tenement is a polygon defined by DMIRS mineral coordinates and is not a property — it has no assessment number, no address, no rating category. The mapping from tenement geometry to the underlying parcel(s) it covers is a spatial intersection that no public registry publishes. RatesAssist is the system that computes it, and that join is what makes a grant actionable for a council rates officer.

## 2. Data sources

All three already exist in the repo; the join layers them.

- **Tenement geometry** — SLIP `Industry_and_Mining/MapServer/3` (DMIRS-003). Already integrated; see `SLIP_LAYERS.tenements` in `packages/spatial/src/slip.ts`.
- **Parcel geometry + lot/plan + address** — SLIP `Property_and_Planning/MapServer/2` (LGATE-001). Already registered as `SLIP_LAYERS.cadastre` in the same file.
- **Rating record** (assessment number, current rating category, owner) — `adapter-demo` today. TechOne / Civica adapters land in Phase 4-5 and slot in behind the same contract.

## 3. The computed event

For each recently granted tenement, emit per-parcel rows of the form:

> Parcel `<assessmentNumber>` at `<address>`, currently rated `<Rural/Vacant/...>`, intersected by newly granted tenement `<tenid>` on `<grantDate>` held by `<holder>`.

Each row carries three click-throughs:
- Tenement -> MINEDEX detail page
- Parcel -> in-app `/properties/<assessment>` route
- Grant evidence -> printable export via the existing `generate_evidence_pack` tool

## 4. Implementation outline

Once the basic grant-list ships:

1. **New contract tool** `list_grant_to_property_events(sinceDate, councilId)` — runs the spatial intersection per recent grant against the council's parcel set (data store + cadastre layer).
2. **Per (tenement, parcel) intersection** — emit a `GrantPropertyEvent` carrying the joined fields (assessment, address, rating category, tenid, grant date, holder, geometry refs).
3. **Spatial primitives** — reuse helpers in `packages/spatial`. Polygon-overlap is the right test; point-in-polygon on the parcel centroid is acceptable as a fast first pass and matches how the cadastre layer is already queried.
4. **UI** — convert `/alerts` from a tenement table into a property-event table. Tenement is shown but secondary; primary key is the parcel. Group by tenement is a view toggle, not the default.
5. **Evidence pack** — extend `generate_evidence_pack` to accept a `(tenid, assessment)` pair and render both polygons on the same map plate.

## 5. Caveats / out-of-scope

- **Spatial join cost.** Tenement polygons can intersect dozens of parcels. The demo dataset is bounded; a real council pull (10k+ parcels) needs an R-tree or PostGIS — defer to Phase 2. Not a v1 blocker.
- **Demo data.** `adapter-demo`'s tenements and parcels are synthetic; real validation needs either the `dmirs-pull` script's output or a council CSV. Note this in the alerts page until a real adapter is wired.
- **Decision support, not auto-action.** "Mining tenement granted" does not mean "rate change warranted" — council policy varies (Rural -> Mining reclass triggers, valuation timing, holder type). The event is a prompt for a rates officer, never an automated rating change.

## 6. Sequence

Immediate next task after the in-flight build agent (id `abb27172253bcf8af`) completes its grant-list feature. No source changes now.
