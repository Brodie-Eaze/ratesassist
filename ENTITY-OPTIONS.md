# RatesAssist — Entity & Cap Table Options

| | |
|---|---|
| **Document** | Entity Options + Cap Table Comparison |
| **Status** | Draft — decision pending |
| **Owner** | Brodie |
| **Last updated** | 2026-05-08 |
| **Confidentiality** | Confidential |

---

## Purpose

Lay out viable entity structures for RatesAssist and corresponding mum-equity / mum-compensation arrangements, with trade-offs visible. **No decision is recommended in this document.** Pick after the mum-discovery call.

---

## Decision dimensions

Three independent dimensions that combine into a chosen path:

1. **Entity vehicle** — where the IP, contracts, and revenue live
2. **Brodie's commitment level** — full-time vs sidecar
3. **Mum's role + equity** — full-time co-founder vs advisor vs revenue-share

The three combine into a sensible path. Cross-check at the end.

---

## Dimension 1 — Entity vehicle

### Option A — New PTY LTD ("RatesAssist Pty Ltd")

A clean, dedicated Australian Proprietary Limited company.

**Pros:**
- Clean cap table for any future investment
- Clear separation from existing AUREAN / Amala Finance / Margin Arbitrage activities
- Council buyers see a focused, dedicated vendor (matters for procurement)
- Easier to grant equity to mum and future hires
- R&D Tax Incentive registration straightforward
- Brand and entity aligned (RatesAssist)

**Cons:**
- ~$700–1,500 setup (ASIC + accountant + legal review)
- New ABN, GST, bank account, accounting setup
- Initial admin burden
- Director duties duplicated across multiple entities

**Decision factors:**
- Choose if RatesAssist is a serious commercial pursuit (not a side experiment)
- Choose if mum is taking equity (much simpler in a dedicated entity)
- Choose if any external capital is foreseeable in 24 months

### Option B — AUREAN sub-brand / division

Operate RatesAssist as a brand and product line under the AUREAN entity.

**Pros:**
- Zero entity setup cost
- Reuses existing AUREAN ABN, banking, accounting
- Faster to start
- Existing AUREAN insurance and contracts may extend

**Cons:**
- Cap table mixed with AUREAN's other activities — complicates fundraising and equity grants
- Council buyers may struggle with vendor identity ("AUREAN trading as RatesAssist" is not a clean signal)
- AUREAN's primary purpose may not match public-sector software (constitution / scope check required)
- Mum's equity is in AUREAN, not RatesAssist — dilutes alignment
- Hard to ringfence liability — RatesAssist contractual risk lands on the parent

**Decision factors:**
- Choose only if RatesAssist is genuinely a side experiment with capped time and intent
- Choose only if AUREAN's purpose explicitly allows this kind of work

### Option C — New PTY LTD as wholly-owned subsidiary of AUREAN

A subsidiary entity owned by AUREAN.

**Pros:**
- Clean external face (RatesAssist Pty Ltd is the contracting party)
- Liability isolated to subsidiary
- Consolidated accounting at AUREAN level
- Easier to spin out later if RatesAssist takes off
- Can grant equity to mum at the subsidiary level (AUREAN owns the rest)

**Cons:**
- Slightly more accounting complexity than Option A
- Subsidiary cap table table needs to be designed (who owns what at sub level vs parent)
- Future investment may want to invest at parent level — needs thought

**Decision factors:**
- Sensible middle ground if you want to keep the corporate group together but signal externally that RatesAssist is its own thing

### Recommendation framework (not a recommendation)

| Scenario | Likely best choice |
|---|---|
| Brodie commits full-time, mum is co-founder, future capital possible | Option A — New PTY LTD |
| Brodie commits part-time, mum advises, sidecar pace | Option B — AUREAN sub-brand |
| Brodie commits seriously but wants corporate-group structure | Option C — Subsidiary |

---

## Dimension 2 — Brodie's commitment level

### Path 1 — Full-time

- AUREAN, Amala Finance, Margin Arbetrage scoped down or paused
- 5 days a week on RatesAssist
- 24-month bet on a $5M+ ARR business
- Higher capital deployment if needed (founder time is the biggest cost)
- Higher mum-equity offer makes sense

### Path 2 — Sidecar

- ~8 hours per week capped
- Mum runs operations, Brodie ships product + closes deals
- 24-month outcome is a $1–3M ARR profitable lifestyle business
- Lower capital deployment
- Higher mum-revenue-share, lower mum-equity may be appropriate

The product roadmap is identical for the first 90 days. The difference shows up in months 4–24 in pace, hiring, and capital.

---

## Dimension 3 — Mum's role + equity

### Tier M1 — Co-founder (full-time, leaves current role over 6 months)

- **Title:** Co-Founder & Head of Customer + Domain
- **Responsibilities:** Pilot management, council relationships, calibration, statutory expertise, customer success leadership
- **Time:** Full-time after wind-down
- **Salary:** Below-market but real ($120–160k AUD initially, increasing as revenue grows)
- **Equity:** **15–25% of common stock**, vesting over 4 years with 1-year cliff, single-trigger acceleration on change-of-control
- **Reasonable for:** Path 1 + (Option A or C)

### Tier M2 — Co-founder (part-time, retains current role for 12 months)

- **Title:** Co-Founder & Head of Customer + Domain (part-time)
- **Responsibilities:** Same as M1 but capped to 15–20 hours/week
- **Salary:** Modest retainer ($30–60k AUD/yr)
- **Equity:** **10–15% common stock**, 4-year vest, 1-year cliff
- **Reasonable for:** Path 1 + (Option A or C) when mum prefers gradual transition

### Tier M3 — Strategic advisor

- **Title:** Founding Advisor
- **Responsibilities:** Open doors, validate product, calibrate anomaly scoring, no operational responsibility
- **Time:** ~5 hours/month
- **Salary:** None
- **Equity:** **2–5% common stock**, vest over 2 years with no cliff
- **Reasonable for:** Path 2 sidecar + Option B

### Tier M4 — Pure revenue share (no equity)

- **Title:** Senior consulting partner
- **Responsibilities:** As needed
- **Time:** Project-based
- **Salary / pay:** **30% of net success fees on her existing council pilots, for the life of those councils' contracts**, declining to 10% on new councils she doesn't directly originate
- **Equity:** None
- **Reasonable for:** When equity isn't appropriate (tax, age, life-stage, preference) but contribution warrants meaningful upside

### Tier M5 — Hybrid (most flexible)

- **Title:** Co-Founder & Head of Customer + Domain (part-time → full-time)
- **Responsibilities:** As M1/M2 evolving
- **Salary:** Tiered — modest retainer initially, increasing as time commitment increases
- **Equity:** **8–12% common stock** with extended vest (5 years)
- **Revenue share:** **15% of net success fees on pilots she directly originates**, in addition to equity (caps at year 3)
- **Reasonable for:** Most realistic real-world path. Honours both her contribution and her caution.

---

## Reference cap table (illustrative — Option A + Path 1 + Tier M1)

After the founding round, before any external investment.

| Holder | Holding type | % | Notes |
|---|---|---|---|
| Brodie | Founder common | 70% | Vests 4 years, 1-year cliff, single-trigger acceleration |
| Mum | Founder common | 20% | Same vest |
| Employee Stock Ownership Plan (ESOP) | Reserved option pool | 10% | Used to grant Senior Engineer #1, CSM #1, etc. |
| **Total** | | **100%** | |

When external capital arrives (if ever), expect 10–20% dilution at seed/pre-seed.

---

## Reference cap table (illustrative — Option A + Path 2 + Tier M5)

| Holder | Holding type | % | Notes |
|---|---|---|---|
| Brodie | Founder common | 78% | Vests 4 years |
| Mum | Founder common | 10% | 5-year vest |
| ESOP | Reserved option pool | 12% | Larger pool for hires given lighter founder time |
| **Total** | | **100%** | |

Mum additionally receives 15% of net success fees on her pilots — a "bonus" line item separate from equity.

---

## Founder-friendly defaults (regardless of path)

These should appear in any RatesAssist constitutional / shareholder documents:

- 4-year vesting on all founder equity, 1-year cliff
- Single-trigger acceleration on change-of-control (sale of company)
- Drag-along + tag-along rights at founders' discretion until external capital
- Founder reverse-vesting (ESS interest scheme registered with ATO)
- Pre-emption rights on any new issuance
- Right of first refusal on any founder share transfer
- Restrictive covenants: non-compete during employment + 12 months after; non-solicit 24 months after
- Vesting credit for time worked prior to formal contract execution (mum has been calibrating for years already)
- IP assignment from founders to the entity
- Conflicts-of-interest policy (especially relevant given AUREAN / Amala / Margin Arbitrage in parallel)

---

## Practical setup checklist

When a path is chosen:

1. **ASIC** — register or amend company name, directors, shareholders
2. **Constitution** — adopt template constitution; review for ESOP and vesting provisions
3. **Shareholders agreement** — between Brodie + mum (and AUREAN if Option C)
4. **ATO** — apply for ABN, register for GST (when revenue threshold approaches), register PAYG
5. **AUSTRAC** if relevant (probably not for v1)
6. **Bank account** — Up Business / CommBiz / Wise Business
7. **Domain registration** — `.com` and `.com.au`
8. **Trademark search + application** — IP Australia
9. **Insurance** — PI ($5M+), Cyber ($5M+), Public Liability ($20M+) via a tech-friendly broker
10. **Accountant** — engagement for monthly bookkeeping + annual financial statements + R&D Tax Incentive registration
11. **R&D Tax Incentive** — register intent for the year, claim on next return
12. **Founder employment agreements** — once entity is set up
13. **ESS plan** — for the option pool, registered with ATO

---

## Tax considerations (high level — confirm with accountant)

- **Founder equity:** structured as ordinary shares, not options. Vested founder shares are not generally taxed at grant if structured correctly.
- **Mum's equity:** if she joins as employee, options under ESS deferred-tax scheme; if as co-founder receiving founder shares, ordinary share treatment.
- **R&D Tax Incentive:** ~43.5% non-refundable offset (if revenue < $20M) on eligible R&D expenditure. RatesAssist build qualifies if structured properly.
- **Export Market Development Grant (EMDG):** if expanding to NZ in year 2, possibly eligible.
- **Small business CGT concessions:** structure with future exit in mind.

---

## What to discuss with mum

When you sit down with mum on the entity / equity conversation, walk through:

1. **Time** — what is realistic for her? Don't over-ask.
2. **Money** — does she need salary continuity, or can she trade salary for equity?
3. **Risk** — startup risk vs current career stability. She's already de-risked the thesis ($30–50M is real); this is now about productisation.
4. **Identity** — does she want to be publicly a co-founder, or operate behind the scenes?
5. **Relationships** — how to structure customer introductions so neither her existing employer nor the receiving councils feel awkward.
6. **Conflicts** — any existing employment contract clauses about side ventures or post-employment work?
7. **Family** — your own relationship dynamics. Pay her properly. Document everything cleanly. Don't take her contribution for granted because she's family.

---

## Open questions

1. AUREAN's company constitution — does its purpose allow public-sector software? (Decides Option B feasibility)
2. AUREAN's existing shareholders / partners — any consent requirements for sub-brand operation?
3. Mum's current employment contract — any non-compete / IP clauses that affect this?
4. Mum's tax residency / age / personal financial structure — affects equity vs salary vs revenue-share preference
5. Brodie's existing director duties at AUREAN / Amala — capacity check
6. Any state-specific local-government compliance requirements that demand a particular entity form (rare, but check)

Resolve these in conversation with accountant, lawyer, and mum before locking the structure.
