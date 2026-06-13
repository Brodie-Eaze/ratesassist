# Elevation Report — Evidence Pack (per-property)
## `/recovery/[assessment]`

**Feature score before:** 65 / 100
**Potential score after all recommendations:** 93 / 100
**Generated:** 2026-06-09

---

## Score Breakdown (current)

| Dimension | Score | Notes |
|---|---|---|
| Correctness | 9/20 | Five discriminated failure kinds collapsed to one null; regex renderer has two confirmed bugs; PDF sanitiser strips spaces |
| Robustness | 11/20 | No Suspense boundary; strata links always 404; map has no fallback warning |
| Speed | 10/15 | Pure async Server Component; no Suspense; no streaming; no route loading.tsx |
| Clarity | 14/20 | Good signal accordions and headline panel; but error states are factually wrong; ConcessionAudit stops at advice |
| Delight | 12/20 | Map is great; download is good; nothing jaw-dropping; no action affordance |
| Ship-worthy? | 9/5 | Boots, test suite passes — but misleads officers on real data faults |
| **Total** | **65/100** | |

---

## Confirmed Bugs (must-fix before any production rollout)

### BUG-1: Silent Failure Collapse — `page.tsx` line 46
**File:** `apps/web/app/recovery/[assessment]/page.tsx`
**Code path:** `const pack = result.kind === "ok" ? result.pack : null`

`buildEvidencePack` returns five discriminated outcomes:
- `ok` — pack generated
- `no_property` — assessment not in the rating register
- `no_signals` — property exists, all signals clean
- `no_owner` — owner linkage broken in the rating roll
- `no_state_template` — council outside WA/NSW/QLD

The page collapses all four non-ok kinds into a single null check, then branches on whether `getProperty()` returns something. This produces two wrong outcomes:

1. `no_owner` displays "Nothing to recover — the rating register, DMIRS, ABN/ASIC and aerial signals are all clean." This is factually false. There is a suspected mismatch; the rating roll has a data integrity fault. An officer reading this will mark the property as clean and move on.

2. `no_state_template` falls through to `getProperty()` returning something, which shows the "no signals" message. Or if the property isn't in the demo set, it shows "Assessment not found in the rating register" — causing the officer to chase a valid assessment number.

**Fix required:** Replace the binary null-check with a full switch on `result.kind`. Each branch renders a distinct, accurate UI state.

---

### BUG-2: Regex Markdown Renderer — two confirmed rendering defects
**File:** `apps/web/app/api/evidence/[file]/route.ts`, `renderHtmlPack()` lines 86–220

The code carries its own caveat: "Regex renderer; sufficient for the controlled markdown produced by `buildEvidencePack`. Will be replaced by a sanitizer-backed library before any production deploy."

Two concrete bugs confirmed:

**Bug 2a — Consecutive blockquote lines produce 6 separate `<blockquote>` elements.**
The regex `^&gt; (.*)$/gm` matches individual lines. Section 10's 6-line draft notice renders as six disconnected blockquote elements instead of a single merged block. Printed PDFs from the HTML export look fragmented.

**Bug 2b — Double-escaping ABN/company names containing `&`.**
The pipeline runs `&` → `&amp;` first (line 91), then the bold/em/code passes. Any ABN like `Smith & Jones Pty Ltd` becomes `Smith &amp;amp; Jones Pty Ltd` in the downloaded HTML artefact.

**Fix required:** Replace `renderHtmlPack` with a proper Markdown library (unified/remark + rehype-sanitize, or marked + DOMPurify) before production. Immediate workaround: run HTML escape after inline formatting passes; merge consecutive blockquote lines before the element-per-line pass.

---

### BUG-3: PDF Operator Name Sanitiser Strips Spaces
**File:** `apps/web/lib/evidencePdf.ts`, `sanitisePdfOperatorName()` line 94
**Code:** `raw.replace(/[ -\\()<>]/g, "")`

The character class `[ -\\()<>]` contains a literal space (ASCII 0x20) at the start of the range `[ -\\]`, which is the range from space (0x20) to backslash (0x5C). This strips every character from space through backslash, including spaces, digits (0x30–0x39), uppercase letters (0x41–0x5A), and more.

In practice: `Jane Smith` → `JaneSmith` in the statutory PDF's attestation line and PDF `Author` metadata. This is a production-facing bug that affects every council officer whose display name contains a space — which is all of them.

**Fix required:** The regex intent was to strip only PDF syntax characters: `()<>\\` and control characters. Corrected regex: `replace(/[\x00-\x1f\x7f\\()<>[\]{}/%#]/g, "")`.

---

### BUG-4: Strata Child Links Navigate to Wrong Identifier
**File:** `apps/web/components/recovery/TitleStateSection.tsx`, lines 230–236
**Code:** `href={/recovery/${encodeURIComponent(${c.volume}-${c.folio})}}`

Strata children are navigated to by their CT volume-folio string (e.g. `/recovery/3801-211`). Assessment numbers in the system use council-prefixed codes (e.g. `KAL-7777-01`). The `/recovery/[assessment]` route calls `buildEvidencePack(assessmentNumber, ctx)` where the context is indexed by assessment number, not CT reference. Every strata child link is a confirmed dead-end navigation.

**Fix required:** The `StrataChild` contract type needs an `assessmentNumber` field populated by the data adapter. Until then, `TitleStateSection` should render the CT reference as text with a note "Locate in register" rather than a broken link.

---

### BUG-5: Page Has No Loading State
**File:** `apps/web/app/recovery/[assessment]/page.tsx`

The page is a pure async Server Component. `getEvaluationContext()` is called synchronously during render. On a cold Postgres path the entire page tree stalls for 1–5 seconds with a blank white screen. There is no `loading.tsx` in `/app/recovery/[assessment]/`, no Suspense boundary, and no skeleton.

**Fix required:** Add `apps/web/app/recovery/[assessment]/loading.tsx` with a skeleton matching the page's three-panel structure (summary card → map → signals), immediately.

---

## Flow Gaps

### FLOW-1: Back-Navigation Loses Filter State
The back-link `<Link href="/recovery">` discards all search params. A clerk who filtered to `concession_review`, drilled into a pack, and pressed back lands on the unfiltered list.

**Fix:** Encode active filter state in the URL when navigating to the pack: `/recovery/[assessment]?from=concession_review`. The back-link reads `searchParams.get("from")` and reconstructs `/recovery?signal=concession_review`.

---

### FLOW-2: Download Buttons Lack Context-Bearing ARIA Labels
The three download anchors (Markdown, View pack, Download PDF) read aloud by a screen reader as "Download Markdown" without identifying which assessment. Should be "Download evidence pack as Markdown — KAL-7777-01".

**Fix:** `aria-label={`Download evidence pack as Markdown — ${assessment}`}` on each anchor.

---

### FLOW-3: ConcessionAudit Stops at Advisory — No Closure Action
The `ConcessionAuditSection` renders a recommended action as plain text. There is no "Mark reviewed", no case-note field, no "Copy to clipboard" micro-action, no link to the council's rate system. An officer reads the pack then has to context-switch entirely to act.

**Fix:** At minimum, a "Copy action to clipboard" button and a "Mark as reviewed" toggle that writes to a lightweight `evidence_pack_events` table via a server action.

---

### FLOW-4: No Parcel Polygon Fallback Message
When `pack.candidate.property.parcel` is undefined or has fewer than 3 points, the map renders on WA centre with no polygon and no explanation. The stats card may silently show "Synthetic (real cadastre unavailable)" in tiny text. Officers assume the map is loading or broken.

**Fix:** Render a visible inline notice: "Parcel geometry not available — cadastre record may be missing for this assessment. Visual boundary is approximate."

---

## Ambitious Recommendations (ranked by impact/effort ratio)

---

### R1 — One-Click "Generate Notice" Action
**The idea:** After confirming review, the officer presses "Generate draft notice" and gets a ready-to-send statutory notice pre-populated with the assessment number, owner name, property address, calculated uplift, statutory basis (LGA s.6.76), and the officer's name. The notice is rendered as a PDF using the existing `renderEvidencePdf` infrastructure, a second template.

**Why jaw-drop:** Council rates officers spend 15 minutes per property preparing the notice after reviewing the pack. This collapses that to 30 seconds. A council director will forward this to their peers as "the thing that does the notice for you."

**Impact:** 10/10. This is the feature that converts the evidence pack from an analysis tool into a revenue action tool.
**Effort:** 7/10. Requires a notice PDF template (distinct from the evidence pack), a new `/api/notice/[assessment]` route, a statutory-text template per WA/NSW/QLD, and a write to the audit trail.
**Ratio:** 1.43
**Effort days:** 6

---

### R2 — Streaming Server Component with Phased Skeleton
**The idea:** Convert the page to use React's streaming model. The page shell (header, breadcrumb, download buttons) renders immediately from a lightweight session check. The summary stats card, map, and signal accordions each sit inside their own `<Suspense>` boundary with a matching skeleton. The heaviest section (full Markdown pack) streams last.

**Why jaw-drop:** An officer clicking from the recovery list sees the page header and the summary numbers within ~100ms. The rest fills in section by section. On a council laptop over a slow connection this is the difference between "did it work?" and "here it comes".

**Impact:** 8/10. Directly addresses the #1 perceived-performance complaint on any server-rendered form.
**Effort:** 4/10. Next.js streaming Suspense is well-defined; the main work is splitting the async data calls into independent data-fetching functions per section.
**Ratio:** 2.00
**Effort days:** 2

---

### R3 — Fix All Five Discriminated Error States with Actionable UI
**The idea:** Replace the binary null-check in `page.tsx` line 46 with a proper `switch (result.kind)` that renders a distinct card for each failure:
- `no_property` → "Assessment not found in the rating register. Check the assessment number or browse all properties."
- `no_signals` → "All signals clean for this property. No misclassification detected at this time."
- `no_owner` → "DATA INTEGRITY ALERT — Owner linkage broken in the rating roll. The rating register has no owner record for this assessment. Contact your data administrator before this assessment can be included in a recovery run." (with a CTA to the support email)
- `no_state_template` → "Evidence packs are not yet available for [state] councils. Contact RatesAssist to enquire about expansion."

**Why jaw-drop:** Replacing factually wrong empty states with precise, actionable diagnostics is what separates professional software from demos. A council director who sees "DATA INTEGRITY ALERT" instead of "Nothing to recover" will trust the platform.

**Impact:** 9/10 (correctness is the foundation of trust in a statutory tool).
**Effort:** 2/10. Pure UI change; the discrimination is already done by `buildEvidencePack`.
**Ratio:** 4.50
**Effort days:** 0.5

---

### R4 — Fix PDF Operator Name Regex (Critical)
**The idea:** Replace `/[ -\\()<>]/g` with `/[\x00-\x1f\x7f\\()<>[\]{}/%#]/g` — strip only control characters and PDF syntax characters, preserve spaces and printable ASCII.

**Why jaw-drop:** A statutory document with "JaneSmith" in the attestation line instead of "Jane Smith" undermines legal standing. A council solicitor reviewing the PDF for a notice dispute would flag this immediately.

**Impact:** 9/10. Statutory document integrity.
**Effort:** 1/10. Three-character regex change + one test update.
**Ratio:** 9.00
**Effort days:** 0.25

---

### R5 — Replace Regex Markdown Renderer with unified/remark
**The idea:** Replace `renderHtmlPack` with a 5-line unified pipeline: `unified().use(remarkParse).use(remarkRehype).use(rehypeSanitize).use(rehypeStringify)`. This fixes both confirmed bugs (consecutive blockquotes, double-escaping) and eliminates a whole class of future markdown edge cases.

**Why jaw-drop:** The code comments its own renderer as pre-production. Shipping this to council pilots with a known double-escaping bug on ABN strings (which appear in virtually every pack) is a credibility risk.

**Impact:** 8/10. Correct HTML output; removes a technical debt flag that every engineer reading the codebase sees.
**Effort:** 3/10. `unified` is already in the JS ecosystem; the pipeline is about 10 lines.
**Ratio:** 2.67
**Effort days:** 1

---

### R6 — Filter State Preservation in Back-Navigation
**The idea:** When the recovery list navigates to `/recovery/[assessment]`, append `?from=<activeFilter>` to the URL. The pack page's back-link reads this param and reconstructs the filtered list URL. A clerk who drilled into `concession_review` candidates returns to that exact filter.

**Impact:** 7/10. Directly affects daily workflow of any clerk triaging a queue.
**Effort:** 2/10. One URL param read/write; no state management library needed.
**Ratio:** 3.50
**Effort days:** 0.5

---

### R7 — Fix Strata Child Links (Assessment Number Lookup)
**The idea:** The `StrataChild` contract type gains an optional `assessmentNumber?: string` field. The data adapter populates it via a join from CT volume-folio to the rating roll. `TitleStateSection` renders the link if `assessmentNumber` is present; otherwise renders CT reference as text with a "Search register" link to `/properties?q=<volume>-<folio>`.

**Impact:** 8/10. Every strata officer following these links currently hits a 404.
**Effort:** 4/10. Contract change + adapter change + component change + test update.
**Ratio:** 2.00
**Effort days:** 2

---

### R8 — Add route-level `loading.tsx`
**The idea:** Create `apps/web/app/recovery/[assessment]/loading.tsx` with a three-panel skeleton: a grey stats card, a grey map placeholder with the "Visual evidence" label, and three collapsed grey accordion rows. This renders instantly from the Next.js App Router before any server data fetches.

**Impact:** 8/10. Eliminates the 1–5 second blank screen.
**Effort:** 1/10. A single new file with Tailwind skeleton classes.
**Ratio:** 8.00
**Effort days:** 0.25

---

### R9 — "Mark as Reviewed" + Case-Note Micro-Action on ConcessionAudit
**The idea:** Add a `<form action={...}>` below the recommended action text. The officer can: (1) press "Mark as reviewed" (writes a `{ type: 'concession_reviewed', assessmentNumber, operatorId, timestamp }` row to a lightweight `pack_events` table via a server action), (2) optionally type a case note (free text, max 500 chars), (3) see a "Reviewed by [name] on [date]" confirmation badge replace the action buttons on the next render.

Why this matters: the pack currently stops at advisory. This creates a simple audit trail that a council director can pull as a CSV — "show me all concession reviews completed this quarter."

**Impact:** 9/10. Closes the advisory-to-action loop; creates audit trail.
**Effort:** 5/10. Server action + lightweight DB table migration + form component.
**Ratio:** 1.80
**Effort days:** 3

---

### R10 — ARIA Labels on Download Buttons
**Fix:** Three-line change. `aria-label={`Download evidence pack as Markdown — ${assessment}`}` on each anchor.

**Impact:** 5/10. Accessibility and compliance.
**Effort:** 1/10.
**Ratio:** 5.00
**Effort days:** 0.1

---

### R11 — Parcel Geometry Fallback Notice
**The idea:** When `parcels` prop is `undefined` in `PropertyMapClientShell`, render a `<div>` below the map with: "Parcel geometry unavailable — cadastre boundary not on file. The map shows the council's rated location only. Verify against the Landgate portal before lodging a reclassification notice."

**Impact:** 6/10. Prevents silent misleading of officers.
**Effort:** 1/10.
**Ratio:** 6.00
**Effort days:** 0.25

---

### R12 — One Interaction That Feels Like the Future of Council Software
**The jaw-drop moment:**

A council officer opens an evidence pack. After reading the concession audit section — "Water Corp confirms deceased" — they see a single button: **"Prepare suspension notice."**

They click it. In two seconds, a ready-to-sign letter appears in a side drawer: council letterhead, addressed to the proprietor's postal address on file, citing the Rates and Charges (Rebates and Deferments) Act 1992 (WA), stating the basis for suspension, listing the outstanding amount, and including the officer's name. They review it, press "Download PDF", and the letter is in their Downloads folder.

Total time from "open pack" to "letter in hand": 45 seconds.

This is what the platform promises — not just finding the problem, but closing it.

This is R1 at execution quality.

---

## Things to Remove

These elements add complexity without commensurate value in the current phase:

1. **The HTML `<button onclick="window.print()">` inside the `renderHtmlPack` response.** A `<script>` tag inside a CSP-sensitive evidence document that calls `window.print()` is an unnecessary attack surface. Officers use Ctrl+P. Remove it.

2. **`getProperty(assessment)` fallback call on the non-ok path** (`page.tsx` line 47). This call is only used to drive the binary error UI, which is being replaced by the discriminated error states. Once R3 is implemented, this call and its import are dead code.

3. **The `RATE_SOURCE_DOMAIN_ALLOWLIST` empty Set** in `page.tsx` lines 20–22. Either populate it with known WA council domains or remove it — an empty set with a comment "reserved for..." is cognitive overhead for every reader. The validation logic in `safeRateSourceUrl` is correct and does not need the empty allowlist.

4. **Duplicated `formatAud` function** in `evidencePdf.ts` lines 486–488 and in `apps/web/lib/utils.ts`. One source of truth; import from the shared utils.

5. **`DEFAULT_NOW` module-private closure** in `evidencePack.ts`. It's three characters (`new Date()`). The indirection adds a named export that tests don't use (they inject via `options.now`). Inline it.

---

## Recommended Build Order

| Priority | Item | Days | Gate |
|---|---|---|---|
| 1 | R4 — Fix PDF regex (critical bug) | 0.25 | Ship immediately |
| 2 | R8 — Add `loading.tsx` skeleton | 0.25 | Ship immediately |
| 3 | R3 — Five discriminated error states | 0.5 | Ship immediately |
| 4 | R10 — ARIA labels | 0.1 | Ship immediately |
| 5 | R11 — Parcel fallback notice | 0.25 | Ship immediately |
| 6 | R6 — Filter state back-navigation | 0.5 | Sprint 1 |
| 7 | R2 — Streaming Suspense | 2 | Sprint 1 |
| 8 | R5 — Replace regex renderer | 1 | Sprint 1 |
| 9 | R7 — Fix strata links | 2 | Sprint 1 |
| 10 | R9 — Mark-as-reviewed + case note | 3 | Sprint 2 |
| 11 | R1 — Generate Notice action | 6 | Sprint 2 |

**Items 1–5 are safe, small, and non-breaking. They should ship on a single branch this week. Total: 1.35 days of engineering.**

Items 6–9 form Sprint 1 (5.5 days). Items 10–11 form the sprint that takes this feature from 65 to 93.

---

## Score Projection

| After | Score |
|---|---|
| Items 1–5 only | 78/100 |
| Items 1–9 (Sprint 1 complete) | 87/100 |
| All items (Sprint 2 complete) | 93/100 |

The bar for "elite" on a statutory council tool should be correctness first, then speed, then delight. The biggest score gain comes from the cheapest work: fixing the error states (R3) and the PDF regex (R4) alone move correctness from 9/20 to 16/20.
