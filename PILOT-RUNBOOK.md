# RatesAssist — Pilot Runbook

| | |
|---|---|
| **Document** | Operational runbook for first pilot |
| **Audience** | Founders + first pilot council operational contacts |
| **Status** | Pre-pilot template |
| **Owner** | Brodie |
| **Version** | 0.1 |
| **Last updated** | 2026-05-08 |

---

## Purpose

This runbook is the day-by-day playbook for the first pilot council deployment. Designed to be read by both founders before pilot kickoff and used as the live execution document during the pilot.

---

## Pre-pilot checklist

Before approaching pilot council #1, the following must be complete:

- [ ] Mum-discovery call complete; top 10 workflows captured
- [ ] Pilot council #1 selected from mum's portfolio
- [ ] Entity decision made and registered (or agreed to operate provisionally)
- [ ] Pilot pitch document approved ([`PILOT-PITCH.md`](PILOT-PITCH.md))
- [ ] MoU template drafted (legal review pending — proceed with caveats)
- [ ] Public DMIRS data ingested for council's LGA boundary (validation that data is accessible)
- [ ] Public Landgate data ingested (same)
- [ ] Demo environment ready with mocked data
- [ ] Brand identity (wordmark + colour) at presentable level
- [ ] Email + phone contact details set up (`pilots@`, `hello@`, etc.)

---

## Pilot stages

### Stage 1 — Initial conversation

**Goal:** Get a 30-minute meeting with the pilot council CFO + rates team lead.

**Approach:**
- Mum makes the warm introduction
- Email to CFO with `PILOT-PITCH.md` attached
- Aim for meeting within 2 weeks of intro
- Brodie + mum both attend

**Meeting agenda:**
1. Context (5 min) — who we are, what we do, why we're here
2. Live demo using public DMIRS data + the prototype (10 min)
3. The recovery thesis: the manual baseline, the productisation opportunity (5 min)
4. Pilot offer: 12% success fee, no upfront, 12-month term (5 min)
5. Questions, addressing concerns (5 min)

**Key messages:**
- We're complementary to TechOne, not competitive
- We never make statutory determinations — they always do
- Data stays in AU, processed under appropriate privacy posture
- They pay nothing if we find nothing

### Stage 2 — Data access

**Goal:** Get a one-time CSV export of rating classifications from their TechOne instance, plus permission to cross-reference against public datasets.

**Required:**
- [ ] CSV with: assessment number, address, suburb, postcode, current rating classification, valuation, owner name, owner ABN (if any), tenement notes if any
- [ ] Council's LGA boundary file (or LGA code so we can derive it)
- [ ] Authorisation memo for using their data with our prototype
- [ ] Single point of contact in rates team for questions

**MoU sketch (pilot stage):**
- Term: 12 months from MoU date
- Scope: anomaly audit + evidence pack delivery
- Fee: 12% of net additional rates collected as a result of corrections we surface, capped at 24 months from each correction date
- Data handling: AU-only, secure deletion 30 days after term, no use beyond pilot
- Confidentiality: mutual NDA terms
- Termination: 30 days notice either side
- Liability: aligned to fees paid; PI insurance evidence provided
- Ownership: council retains all rating data; we retain platform IP

### Stage 3 — Audit run

**Goal:** Generate a candidate list and evidence packs within 30 days of receiving data.

**Process:**
1. **Day 1–3:** Ingest CSV, validate quality, normalise to internal schema
2. **Day 4–5:** Run cross-references — DMIRS tenements, Landgate parcels, ABN lookups
3. **Day 6–10:** Apply detection rules across all relevant categories (mining mismatch, vacant-land-not-vacant, undeclared improvements, etc.)
4. **Day 11–14:** Generate confidence scores; rank candidates
5. **Day 15–21:** Mum reviews top 100 candidates; Brodie refines false-positive patterns based on her input
6. **Day 22–28:** Generate evidence packs for top 50
7. **Day 29–30:** Quality review; package deliverable

**Deliverable to council:**
- Top 50 candidate list with confidence scores
- Estimated annual rates uplift per candidate
- Estimated total recoverable revenue (annual + arrears within statutory limit)
- Full evidence pack for each top-50 candidate
- Methodology summary (what data sources, what rules, what confidence basis)
- Audit trail of every data source and timestamp

### Stage 4 — Council review

**Goal:** Council rates team reviews the candidates and progresses the most actionable ones to formal reclassification process.

**Our role:**
- Available for technical questions on each candidate
- Refining detection based on their feedback (false positives, edge cases)
- Adjusting evidence pack format if needed

**Council's role:**
- Statutory decision on each candidate
- Communication with ratepayers per their normal process
- Reporting back to us when a reclassification is finalised AND when revenue is collected

### Stage 5 — Recovery tracking

**Goal:** Track candidate → reclassified → collected, with running revenue and success fee totals.

**Process:**
- Weekly status update from council on candidate progression
- Monthly reconciliation of collected revenue against fee schedule
- Quarterly invoice for fees on collected amounts (not flagged amounts)

---

## Daily operations during pilot

### Communication cadence

- **Daily** (during weeks 1–4 of audit): brief check-in via email, ad-hoc Slack/Teams if needed
- **Weekly** (after audit delivered): 30-min stand-up with rates team lead
- **Monthly** (full pilot): 60-min review with rates team + CFO
- **Quarterly:** business review with broader council leadership

### Issue tracking

- Use shared issue tracker (Linear, GitHub Issues, or council-preferred) for technical questions
- Weekly summary email to council single point of contact
- Critical issues — immediate phone call

### Documentation

- All meeting notes shared with council
- All deliverables version-controlled and accessible to council
- All data flows logged in audit trail

---

## What success looks like at pilot close (12 months in)

Minimum success criteria:

- [ ] At least 30 candidates progressed by council to formal reclassification process
- [ ] At least $200k of recovered rates collected (anchor expectation; actual can be much higher)
- [ ] At least one council senior leader on-record for a reference call
- [ ] All data handling commitments met (no breaches, no complaints)
- [ ] At least 2 follow-on conversations initiated with peer councils
- [ ] Renewal at end of 12-month term (or transition to multi-year contract)

Stretch:

- [ ] $1M+ recovered
- [ ] First peer council pilot signed
- [ ] Featured in a council case study with consent
- [ ] LGA presentation invitation

---

## Troubleshooting / common issues

### Data quality issues

- **Symptom:** CSV export missing key fields (e.g. tenement notes, owner ABN)
- **Mitigation:** Compensate via external lookups (ASIC, ABN Lookup, public titles searches); flag the gap in the methodology summary
- **Long-term:** Push for proper API access during pilot to eliminate

### False positive rate too high

- **Symptom:** Mum's review eliminates >50% of top candidates
- **Mitigation:** Treat as expected for v1; mum's feedback feeds calibration; second pass should be much tighter
- **Document:** Specific patterns that produced false positives — these become detection rule refinements

### Council slow on reclassification process

- **Symptom:** Candidates stuck in "under review" longer than expected
- **Mitigation:** Patience first — councils have statutory processes that take time. Offer support without pressure. Track aging.
- **Long-term:** Consider workflow automation for the council-side reclassification process as a future feature

### Ratepayer objections

- **Symptom:** Reclassification objected and possibly overturned at appeal
- **Mitigation:** Standard council process. Our success fee is on collected, not flagged — we wear the risk with them.
- **Document:** Pattern of objections that succeed, fold into detection scoring

### TechOne API access materialising mid-pilot

- **Symptom:** TechOne partner approval lands during the pilot
- **Action:** Pilot complete on CSV; new councils onboard via API; pilot council migrated to live API at end of pilot or at renewal

---

## Risks & escalations

| Risk | Trigger | Action |
|---|---|---|
| Data breach | Any unauthorised access detected | Immediate IR plan: contain, notify within 24h, NDB process |
| Council unhappy with quality | First 50 candidates have unacceptable accuracy | Pause delivery, deep-dive with mum, recalibrate, re-run |
| Council leadership change | New CFO/CEO mid-pilot | Re-pitch within 30 days; champion building |
| Mum unavailable | Health, family, or other absence | Brodie to lean on prior calibration; pause new audits if no replacement reviewer |
| Anthropic API outage during demo | Live demo failure | Demo with screenshots; not all demos need live AI |

---

## Pilot exit / continuation

At month 11 (one month before MoU expires):

1. Quarterly business review call with CFO + rates lead + leadership
2. Recovery summary (collected revenue, success fees paid, candidates remaining)
3. Pricing conversation for renewal:
   - **Option 1:** Continue success-fee model only (predictable cost for council)
   - **Option 2:** Hybrid — annual subscription + reduced success-fee rate
   - **Option 3:** Move to RatesAssist productivity tier (officer chat) + RatesIntel + ongoing recovery
4. Reference letter / case study request (with permission)
5. Introduction to peer councils

End-of-pilot deliverables to council:

- Final recovery report
- All data, evidence packs, audit trail in council-readable formats
- Recommendation letter for next steps
- Transition plan if council does not renew (data return, secure deletion attestation)
