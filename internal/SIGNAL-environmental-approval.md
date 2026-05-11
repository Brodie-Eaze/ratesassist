# Signal: `reg.environmental_approval_active`

**Weight:** 0.30 · **Category:** register · **Stacking:** additive (no exclusive group)

## Product context

A mining tenement is "registered" the moment DMIRS signs it (MINEDEX / SLIP).
But the operator cannot lawfully turn a dozer over without a separate
environmental approval — typically a **Mining Proposal (MP)**, a
**Programme of Work (POW)**, or a **Mine Management Plan (MMP)**. These
approvals are administered by the WA Department of Mines, Industry
Regulation and Safety through the **Environmental Management & Tracking
System (EMITS)**.

If EMITS shows an active approval on a tenement that intersects a
council-rated parcel, that's a high-confidence indicator the tenement is
being **worked on the ground** — not held idle pending finance, not
sitting in administrative limbo. For rates classification, this is the
register-side complement to the cadastre-lag signal: cadastre lag tells
us the title hasn't been updated, environmental approval tells us
extraction is happening anyway.

## Access pathway

Probed 2026-05-11 from `RatesAssist`:

- `https://emits.dmp.wa.gov.au/` returns **403** to non-browser user
  agents (Incapsula bot block). The portal is intended for interactive
  browser sessions with cookies established via the WA Government landing
  page.
- `https://emits.dmp.wa.gov.au/Pages/PublicReports.aspx` is the public
  search form, but searches are **POST-driven** — there is no documented
  query parameter that pre-filters by tenement id.
- No machine-readable export (JSON, CSV, WFS, OGC API Features) is
  published. The neighbouring DMIRS SLIP service exposes tenement
  geometry and grant metadata, but not the environmental-approval ledger.

Consequence: the integration ships a **`buildEmitsSearchUrl(tenementId)`**
helper that loads the public-reports page with the raw tenement id
encoded in the hash fragment (purely client-side context the operator can
paste into the search box), and a **`fetchEmitsApprovalsForTenement`**
that always returns `source: "seeded"` against a caller-supplied fixture
pool. We never claim live data we do not have.

A Landgate-style restricted-tier feed for environmental approvals does
**not** exist today as far as public DMIRS material indicates; we will
revisit if DMIRS publishes one or if pilot councils negotiate a direct
data-share.

## TenGraph

DMIRS's spatial-viewer companion to MINEDEX. Probed 2026-05-11:
`https://tengraph.dmirs.wa.gov.au/` connects but returns no headers
inside the standard probe window — viewer is browser-only with no
documented deep-link parameter. `buildTengraphUrl(tenementId)` therefore
returns the viewer home with the raw id in the hash fragment, labelled
honestly in the UI ("paste id once loaded").

## Stacking with cadastre-lag

Both signals are register-tier, neither is in an exclusive group:

```
cadastre_lag (0.50) + environmental_approval_active (0.30) = 0.80 composite
                                                              → HIGH band (≥ 0.60)
```

When a tenement is freshly granted, the cadastre hasn't caught up
(cadastre-lag fires, 0.50), AND EMITS shows an active Mining Proposal
(environmental-approval fires, 0.30), AND the grant is within 90 days
(recently_granted fires, 0.40), the composite caps at 1.00 and the
evidence pack tells the full story: tenement is granted, title is
stale, environmental approval is in place, urgency is elevated.

## Caveats (decision-support, not authoritative)

- **Lag:** EMITS records lag DMIRS approvals by **2–4 weeks** based on
  observation of public listings. A tenement granted today won't show
  in EMITS until the operator submits an approval application, the
  Department signs it, and the system reflects it.
- **Commercial-in-confidence:** some approvals withhold scope or
  start/end-date detail. The signal fires on the existence of an active
  approval, not on the strength of its description.
- **Approval ≠ activity:** an active MP does not prove dozers are
  turning. It proves the operator is **authorised** to turn them. The
  signal is calibrated to 0.30 — meaningful but never the headline.
- **No live mode yet:** every web-app and adapter-demo `source` label
  is `seeded` until DMIRS publishes a machine-readable endpoint. The
  library stub `_attemptLiveFetch` is the upgrade path.

This signal is **decision-support for officers**, not an authoritative
reclassification trigger. The reclassification trigger is the council's
own inspection + statutory notice. The signal sequences officer time
toward the parcels most likely to repay the inspection.
