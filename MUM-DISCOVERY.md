# Mum Discovery Sheet

A focused conversation with mum to validate and refine the prototype. Aim for 60–90 minutes. Take notes verbatim.

## Part 1: Show her the prototype (10 mins)

Open Claude Desktop with rates-assist wired in. Ask Claude to:
1. *"Give me today's rates briefing"*
2. *"Find Smiths in Mortdale"*
3. *"Pull up 12 Boundary Road"*
4. *"Draft a friendly reminder for the overdue Smith property"*

Watch her face. Note:
- Which one made her go *"oh wow"*
- Which felt clunky or wrong
- What she said the data structure should look like instead

## Part 2: Platform reality check (15 mins)

- Which TechOne module is rates? (Property & Rating? OneCouncil? CiAnywhere version or older Pathway/Authority?)
- Which councils does she know are running it currently?
- Has she used the **CiAnywhere REST API** directly? Does she know which councils have it enabled?
- ECM Web Services — is that what she's used for integrations?
- What does TechOne charge councils for API access?
- Are there standard config patterns across councils, or is every install different?

## Part 3: Her actual day (30 mins)

Get her to walk through a typical Monday. For every screen she opens, ask:
- What were you looking for?
- How long did it take?
- How many clicks?
- How often per day do you do this?

Goal: list her **top 15 most-repeated workflows** ranked by daily frequency.

Likely candidates (confirm/refine):
- [ ] Customer phone call → property lookup
- [ ] New owner registration after settlement
- [ ] Pensioner rebate application processing
- [ ] Section 603/184 certificate generation
- [ ] Direct debit setup / change
- [ ] Payment arrangement drafting
- [ ] Bank reconciliation (matching deposits to assessments)
- [ ] Hardship/waiver assessment
- [ ] Address change for posted notices
- [ ] Counter enquiry (customer at front desk)
- [ ] Overdue chase batch
- [ ] Land tax / supplementary valuation update
- [ ] Reporting (weekly/monthly to manager)
- [ ] Email enquiries triage
- [ ] Quarterly rates notice generation

For each, note:
- Frequency (per day / per week)
- Time taken currently
- Estimated time saved with chat-based tool

## Part 4: Buyer dynamics (15 mins)

- Who in a council signs off on $20–50k tooling? (Director Corporate Services? CFO? GM?)
- How does procurement work — vendor panel? Direct? Tender threshold?
- Which councils does she have personal relationships at?
- Are there NSW/VIC/QLD/etc differences in rates law that change the workflow?
- LGA networks she's plugged into (LGNSW, MAV, LGAQ, ALGA)?
- TechOne user groups / forums where rates officers congregate?
- Has TechOne ever shipped a chat/AI product?

## Part 5: Pilot site (10 mins)

- Of the councils she configured, which 1–3 would she introduce me to?
- What's the politics of rolling out a new tool there?
- Would they let us read from their sandbox/dev TechOne instance for 3 months free in exchange for a polished product at the end?

## Part 6: Killer questions (10 mins)

- "If you could push one button on a magic chat box every morning, what would it do?"
- "What's the most embarrassing TechOne thing — the one that makes the platform look bad?"
- "What do customers complain about most that's actually a system limitation?"
- "Walk me through the worst Monday morning you've had — what made it bad?"

## Output

After the call you should have:
1. A confirmed top 10 workflows ranked by frequency
2. TechOne API access reality (yes/no/which councils)
3. 2–3 named pilot council candidates
4. A buyer persona at the council
5. Refined prototype demo plan based on her reactions
