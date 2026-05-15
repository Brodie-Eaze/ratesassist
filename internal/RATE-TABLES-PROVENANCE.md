# WA Rate-Tables Provenance — 2025-26 Refresh

**Retrieved:** 2026-05-14
**Refresh window:** May 2026 (post-FY adoption)
**Source-of-truth file:** `packages/contract/src/rateTables/wa-2025-26.ts`
**Automation:** `npm run refresh-rate-tables` (see `scripts/refresh-rate-tables.ts`)

This document is the per-council audit trail for the 2025-26 differential
rate tables shipped with RatesAssist. Each entry below records the source
URL, what the published schedule actually said on the page, what was
captured in the rate table, and any analogue/divergence notes.

A council CFO reviewing the evidence pack against their own gazetted
budget can cross-check every figure here.

---

## City of Kalgoorlie-Boulder (KAL)

- **Source URL:** `https://www.ckb.wa.gov.au/Profiles/ckb/Assets/ClientData/2025-26-Statutory-Budget.pdf`
- **Retrieved:** 2026-05-14
- **Status:** Verified
- **Published categories (6):**
  - GRV Residential — rate $0.053716, min $1,169
  - GRV Mining — rate $0.107432, min $1,286
  - GRV Commercial / Industrial — rate $0.080987, min $1,169
  - GRV Accommodation — rate $0.096069, min $1,286
  - UV Mining Operations — rate $0.193584, min $455
  - UV Pastoral / Other — rate $0.096895, min $364

**Captured to schema (8 categories):**
- Residential → GRV Residential (verified)
- Commercial → GRV Commercial/Industrial (verified — combined)
- Industrial → GRV Commercial/Industrial (analogue)
- Vacant → GRV Commercial/Industrial (analogue: vacant non-residential
  parcels are rated under Commercial/Industrial per CKB's differential
  rating prose)
- Rural → UV Pastoral/Other (no separate Rural category in CKB)
- Pastoral → UV Pastoral/Other (verified)
- Mining → UV Mining Operations (verified)
- MiningOther → UV Mining Operations (analogue: CKB has no separate
  "Mining Other" UV surface)

**What changed since 2024-25:** Council resolution noted "no change" to
the differential rates table; FY 2025-26 figures equal 2024-25.

---

## Shire of East Pilbara (ESH)

- **Source URL:** `https://www.eastpilbara.wa.gov.au/documents/1439/202526-statutory-budget`
- **Retrieved:** 2026-05-14
- **Status:** Verified
- **Published categories (6):**
  - GRV Residential — rate $0.067500, min $1,185
  - GRV Non-Residential — rate $0.067500, min $1,400
  - GRV Transient — rate $0.135000, min $1,400
  - UV Pastoral — rate $0.209000, min $1,400
  - UV Mining/Others — rate $0.379000, min $1,400
  - UV Mining Prospecting — rate $0.303600, min $915

**Captured to schema:**
- Residential → GRV Residential (verified)
- Commercial / Industrial / Vacant → GRV Non-Residential (analogue)
- Rural / Pastoral → UV Pastoral (verified)
- Mining → UV Mining/Others (verified)
- MiningOther → UV Mining Prospecting (verified — the published
  Prospecting category is the closest fit for non-tenement UV mining)

**What changed since 2024-25:** GRV Residential and Non-Residential
dropped from advertised 0.077240 to adopted 0.067500 after new
valuations were received during budget modelling (Note 2(e)).

---

## Shire of Ashburton (ASH)

- **Source URL:** `https://www.ashburton.wa.gov.au/documents/410/2025-2026-annual-budget`
- **Retrieved:** 2026-05-14
- **Status:** Verified
- **Published categories (5, uniform min $1,390):**
  - GRV Residential — rate $0.067710
  - GRV Commercial / Industrial — rate $0.086610
  - GRV Transient Workforce Accommodation — rate $0.193650
  - UV Pastoral — rate $0.192500
  - UV Non-Pastoral (mining) — rate $0.379500

**Captured to schema:**
- Residential → GRV Residential (verified)
- Commercial / Industrial → GRV Commercial/Industrial (verified)
- Vacant → GRV Commercial/Industrial (analogue)
- Rural / Pastoral → UV Pastoral (verified)
- Mining / MiningOther → UV Non-Pastoral (verified)

**What changed since 2024-25:** Residential rate held below CPI per the
President's foreword. Specific 2024-25 comparison rates are not
republished in the 2025-26 budget; council recorded a deliberate
modest-increase posture for residential and waste-collection charges.

---

## Shire of Tom Price (TPS) — deprecated alias

- **Status:** Deprecated alias for ASH (Tom Price is a town within the
  Shire of Ashburton; there is no separate Shire of Tom Price)
- **Source URL:** Same as ASH
- **Rates:** Mirror ASH 2025-26 exactly

The TPS code is retained so existing demo assessment numbers continue to
resolve. New adapter wiring should call ASH directly.

---

## Shire of Meekatharra (MEK)

- **Source URL:** `https://www.meekashire.wa.gov.au/documents/594/2025-26-statutory-budget`
- **Retrieved:** 2026-05-14
- **Status:** Verified
- **Published categories (3, single GRV rate):**
  - GRV (single rate, all townsite use) — rate $0.098325, min $414
  - UV Pastoral — rate $0.087975, min $518
  - UV Non-Pastoral (mining and other UV) — rate $0.250000, min $650

**Captured to schema:**
- Residential / Commercial / Industrial / Vacant → GRV uniform
  (verified — MEK strikes a single rate covering "residential,
  commercial, industrial, community benefit, or other use within the
  townsite" per the published differential rating objects)
- Rural / Pastoral → UV Pastoral (verified)
- Mining / MiningOther → UV Non-Pastoral (verified)

**What changed since 2024-25:** Council notes "No variation" from the
advertised rates; rate-in-dollar reflects the modest annual lift to keep
revenue stable.

---

## Shire of Sandstone (SST)

- **Primary source:** `https://www.sandstone.wa.gov.au/repository/libraries/id:2pgaygvvh17q9smi2m5z/hierarchy/Documents/Council%20Documents/Rating%20Strategy%20Objectives%20%20Reasons%202025-2026.pdf`
- **Secondary source (adopted budget):** `2025-26-Statutory-Budget Final Adopted 01.09.2025.pdf`
  on the same Sandstone document library
- **Retrieved:** 2026-05-14
- **Status:** Verified
- **Published categories (4):**
  - GRV Townsite — rate $0.072852, min $200 (2.5% lift on 2024-25)
  - GRV Transient Workers Facilities — rate $0.410620, min $200 (2.5% lift)
  - UV Pastoral — rate $0.067240, min $400 (2.5% lift)
  - UV Mining — rate $0.296820, min $400 (2.5% lift)

**Captured to schema:**
- Residential / Commercial / Industrial / Vacant → GRV Townsite
  (analogue — Sandstone strikes a single townsite rate)
- Rural / Pastoral → UV Pastoral (verified)
- Mining → UV Mining (verified)
- MiningOther → UV Mining (analogue — no separate "Mining Other" UV)

**What changed since 2024-25:** Across-the-board 2.5% rate increase to
match WA CPI without over-shooting; Council expressly avoided exceeding
this benchmark.

---

## Refresh cadence policy

- **Default cadence:** Quarterly (March, June, September, December) plus
  an out-of-cycle refresh whenever a pilot kicks off or a council CFO
  flags a discrepancy.
- **Trigger events:** WA local government election cycles (October),
  state-government rate-cap legislation amendments, and any council
  resolution amending differential rates (notifiable under LG Act
  s.6.36).
- **Owner:** Eng-on-duty for the relevant pilot. Reviews
  `scripts/proposed-rate-tables.json`, hand-merges into
  `packages/contract/src/rateTables/wa-2025-26.ts`, and updates this
  document.

## Failure handling

When a council website is unreachable:

1. The `refresh-rate-tables` script logs `status: "unreachable"` with
   the HTTP error in `scripts/proposed-rate-tables.json`.
2. The current rate-table entry is retained unchanged. NEVER silently
   re-stamp the `retrievedAt` date on data that wasn't re-verified.
3. If the outage exceeds 48 hours and the affected council is in an
   active pilot, the eng-on-duty raises an internal ticket and contacts
   the council's rates team directly for a fresh schedule PDF.
4. The CFO-facing evidence pack continues to display the
   `Carried-forward` badge until the new figures are verified — no
   audit-defensibility regression.

## What changed since 2024-25 — summary

- **KAL:** No change (council resolution).
- **ESH:** GRV rates dropped from advertised 0.077240 to adopted 0.067500
  on the back of higher-than-modelled valuations.
- **ASH:** Modest residential rate increase below CPI (President's
  foreword); commercial/industrial and UV Non-Pastoral both lifted to
  preserve mining contribution share.
- **TPS:** Mirrors ASH.
- **MEK:** No variation from the advertised differential rate.
- **SST:** Uniform 2.5% lift across all four categories.

## Pointers for council clerks

- The `verified: true` flag plus the `sourceUrl` field on each
  `RateTable` is the audit-defensible badge surfaced to the CFO in the
  recovery evidence pack.
- The `note` field on every council records analogues, divergences, and
  any "carried forward" status. The UI quotes it verbatim.
- The next refresh window is scheduled for August 2026 (post-FY 2026-27
  adoption); see `scripts/refresh-rate-tables.ts` for the URLs that will
  be re-pulled.
