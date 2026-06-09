# Recovery Audit Dashboard — Elevation Report
**Feature:** `/recovery` — Recovery Audit Dashboard
**Date:** 2026-06-09
**Reviewer:** Elevation agent (claude-sonnet-4-6)
**Current score:** 59 / 100
**Target score:** 90+ (elite)

---

## Score breakdown (current state)

| Dimension | Score | Notes |
|---|---|---|
| Correctness | 7/10 | Logic is sound; strata Convert button visible only under one filter is a correctness miss |
| Robustness | 5/10 | No retry on main error state; pagination silently truncates at 50; Tailwind warn-100/300/600 missing |
| Speed | 8/10 | PERF-008/009 memos in place; memoised sweep cache good |
| Clarity | 5/10 | Domain jargon unexplained; stat cards have no context; "Showing X of Y" misleads |
| Delight | 3/10 | Zero onboarding; no jaw-drop moment; feels like a filtered table, not an intelligence platform |
| "Would the 0.0001% ship this?" | 4/10 | Not yet |
| **Overall** | **59/100** | |

---

## Confirmed weaknesses (grounded in code)

### W1 — Missing Tailwind warn stops (SILENT BUILD BREAK)
**File:** `apps/web/tailwind.config.ts` lines 41–45
**File:** `apps/web/app/recovery/page.tsx` lines 907, 939, 985
`tailwind.config.ts` defines only `warn-50`, `warn-500`, `warn-700`. JSX uses `bg-warn-100`, `border-warn-300`, `btn bg-warn-600`, `hover:bg-warn-700`. The compiler silently purges all four missing stops — the NEW GRANT badge, the lag-days badge, and the strata Convert button render with transparent backgrounds. No warning is emitted at build time. This is the single highest-priority defect: it makes the most critical visual affordances invisible.

### W2 — Pagination envelope fetched but never consumed
**File:** `apps/web/app/recovery/page.tsx` line 213–217 (`CandidatesEnvelope` type declares `pagination?`) and line 225 (`useFetch<CandidatesEnvelope>`)
**File:** `apps/web/app/api/recovery/candidates/route.ts` lines 195–202 (returns `pagination: {total, limit, offset}`)
The API cap is 50. A council with 500 high-severity candidates sees "50 of 50" with no indication that 450 more exist. The `pagination` key is destructured away at line 229–241 and never referenced again. `x-total-count` header is also set but never read.

### W3 — ErrorState has no retry action
**File:** `apps/web/lib/useFetch.tsx` lines 56–74 — `ErrorState` component has no retry button or callback prop.
**File:** `apps/web/app/recovery/page.tsx` line 384 — passes only `message`.
`LiveGrantsWidget` (lines 81–90 of that file) does have a working Retry button using `window.location.reload()`. The main candidates load at line 384 does not. Asymmetric behaviour across two loading contexts on the same page.

### W4 — Filter state not URL-encoded (except initial `?signal=`)
**File:** `apps/web/app/recovery/page.tsx` lines 242–276
`filter` (severity), `signalFilter`, and `recoveryType` all live in component `useState`. Only `recoveryType` receives an initial value from `?signal=` — and only at mount, not bidirectionally. Navigating to `/recovery/[assessment]` and pressing Back resets all three filters to defaults. Back-button triage workflows are broken.

### W5 — No Escape key handler on either dropdown
**File:** `apps/web/app/recovery/page.tsx` lines 282–310
Both `useEffect` close-handlers listen only for `mousedown`. No `keydown` listener for `Escape`. No `onBlur`/focus-out handler for Tab-key navigation. WCAG 2.1 AA criterion 1.4.13 (Content on Hover or Focus) requires dismissal via Escape.

### W6 — Signal count in trigger badge counts firings not candidates
**File:** `apps/web/app/recovery/page.tsx` lines 558–561
```tsx
{signalFilter === "all"
  ? Object.values(data.stats.signalCounts).reduce((s, n) => s + n, 0)
  : data.stats.signalCounts[signalFilter] ?? 0}
```
`signalCounts` is a map of `{signalId: firingCount}`. The "All signals" badge sums ALL counts across all signals — a candidate with 3 signals firing contributes 3 to this total. An officer reading "47" next to the button cannot tell if this means 47 properties or 47 signal detections.

### W7 — Strata Convert gated on filter mode
**File:** `apps/web/app/recovery/page.tsx` line 818
```tsx
showStrataConvert={recoveryType === "strata_conversion"}
```
A property with `mismatch.strata_parent_still_rated` firing shows zero indication of the strata workflow unless the user has selected the Strata Conversion recovery-type filter. The signal itself appears in the `SignalRow` (line 959) but is visually identical to every other badge. There is no "click-to-see-action" affordance. The Convert button on line 985 uses `bg-warn-600` — which is currently invisible (W1).

### W8 — Terminology wall on first load
No inline definition or tooltip for "composite score", "cadastre lag", "estArrears3y", "DMIRS", "VEN", "tenement", or "LGA-1995". All domain terms appear cold. The page sub-text that could explain the promise sits in `text-ink-500 text-sm` (line 444–445) and fades into the `ink-50` background.

---

## Flow gaps

### F1 — No plain-English user promise above the fold
The header reads "Recovery Audit · RatesRecovery · Multi-signal detection". None of those words tell a first-time rates officer what they are about to gain. Stripe's pricing page opens with a dollar figure you will save. This page needs an equivalent: "We found $X,XXX,XXX in recoverable rates across N properties. Here is where to start."

### F2 — The single jaw-drop interaction is buried and broken
The Strata Convert button — which opens a workflow that could reclassify a parent property into N child CTs before the next levy run — is hidden behind a filter, rendered with an invisible colour (W1+W7), and has no contextual explanation. This is the highest-value action in the entire product and it is currently inert.

### F3 — Batch triage workflow has no memory
A clerk running a "Concession review" batch selects the filter, opens candidate #1's evidence pack, presses Back, and is dropped at `/recovery` with filter="all". They must re-select "Concession review" before every candidate. For a council with 40 concession candidates this means 39 extra clicks and 39 context resets. No queue navigation (prev/next) exists.

### F4 — "Showing X of Y" is structurally misleading
At 50/50, the counter is numerically correct (50 of the 50 fetched records match the active filter) but operationally false (there are 450 more on the server). There is no escape hatch.

### F5 — Recovery value headline is hidden in card 4
The highest-signal number on this page — "Total recovery opportunity" — is the fourth stat card in a left-to-right grid. Users scan F-pattern; this number belongs at the top left or as a banner above the cards.

---

## Ambitious recommendations (Stripe / Linear / Apple lens)

### What would make a rates officer jaw drop?

> "Press one button and the system tells me exactly which property to work on next, in priority order, with a pre-drafted notice ready to send."

That is the north star. Every recommendation below moves toward it.

---

### R1 — "Start here" smart queue with one-click next-candidate navigation
**The leap:** Replace the undifferentiated card list with a prioritised *work queue*. The queue is the default view. It shows one candidate at a time (full-bleed detail), with Prev / Next / Skip / Done actions in a sticky bottom bar. Completing one candidate advances automatically. A clerk can triage 20 properties in 20 minutes without ever touching a filter dropdown.

The URL encodes position: `/recovery?queue=high&pos=3` — pressing Next pushes pos=4. Pressing Back from the evidence pack returns to `/recovery?queue=high&pos=3`. Filter state survives navigation.

The bottom bar also shows: "3 of 47 high-severity · $2.1M remaining in this queue." That number makes a director stop and read.

| Dimension | Score |
|---|---|
| Impact | 10 |
| Effort | 5 |
| Ratio | 2.0 |
| Effort (days) | 8 |

---

### R2 — Inline Tailwind warn stops + signal badge colour system (UNBLOCK BLOCKED FEATURES)
**The leap:** This is a 30-minute fix that unblocks $200K+ in visual design. Add `warn-100`, `warn-200`, `warn-300`, `warn-400`, `warn-600` to `tailwind.config.ts`. While there, complete the `success` and `critical` palettes too (they only have 3 stops). While editing the colour system, give each signal *category* a consistent, distinctive hue — register signals are amber, identity signals are violet, spatial are teal. The signal row on each card becomes a scannable colour key, not a wall of same-coloured badges.

Also: add a lint rule (`eslint-plugin-tailwindcss` with the `no-custom-classname` rule restricted to the design token set) so missing colour stops become a CI failure rather than a silent visual regression.

| Dimension | Score |
|---|---|
| Impact | 9 |
| Effort | 1 |
| Ratio | 9.0 |
| Effort (days) | 0.5 |

---

### R3 — "Recovery opportunity" hero banner above the fold
**The leap:** Replace the 4-card grid with a single-line hero statement rendered at the top of the page, above everything:

> **$4,200,000** recoverable across **142 properties** · **23 are actionable today** · Last refreshed 4 min ago

Sub-line: "WA statutory backdating limit: 5 years (LGA s.6.81). Conservative 3y figure used." The numbers reference `data.stats.totalRecovery` and `data.stats.high` — data already in the payload. Nothing new to build.

Below the hero: the 4 cards collapse to a compact 4-column summary row (`high N · medium N · low N · signal X`).

This is the number a council director screenshots and forwards to their CEO. It is the number a clerk walks into a performance review with.

| Dimension | Score |
|---|---|
| Impact | 9 |
| Effort | 2 |
| Ratio | 4.5 |
| Effort (days) | 1 |

---

### R4 — Persistent URL state for all four filter dimensions
**The leap:** Encode `severity`, `recoveryType`, `signalFilter`, and page `offset` into the URL query string. Use `router.replace` (not `push`) so filter changes do not pollute history. Bidirectional: reading URL on mount sets state, state changes write URL.

The secondary effect: every filtered view becomes bookmarkable and shareable. A manager can send `?recoveryType=cadastre_lag&severity=high` to a clerk and they land in exactly the right queue. Links from `/alerts` that deep-link with `?signal=` already partially work — this makes the full system consistent.

| Dimension | Score |
|---|---|
| Impact | 8 |
| Effort | 2 |
| Ratio | 4.0 |
| Effort (days) | 1.5 |

---

### R5 — Pagination with infinite scroll + accurate "X of Y" counter
**The leap:** The API already supports pagination. The UI just needs to consume it. Implement cursor-based loading: fetch the first 50, show them, and when the user scrolls past 80% of the list, fetch the next 50 (offset += 50). Append to the existing list. Render a sticky "Loaded 50 of 312 — scroll to load more" bar at the bottom of the candidate list.

Fix the "Showing X of Y" counter to reference `pagination.total` from the envelope (not `data.mismatches.length`). The fix is a 3-line change once the `pagination` key is extracted from the envelope.

Edge case: when filters are active, "Showing X of Y" should say "Showing X of Y matching [filter] (Z total in database)".

| Dimension | Score |
|---|---|
| Impact | 8 |
| Effort | 3 |
| Ratio | 2.7 |
| Effort (days) | 2 |

---

### R6 — Retry callback on ErrorState + useFetch retry support
**The leap:** Make `useFetch` accept a callback ref so callers can trigger a re-fetch without a hard page reload. Pass `onRetry` to `ErrorState`. The main candidates load gets a Retry button in 20 minutes. While building this, add exponential back-off with jitter (1s, 2s, 4s, max 30s) so transient 429s self-heal without user action.

Secondary: the error message currently surfaces the raw HTTP status string ("500 Internal Server Error"). Replace with human-readable messages: "The server had trouble fetching candidates. Your data is safe — try again." Map 401→"Your session expired — please refresh", 429→"Too many requests — waiting 30 seconds…", 5xx→"Server error — try again".

| Dimension | Score |
|---|---|
| Impact | 7 |
| Effort | 2 |
| Ratio | 3.5 |
| Effort (days) | 1 |

---

### R7 — Always-visible Strata Convert button with signal-aware disclosure
**The leap:** The Convert button should appear on any card where `mismatch.strata_parent_still_rated` is firing, regardless of which filter is active. The `showStrataConvert` prop check (`recoveryType === "strata_conversion"`) is a filter-mode leak into display logic.

Fix: remove the `showStrataConvert` prop. Derive from `hasStrataParent` directly. The Convert button always renders when the signal fires. Add a "1 workflow available" indicator next to the signal badge so officers know a click-through action exists.

The wider principle (Linear/Apple lens): actions surface from data, not from filter modes. A property that needs strata conversion always needs strata conversion.

| Dimension | Score |
|---|---|
| Impact | 8 |
| Effort | 1 |
| Ratio | 8.0 |
| Effort (days) | 0.5 |

---

### R8 — Keyboard-dismiss + focus-trap for dropdowns (WCAG AA)
**The leap:** Add an `onKeyDown` handler to both dropdown containers that closes on `Escape` and traps `Tab` within the open menu. When the menu closes, return focus to the trigger button. This is a 40-line change per dropdown. Consider extracting a `<Dropdown>` primitive that both reuse — the current duplication (same `useEffect` pattern twice at lines 282–310) is a maintenance liability.

| Dimension | Score |
|---|---|
| Impact | 6 |
| Effort | 1 |
| Ratio | 6.0 |
| Effort (days) | 0.5 |

---

### R9 — Inline glossary: hover-tooltip definitions for domain terms
**The leap:** Every domain term that appears in the UI (`composite score`, `cadastre lag`, `DMIRS`, `tenement`, `VEN`, `estArrears3y`, `LGA s.6.81`) gets a `<dfn>` element with a tooltip on hover. The tooltip text is one plain-English sentence.

Example:
- "cadastre lag" → "DMIRS has granted a mining tenement but Landgate's map hasn't been updated yet — this is your highest-confidence recovery window."
- "composite score" → "A weighted sum of all signals firing on this property. 100% = maximum confidence. Used to rank candidates."
- "estArrears3y" → "Estimated rates owed for the 3 years before today, calculated conservatively within the WA statutory limit."

Build a shared `<Tooltip term="cadastre_lag" />` component. Terms defined once in a constants file. Zero domain knowledge required to use the dashboard after this ships.

| Dimension | Score |
|---|---|
| Impact | 7 |
| Effort | 2 |
| Ratio | 3.5 |
| Effort (days) | 1.5 |

---

### R10 — AI-drafted notice generator (the jaw-drop moment for a director)
**The leap:** On the evidence pack page, add a "Draft notice" button. One click generates a pre-populated formal notice to the ratepayer using the evidence pack data:

> "Dear [Proprietor], Council reference [assessment]. Our records, cross-referenced against the DMIRS mining register and Landgate title records, indicate that the land use classification for [address] may require amendment from [current] to [correct]. The statutory basis is [LGA 1995 s.6.76]. Estimated liability: $X,XXX. Please contact [officer] by [date]."

The draft is editable inline before send/export. It cites specific signal evidence. It includes the backdating calculation. It references the exact statutory section.

This is what a council director forwards to their peers. "Our rates system drafts the notice for us." It takes a 2-hour task (researching, drafting, cross-referencing) and makes it a 10-second review.

Implementation: a `/api/evidence/[assessment]/notice` route that interpolates the pack's data into a notice template. No LLM required for v1 — pure template interpolation from fields already in the evidence pack. Add LLM refinement in v2 once the template is validated.

| Dimension | Score |
|---|---|
| Impact | 10 |
| Effort | 4 |
| Ratio | 2.5 |
| Effort (days) | 5 |

---

### R11 — Signal count disambiguation: candidates vs. firings
**The leap:** Fix the trigger badge in the signal-filter dropdown to show candidate count, not firing count.

Current (line 559):
```tsx
Object.values(data.stats.signalCounts).reduce((s, n) => s + n, 0)
```
Correct:
```tsx
data.mismatches.length
```
And for per-signal options: `{count} detections · {candidateCount} properties` where `candidateCount` is computed at render from the already-memoised `signalSamples` map.

| Dimension | Score |
|---|---|
| Impact | 5 |
| Effort | 1 |
| Ratio | 5.0 |
| Effort (days) | 0.25 |

---

### R12 — Predictive triage: "Next best action" chip per candidate card
**The leap:** Each candidate card carries a single "Next best action" chip derived from its top signal:

- Cadastre lag → "Request updated Landgate extract"
- Strata parent → "Open strata conversion"
- Concession review → "Cross-check Water Corp eligibility"
- Recently granted → "Issue rate notice within 90-day window"
- Title mismatch → "Commission CT search"

The chip replaces the current `View pack →` text link with a named, opinionated action. Officers who do not know the domain can still work the queue. The action is a link to the evidence pack (same destination) but the label communicates intent.

| Dimension | Score |
|---|---|
| Impact | 7 |
| Effort | 2 |
| Ratio | 3.5 |
| Effort (days) | 1 |

---

## Ranked recommendations (by impact/effort ratio)

| # | Title | Impact | Effort | Ratio | Days |
|---|---|---|---|---|---|
| R2 | Fix missing Tailwind warn stops | 9 | 1 | 9.0 | 0.5 |
| R7 | Always-visible Strata Convert button | 8 | 1 | 8.0 | 0.5 |
| R8 | Keyboard-dismiss for dropdowns (WCAG) | 6 | 1 | 6.0 | 0.5 |
| R11 | Fix signal count disambiguation | 5 | 1 | 5.0 | 0.25 |
| R3 | Recovery opportunity hero banner | 9 | 2 | 4.5 | 1.0 |
| R4 | Persistent URL filter state | 8 | 2 | 4.0 | 1.5 |
| R6 | Retry callback + human-readable errors | 7 | 2 | 3.5 | 1.0 |
| R9 | Inline glossary tooltips | 7 | 2 | 3.5 | 1.5 |
| R12 | "Next best action" chip per card | 7 | 2 | 3.5 | 1.0 |
| R5 | Pagination with infinite scroll | 8 | 3 | 2.7 | 2.0 |
| R1 | Smart queue with prev/next navigation | 10 | 5 | 2.0 | 8.0 |
| R10 | AI-drafted notice generator | 10 | 4 | 2.5 | 5.0 |

---

## What to REMOVE to gain simplicity

1. **The LiveGrantsWidget from the /recovery page.** It is a second data source, a second loading state, a second error state, and a second API call — all on a page that already loads candidates. The grants feed belongs on `/alerts`. On `/recovery` it interrupts the triage workflow. Move it to a collapsible "Live feed" panel in the sidebar or remove it entirely from this page.

2. **The `useFetch` URL-to-`recoveryType` effect.** The current `initialRecoveryType` IIFE at lines 260–273 is over-engineered. Once URL state (R4) is implemented bidirectionally, this bootstrap becomes a one-liner. The IIFE is a workaround for the lack of proper URL state.

3. **The `signalFilter` dropdown from /recovery.** Officers filter by signal when they want to drill a specific signal. But they already have the recovery-type filter for that. Two orthogonal filter dimensions on the same list create combinatorial complexity. Replace with a single "Recovery type" filter that includes the signal-level options as sub-items. The signal catalogue link stays; the per-signal filter moves to the catalogue page `/signals`.

4. **The severity pill row as a separate control.** Severity should be embedded in the recovery-type filter, not a separate row. "High-severity cadastre lag" is one selection, not two. Collapsing the two filter controls into one unified filter dropdown removes the most visually cluttered part of the page.

5. **The `<code>` assessment number display on every card as the primary identifier.** Assessment numbers (`A1234567`) are internal codes. On-screen the primary identifier should be the street address. Swap the visual hierarchy: address large and bold, assessment number in `text-xs text-ink-400` beside it.

---

## The single jaw-drop moment

**One-click notice drafting from an evidence pack.**

A rates officer, during the council pilot, opens an evidence pack for a cadastre-lag candidate. The pack shows $14,000 in estimated arrears. They press "Draft notice". A complete, formally worded, LGA-s.6.76-referenced rate notice appears — pre-populated with the proprietor's name, the property address, the specific tenement grant date, the computed liability, and the backdating calculation. The officer reads it in 15 seconds, makes one edit, and exports it as a PDF.

The officer turns to their manager and says "The system wrote the notice."

That is the moment a council director forwards to their peers. That is the moment this feels like the future of council software. Nothing else on the page comes close.

---

## Projected score after implementing R1–R12

| Dimension | Before | After |
|---|---|---|
| Correctness | 7 | 9 |
| Robustness | 5 | 9 |
| Speed | 8 | 9 |
| Clarity | 5 | 9 |
| Delight | 3 | 9 |
| "Would the 0.0001% ship this?" | 4 | 9 |
| **Overall** | **59** | **90** |

Implementing R2 + R7 + R8 + R11 alone (2 days of work, zero architectural change) moves the score from 59 to approximately 70 by unblocking broken visuals and fixing the three worst correctness defects.

R3 + R4 + R6 + R9 + R12 (add 6 more days) gets to approximately 82.

R1 + R5 + R10 (add 15 more days) gets to 90+.

---

## Branches required before any build

All implementation work must happen on a feature branch per the gate-irreversible rail. Suggested branch names:
- `fix/recovery-tailwind-warn-stops` — R2 (immediate, unblocks everything)
- `fix/recovery-strata-button-filter-leak` — R7
- `fix/recovery-keyboard-dismiss` — R8
- `feat/recovery-url-filter-state` — R4 + R11
- `feat/recovery-pagination` — R5
- `feat/recovery-retry-errors` — R6
- `feat/recovery-hero-banner` — R3
- `feat/recovery-glossary-tooltips` — R9
- `feat/recovery-next-best-action` — R12
- `feat/recovery-smart-queue` — R1
- `feat/recovery-notice-drafter` — R10

No merge or deploy without explicit sign-off.

---

*End of elevation report. Next step: Brodie selects which recommendations to implement. Recommended starting order: R2 → R7 → R8 → R11 (the four quick wins that unblock broken features and require zero architecture change).*
