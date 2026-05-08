# Outreach — Nearmap Evaluation & API Access

**Purpose:** Establish API access to Nearmap (with AI change-detection capability) for the RatesRecovery anomaly module, including evaluation terms, pricing visibility, and a path to joint local-government go-to-market.

**Status:** Draft — review before send.
**Owner:** Brodie

---

## Target contacts

- **Primary:** Nearmap "AI" or "Government" sales lead — via https://www.nearmap.com/au/en/contact-sales
- **Secondary:** LinkedIn — Nearmap AU enterprise sales for local government
- **Backup:** Mum has likely encountered Nearmap reps through her councils; warm intro available

---

## Email — initial enquiry

> **Subject:** Evaluation enquiry — Nearmap AI change detection for council rates audit
>
> Hi [Sales / Partnerships Lead],
>
> I'm Brodie, founder of RatesAssist — a vertical AI product for Australian council rates departments. We're building a recovery-audit module that systematically surfaces mining-tenement and land-use rating mis-classifications across council property registers, generating evidence packs that drive recovered rates revenue for councils.
>
> Aerial change detection is central to several detection categories — vacant-land-not-vacant, undeclared improvements, subdivision pre-titles-update, solar farm reclassification opportunities, and land-clearing for commercial use. Nearmap's AI products and historical imagery are the strongest fit we've identified.
>
> I'd appreciate a conversation about:
>
> 1. **API access** — REST API + AI change detection layer access for an evaluation period.
> 2. **Pricing model** — typical council-coverage pricing, plus options where RatesAssist is the integration layer rather than the council buying directly.
> 3. **Partner / reseller possibilities** — councils we deploy with may already be Nearmap customers; we'd like to honour that and integrate cleanly. For councils without Nearmap, we'd like to be able to bundle.
>
> Our domain co-founder runs rates departments for multiple councils, so we have a pilot site lined up with a clear use case and willingness to validate in production.
>
> Happy to share our architecture overview, security and privacy posture, and pilot brief on request. Available for a 30-minute call at your convenience.
>
> Best,
> Brodie
> Founder, RatesAssist
> [phone] · [email]

---

## Follow-up — 5 days no response

> **Subject:** Re: Evaluation enquiry — Nearmap AI change detection for council rates audit
>
> Hi [Name],
>
> Following up on my note from last week. We're in pilot validation now and Nearmap is our preferred imagery / change-detection partner. If there's a better contact for ISV / integration partnerships, I'd appreciate the redirect.
>
> Best,
> Brodie

---

## What to ask for in the eval call

- 30–90 day eval window
- API access for one council's LGA boundary
- Nearmap AI (change detection) layer access — not just static imagery
- Historical imagery (12 / 24 / 36 months back) to support change detection
- Documentation on permissible redistribution (we display imagery within RatesAssist; we need clarity on terms)
- Pricing: typical council coverage + ISV-discounted pricing if available

---

## Pricing intelligence (background)

Nearmap council pricing typically falls in $15k–$80k per year depending on:

- LGA area covered
- Imagery refresh frequency
- AI products included (Nearmap AI is premium)
- Number of authorised users

For RatesAssist economics:

- **Best case:** Council already has a Nearmap subscription. We integrate via their existing API key.
- **Standard case:** We bundle Nearmap into our pricing and pass through cost.
- **ISV case:** We secure an ISV/reseller arrangement that lets us cover multiple councils on a consolidated commercial framework.

Aim for the ISV arrangement long-term. Council-by-council passthrough is fine for v1.

---

## Strategic positioning

Frame as:

- **Adjacent demand creation** for Nearmap AI. Many councils have static imagery but not AI change detection; RatesAssist makes the AI tier business-relevant by tying it to a measurable revenue outcome.
- **Vertical wedge.** RatesAssist owns the rates department use case; Nearmap remains the imagery platform of record across all council use cases.
- **Reference customers.** Each RatesAssist deployment is a reference for Nearmap AI usage in local government.

Avoid:
- Sounding like we're trying to compete with their direct sales motion
- Implying we'll undercut their council pricing
- Asking for any commitment we can't reciprocate (we can't promise volumes pre-pilot)

---

## Alternatives if Nearmap is slow or expensive

- **Metromap** — competitive, often cheaper. Different AI capability set, may be sufficient.
- **Geoscape Buildings + Surfaces** — derived dataset, useful for many anomaly types (especially undeclared improvements) without full imagery cost.
- **PSMA / national datasets** — partial coverage but free or low-cost baseline.

In v1 we accept that aerial change detection may run on Nearmap *or* Metromap depending on what each council has. The detection framework abstracts the imagery provider.
