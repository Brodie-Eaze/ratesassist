# Feature spec — VEN + CT + Concession mismatch engine

**Status:** Locked 2026-05-15. Build phase starting.
**Owner:** Brodie + mum (domain expertise)
**Scope:** Extend the existing detection engine with 12 new signals across 3 classes: VEN/PIN/CT mismatch, Title/Ownership, and Concession (Water Corp integration).

---

## 1. Data model — the join graph

The system already models council records vs Landgate cadastre as separate join keys. This feature adds the **VEN as the primary valuation join key**, **PIN as the parcel key (N per VEN)**, **CT (Volume/Folio) as the title key**, and **Water Corp eligibility** as the authoritative concession source.

```
Council record (TechOne / Civica)
├── assessmentNumber  (council's PK)
├── ven               (Landgate join key — 1 VEN per assessment)
├── pins[]            (Landgate parcel keys — N PINs per VEN)
├── ct                (Volume + Folio — usually 1; multiple for strata)
├── proprietor        (council's owner of record)
├── postalAddress
├── rateCode
├── valuation         (council's record of the canonical figure)
├── concession        (pensioner / first-home / senior / veteran)
└── annualRates

Landgate (canonical)
├── ven, pins[], ct
├── proprietor + proprietorPostalAddress
├── landuseCode per PIN
├── valuation (GRV/UV per VEN with effective date)
└── encumbrances[]

Water Corporation (concession authority)
├── customerId / card #
├── eligibilityStatus  (active | cancelled | expired | deceased)
├── effectiveDates
└── propertyAddress

Council adopted rate schedule (per FY)
├── rateCode → (rateInDollar, minimumPayment, applies-to-landuse)
└── service charges
```

Note: a single **VEN can map to multiple PINs** (rural farms, strata complexes, adjoining commercial titles). The model uses `pins: Pin[]` not `pin: string`.

---

## 2. Property entity — new fields

```ts
export type Pin = {
  readonly pin: string;                // Landgate Parcel Identifier
  readonly lotPlan: string;            // "Lot 42 DP 18337"
  readonly landuseCode: string;        // Landgate's classification for THIS PIN
  readonly areaSquareMetres: number;
  readonly geometry?: GeoJsonGeometry;
  readonly councilCode?: string;       // populated when cross-council detection runs
};

export type Encumbrance = {
  readonly type: "mortgage" | "easement" | "caveat" | "tenement_notation" | "covenant" | "other";
  readonly reference: string;
  readonly date: string;               // ISO
  readonly source: string;             // freshness label
};

export type WaterCorpEligibilityStatus =
  | "active"
  | "cancelled"
  | "expired"
  | "deceased"
  | "unknown";

export type PensionerConcession = {
  readonly applied: boolean;
  readonly type: "pensioner" | "first_home" | "senior" | "veteran";
  readonly appliedAt: string;          // ISO
  readonly cardNumber?: string;
  readonly cardExpiry?: string;
  readonly wcEligibilityVerifiedAt?: string;
  readonly wcEligibilityStatus?: WaterCorpEligibilityStatus;
  readonly wcCancellationReason?: string;
  readonly wcCancellationDate?: string;
};

export type TitleSourceFreshness = {
  readonly source: "wc_feed" | "landgate_restricted" | "slip" | "council_uploaded_pdf" | "map_viewer_plus";
  readonly retrievedAt: string;        // ISO
  readonly lagWarning?: string;        // human-readable caveat
};

// Property gains:
property.ven                  string | null
property.pins                 readonly Pin[]
property.ctVolume             string | null
property.ctFolio              string | null
property.ctIssuedDate         string | null
property.proprietorOnTitle    string | null
property.proprietorPostalAddress  string | null
property.strataParentCt       { volume: string; folio: string } | null
property.strataChildren       readonly Array<{ volume: string; folio: string }>
property.encumbrances         readonly Encumbrance[]
property.pensionerConcession  PensionerConcession | null
property.titleSource          TitleSourceFreshness | null
```

---

## 3. Signal catalogue — 12 new signals

### VEN/PIN/CT class (7)

| ID | Weight | Category | Fires when |
|---|---:|---|---|
| `mismatch.proprietor` | 0.40 | identity | Landgate CT proprietor ≠ council's owner of record |
| `mismatch.ct_number_changed` | 0.35 | register | Volume/folio on Landgate differs from council's CT record |
| `mismatch.strata_parent_still_rated` | 0.55 | register | Landgate shows the parent CT was strata-subdivided; council still rating the parent |
| `mismatch.encumbrance_added` | 0.25 | register | New mortgage / easement / caveat / tenement notation appeared on title |
| `mismatch.pin_landuse_diverges` | 0.40 | register | ANY PIN on the VEN has a landuse code that differs from council's rate code |
| `mismatch.pin_missing_from_record` | 0.30 | register | Council records fewer PINs than Landgate has on the VEN |
| `id.cross_council_pin` | 0.25 | identity | VEN's PINs straddle council boundaries — surfaces for human review |

### Concession class (5)

| ID | Weight | Category | Fires when |
|---|---:|---|---|
| `id.pensioner_deceased_continued_rebate` | 0.50 | identity | Death recorded (any source) AND rebate still applying |
| `id.pensioner_eligibility_cancelled` | 0.40 | identity | WC eligibility cancelled, council still applying |
| `id.pensioner_card_expired` | 0.25 | identity | Concession card lapsed, not renewed |
| `id.pensioner_not_at_property` | 0.40 | identity | Proprietor postal ≠ property address (deduped with `id.owner_occupier_concession_mismatch`) |
| `id.proprietor_deceased` | 0.50 | identity | Death recorded for proprietor (independent of concession state) |

All signals **stack** (no exclusiveGroup). All carry an `evidence` string and a `sourcedFrom` reference for the freshness label.

---

## 4. Multi-PIN mismatch behaviour

When a VEN has N PINs, the engine iterates each PIN. **If ANY single PIN's landuse code differs from the council's rate code, `mismatch.pin_landuse_diverges` fires.** Pack lists every PIN row-by-row with each one's status — clerk sees exactly which lot diverged and by how much area.

### Example pack section

```
PINs on this VEN (3):
┌──────────┬─────────────────┬────────────────┬──────────────────┬─────────┬────────────┐
│ PIN      │ Lot/Plan        │ Council landuse│ Landgate landuse │ Area m² │ Status     │
├──────────┼─────────────────┼────────────────┼──────────────────┼─────────┼────────────┤
│ 1234567  │ Lot 42 DP 18337 │ Rural          │ Rural            │ 8,500   │ OK         │
│ 1234568  │ Lot 43 DP 18337 │ Rural          │ Industrial       │ 4,200   │ ⚠ MISMATCH│
│ 1234569  │ Lot 44 DP 18337 │ Rural          │ Rural            │ 6,800   │ OK         │
└──────────┴─────────────────┴────────────────┴──────────────────┴─────────┴────────────┘

Area-share impact:
4,200 m² of this VEN should arguably be rated Industrial @ 0.135c/$,
not Rural @ 0.045c/$ — annual impact at council's adopted FY schedule: $X.
```

### Cross-council ambiguity

When `id.cross_council_pin` fires, the pack carries a "JURISDICTIONAL AMBIGUITY" badge. Both councils listed. Area-share calculation included. Recommended action: "Manual review required — confirm with both councils which has rating jurisdiction." Routes to a separate workflow queue, not the standard recovery flow.

---

## 5. CSV imports — three new flows

Same two-phase commit pattern as the existing `import_rating_roll`. Each:
- POST `/api/councils/[code]/import-<kind>` with multipart CSV or JSON body
- RBAC: `write.user_management` (council_admin or platform_admin)
- 10MB cap, Zod-validated row schema, error-row collection
- Audit-logged

### 5.1 Rate schedule CSV (`import_rate_schedule`)

Council provides annually. Columns:
- `financial_year` ("2025-26")
- `rate_code` (council's internal code)
- `applies_to_landuse` (Residential / Commercial / Industrial / Vacant / Rural / Pastoral / Mining / MiningOther)
- `rate_in_dollar` (decimal, e.g. 0.107)
- `minimum_payment` (AUD)
- `basis` (GRV | UV)

### 5.2 Landgate title data CSV (`import_landgate_title_data`)

Council provides from their Landgate subscription. Columns:
- `assessment_number` OR `ven` (one required as join)
- `ct_volume`
- `ct_folio`
- `ct_issued_date`
- `proprietor_name`
- `proprietor_postal_address`
- `pin` (one row per PIN; multiple rows can share a VEN)
- `lot_plan`
- `landuse_code` (per PIN)
- `area_sqm` (per PIN)
- `encumbrance_type` (optional; multiple rows for multiple encumbrances)
- `encumbrance_reference`
- `encumbrance_date`
- `strata_parent_volume` / `strata_parent_folio` (optional)

### 5.3 Water Corp eligibility CSV (`import_wc_eligibility`)

Council uploads monthly/quarterly. Columns:
- `customer_id` (WC's customer ID)
- `card_number` (PCC / DVA / Senior's — masked)
- `holder_name`
- `eligibility_status` (active | cancelled | expired | deceased)
- `valid_from` (ISO)
- `valid_to` (ISO or empty)
- `cancellation_reason` (optional)
- `cancellation_date` (optional)
- `property_address_on_file`

---

## 6. Evidence pack — extended template

### Existing sections (kept)

1. Header (VEN, property, council, FY)
2. Council's current state
3. Landgate's current state (multi-source with freshness labels)
4. Council's adopted rate schedule for the FY
5. Mismatch breakdown (**now priority-sorted by signal weight, descending**)
6. Recommended action
7. Calculation (current vs correct, annual uplift, backdated arrears with s.6.81 caveat)

### New sections

**8. Title state**
- CT volume/folio + issued date
- Registered proprietor + postal address (multi-source labelled)
- Per-PIN table (multi-PIN model)
- Encumbrances list (mortgage / easement / caveat / tenement notation)
- Strata-parent flag with link to children if applicable

**9. Concession audit**
- Current concession on file (type, applied since, card details masked)
- Water Corp eligibility check (last verified, status, source)
- Postal vs property address comparison
- Mismatch list with weights
- Statutory basis (Rates and Charges Rebates and Deferments Act 1992 WA)
- Recommended action (suspend rebate / engage executor / etc.)

### Priority-by-weight sort + headline summary

**Top of pack:** "Headline" panel shows the top 3 signals by weight. The clerk reads the headline; details below.

**Mismatch breakdown section:** all firing signals **sorted by weight descending**. So a property with `mismatch.strata_parent_still_rated (0.55)` + `id.pensioner_deceased_continued_rebate (0.50)` + `mismatch.pin_landuse_diverges (0.40)` + `id.pensioner_card_expired (0.25)` renders in exactly that order. Highest-impact first; clerk's eye flows down.

**Per-signal accordions:** each signal renders as a collapsible accordion. Top 3 expanded by default; rest collapsed. Clerk expands what they need.

---

## 7. Strata-conversion lifecycle

New workflow triggered by `mismatch.strata_parent_still_rated`:

```
parent_strata_detected
  → strata_plan_uploaded     (clerk uploads plan or we fetch from Landgate)
    → children_previewed     (we generate N child property previews)
      → children_imported    (two-phase commit; one audit row per child)
        → parent_superseded  (parent record marked closed; cross-ref to children)
   ↘ withdrawn (reason logged)
```

Each transition audit-logged. Dashboard surfaces:
- "X strata-parents detected, plan not yet uploaded"
- "X strata children previewed, awaiting confirm"

New tool: `request_strata_conversion` with state-machine validation. Cannot skip states (no detected → imported without preview).

---

## 8. Source-freshness pattern (unchanged from prior spec)

For every Landgate-sourced or WC-sourced datum:

| Tier | Source | Used as |
|---|---|---|
| 1 | Council's Landgate subscription / WC feed / VG Notice | Primary |
| 2 | SLIP REST public layers (where attribute available) | Secondary |
| 3 | Council-uploaded CT search PDF (OCR + parse) | Manual override |
| 4 | Landgate Map Viewer Plus deep-link | Labelled fallback only — "may lag 1-4 weeks" caveat |

Every pack section carries `sourcedFrom` + `retrievedAt` + freshness caveat. If primary source is >7 days old AND a mismatch is firing, pack auto-recommends "Verify against current source before lodging".

---

## 9. Open questions captured for when we build

1. Sample Water Corp eligibility CSV format — column names, status enum values
2. Sample Landgate restricted-tier response showing VEN→PINs cardinality
3. Pension rebate frequency in WA — annual amount, how it appears on council records
4. Council's CT field names in TechOne — actual mapping
5. Multi-PIN sample (real or synthetic) — one WA rural farm with 3+ PINs under one VEN

These are answer-when-pilot-data-lands items, not build blockers. The CSV imports tolerate optional columns; the engine fires on what's present.

---

## 10. Build phasing

**Round 1 (foundation, serial):**
- Contract types + Zod schemas + tool input schemas

**Round 2 (parallel after Round 1):**
- Signal definitions + scoring.ts firing logic + tests
- New handlers for the 3 CSV imports + tests
- Evidence pack template extension (Sections 8 + 9 + priority-by-weight sort)

**Round 3 (parallel after Round 2):**
- UI surfaces (filter pills, property detail extensions, strata workflow)
- Mock data + integration tests + smoke updates

**Round 4:** Final ship-check, commit, push, deploy to Railway.

---

*Last updated: 2026-05-15. Spec locked by Brodie.*
