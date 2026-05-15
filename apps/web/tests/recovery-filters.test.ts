/**
 * Recovery dashboard — filter regression tests.
 *
 * The vitest harness is Node-only with no DOM, so this file pins the
 * contract the dashboard renders against:
 *
 *   - The page-source declares each new filter (title-mismatch,
 *     concession-review, strata-conversion), the families of signal ids
 *     they cover, and the `?signal=<family>` URL parameter that
 *     pre-applies the filter.
 *   - The dashboard exposes those filters via a single "Recovery type"
 *     dropdown rather than the older 6-pill row — the data-testids
 *     covered here are the dropdown's option ids.
 *   - The mock data exposes the right number of candidates per family so
 *     the filter counts on the dashboard are non-zero. This is a key
 *     regression-prevention check — if the upstream fixtures stop firing
 *     the new signals, the demo presentation collapses.
 *   - The strata-conversion family includes a "Convert →" affordance
 *     linking to /strata/<assessment>.
 *
 * Rendering the React tree would require a DOM + react-leaflet bypass
 * which is out of scope for this harness (see property-map.test.ts for
 * the precedent). The next layer up — Playwright e2e — exercises the
 * actual button clicks; here we lock the source-level contract instead.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";

vi.resetModules();

beforeAll(async () => {
  // Force re-build of the in-memory EvaluationContext using the new
  // overlay so the engine sees the council-side VEN/CT fields.
  const { invalidateEvaluationContext } = await import("../lib/clients");
  await invalidateEvaluationContext();
});

// ----------------------------------------------------------------------------
// 1) Page source contract — the dashboard declares the new filters.
// ----------------------------------------------------------------------------

describe("recovery dashboard — new filters declared", () => {
  const src = readFileSync(
    join(__dirname, "..", "app", "recovery", "page.tsx"),
    "utf8",
  );

  it("declares the title-mismatch signal-id family (5 register/identity signals)", () => {
    expect(src).toContain("TITLE_MISMATCH_SIGNAL_IDS");
    expect(src).toContain("mismatch.proprietor");
    expect(src).toContain("mismatch.ct_number_changed");
    expect(src).toContain("mismatch.encumbrance_added");
    expect(src).toContain("mismatch.pin_landuse_diverges");
    expect(src).toContain("mismatch.pin_missing_from_record");
  });

  it("declares the concession-review signal-id family (4 pensioner signals)", () => {
    expect(src).toContain("CONCESSION_REVIEW_SIGNAL_IDS");
    expect(src).toContain("id.pensioner_deceased_continued_rebate");
    expect(src).toContain("id.pensioner_eligibility_cancelled");
    expect(src).toContain("id.pensioner_card_expired");
    expect(src).toContain("id.pensioner_not_at_property");
  });

  it("declares the strata-conversion signal id", () => {
    expect(src).toContain("STRATA_CONVERSION_SIGNAL_ID");
    expect(src).toContain("mismatch.strata_parent_still_rated");
  });

  it("exposes a single Recovery-type dropdown trigger (replaces the 6 pills)", () => {
    expect(src).toContain('data-testid="recovery-type-dropdown"');
    expect(src).toContain('data-testid="recovery-type-trigger"');
    expect(src).toContain('data-testid="recovery-type-options"');
  });

  it("renders a Title-mismatch option in the Recovery-type dropdown", () => {
    expect(src).toContain('data-testid={`recovery-type-option-${opt.value}`}');
    expect(src).toContain('value: "title_mismatch"');
    expect(src).toContain('label: "Title mismatch"');
  });

  it("renders a Concession-review option in the Recovery-type dropdown", () => {
    expect(src).toContain('value: "concession_review"');
    expect(src).toContain('label: "Concession review"');
  });

  it("renders a Strata-conversion option in the Recovery-type dropdown", () => {
    expect(src).toContain('value: "strata_conversion"');
    expect(src).toContain('label: "Strata conversion"');
  });

  it("honours ?signal=title_mismatch / concession_review / strata_conversion URL params", () => {
    expect(src).toContain('sig === "title_mismatch"');
    expect(src).toContain('sig === "concession_review"');
    expect(src).toContain('sig === "strata_conversion"');
  });

  it("rows under the strata-conversion filter expose a Convert button (Link to /strata/<assessment>)", () => {
    expect(src).toContain("strata-convert-link");
    expect(src).toContain("/strata/${c.assessmentNumber}");
  });

  it("the dropdown options carry aria-selected reflecting which one is active", () => {
    const ariaSelectedMatches = src.match(/aria-selected=\{[^}]+\}/g) ?? [];
    // 1 for the All-recovery-types option + 1 inside the dynamic
    // RECOVERY_TYPE_OPTIONS.map render = at least 2 matches.
    expect(ariaSelectedMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("the dropdown lists every previously-pill recovery type as an option", () => {
    // The dropdown is data-driven from RECOVERY_TYPE_OPTIONS. Each value
    // must be present at module scope so the menu renders the same six
    // pills the old UI exposed.
    expect(src).toContain('value: "recently_granted"');
    expect(src).toContain('value: "cadastre_lag"');
    expect(src).toContain('value: "address_mismatch"');
    expect(src).toContain('value: "title_mismatch"');
    expect(src).toContain('value: "concession_review"');
    expect(src).toContain('value: "strata_conversion"');
  });

  it("the signal-breakdown card is collapsed behind a toggle (not always-rendered)", () => {
    // The 18-chip signal grid used to dominate the page on every load.
    // It now renders only when the user clicks "Show signal breakdown",
    // gated by `showSignalBreakdown && (...)`. Pin that.
    expect(src).toContain('data-testid="toggle-signal-breakdown"');
    expect(src).toContain("showSignalBreakdown");
    expect(src).toMatch(/showSignalBreakdown\s*&&\s*\(/);
  });
});

// ----------------------------------------------------------------------------
// 2) Engine output — the new signals actually fire on the demo dataset.
// ----------------------------------------------------------------------------

describe("recovery dashboard — fixtures fire the new signal families", () => {
  it("the demo EvaluationContext carries Landgate + WC + deceased fixtures", async () => {
    const { getEvaluationContext } = await import("../lib/clients");
    const ctx = getEvaluationContext();
    expect(ctx.landgateRecordsByVen).toBeDefined();
    expect(ctx.landgateRecordsByVen!.size).toBeGreaterThanOrEqual(4);
    expect(ctx.waterCorpEligibilityByCardOrProprietor).toBeDefined();
    expect(ctx.waterCorpEligibilityByCardOrProprietor!.size).toBeGreaterThanOrEqual(3);
    expect(ctx.proprietorDeceasedReferences).toBeDefined();
    expect(ctx.proprietorDeceasedReferences!.size).toBeGreaterThanOrEqual(1);
  });

  it("recovery sweep produces at least one candidate per new signal family", async () => {
    const { getEvaluationContext } = await import("../lib/clients");
    const { findMismatches } = await import("@ratesassist/recovery-engine");
    const ctx = getEvaluationContext();
    const candidates = findMismatches(ctx);
    const ids = new Set<string>();
    for (const c of candidates) for (const s of c.signals) ids.add(s.id);

    // Title-mismatch family — at least one signal in the family must fire.
    const titleFamily = [
      "mismatch.proprietor",
      "mismatch.ct_number_changed",
      "mismatch.encumbrance_added",
      "mismatch.pin_landuse_diverges",
      "mismatch.pin_missing_from_record",
    ];
    const titleFiring = titleFamily.filter((id) => ids.has(id));
    expect(titleFiring.length).toBeGreaterThanOrEqual(1);

    // Concession-review family — at least one signal in the family must fire.
    const concessionFamily = [
      "id.pensioner_deceased_continued_rebate",
      "id.pensioner_eligibility_cancelled",
      "id.pensioner_card_expired",
      "id.pensioner_not_at_property",
    ];
    const concessionFiring = concessionFamily.filter((id) => ids.has(id));
    expect(concessionFiring.length).toBeGreaterThanOrEqual(1);

    // Strata-conversion family — exactly the single driver.
    expect(ids.has("mismatch.strata_parent_still_rated")).toBe(true);
  });

  it("the strata-parent candidate is KAL-7777-01 (Hannan Street Kalgoorlie)", async () => {
    const { getEvaluationContext } = await import("../lib/clients");
    const { findMismatches } = await import("@ratesassist/recovery-engine");
    const ctx = getEvaluationContext();
    const candidates = findMismatches(ctx);
    const strataCandidates = candidates.filter((c) =>
      c.signals.some((s) => s.id === "mismatch.strata_parent_still_rated"),
    );
    expect(strataCandidates.length).toBeGreaterThanOrEqual(1);
    expect(strataCandidates.map((c) => c.assessmentNumber)).toContain(
      "KAL-7777-01",
    );
  });

  it("the deceased proprietor signal fires for TPS-3041-44 (Margaret Thompson)", async () => {
    const { getEvaluationContext } = await import("../lib/clients");
    const { findMismatches } = await import("@ratesassist/recovery-engine");
    const ctx = getEvaluationContext();
    const candidates = findMismatches(ctx);
    const found = candidates.find((c) => c.assessmentNumber === "TPS-3041-44");
    expect(found).toBeDefined();
    expect(found!.signals.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        "id.pensioner_deceased_continued_rebate",
        "id.proprietor_deceased",
      ]),
    );
  });

  it("the cancelled-eligibility signal fires for TPS-1102-47", async () => {
    const { getEvaluationContext } = await import("../lib/clients");
    const { findMismatches } = await import("@ratesassist/recovery-engine");
    const ctx = getEvaluationContext();
    const candidates = findMismatches(ctx);
    const found = candidates.find((c) => c.assessmentNumber === "TPS-1102-47");
    expect(found).toBeDefined();
    expect(found!.signals.map((s) => s.id)).toContain(
      "id.pensioner_eligibility_cancelled",
    );
  });

  it("the expired-card signal fires for ESH-1102-71", async () => {
    const { getEvaluationContext } = await import("../lib/clients");
    const { findMismatches } = await import("@ratesassist/recovery-engine");
    const ctx = getEvaluationContext();
    const candidates = findMismatches(ctx);
    const found = candidates.find((c) => c.assessmentNumber === "ESH-1102-71");
    expect(found).toBeDefined();
    expect(found!.signals.map((s) => s.id)).toContain(
      "id.pensioner_card_expired",
    );
  });

  it("the proprietor-mismatch signal fires for TPS-3041-12 (JONES vs SMITH)", async () => {
    const { getEvaluationContext } = await import("../lib/clients");
    const { findMismatches } = await import("@ratesassist/recovery-engine");
    const ctx = getEvaluationContext();
    const candidates = findMismatches(ctx);
    const found = candidates.find((c) => c.assessmentNumber === "TPS-3041-12");
    expect(found).toBeDefined();
    expect(found!.signals.map((s) => s.id)).toContain("mismatch.proprietor");
  });

  it("the multi-PIN landuse-divergence signal fires for ESH-7011-08", async () => {
    const { getEvaluationContext } = await import("../lib/clients");
    const { findMismatches } = await import("@ratesassist/recovery-engine");
    const ctx = getEvaluationContext();
    const candidates = findMismatches(ctx);
    const found = candidates.find((c) => c.assessmentNumber === "ESH-7011-08");
    expect(found).toBeDefined();
    expect(found!.signals.map((s) => s.id)).toContain(
      "mismatch.pin_landuse_diverges",
    );
  });

  it("the existing 6 cadastre-lag / address-mismatch candidates still fire", async () => {
    const { getEvaluationContext } = await import("../lib/clients");
    const { findMismatches } = await import("@ratesassist/recovery-engine");
    const ctx = getEvaluationContext();
    const candidates = findMismatches(ctx);
    const ids = new Set<string>();
    for (const c of candidates) for (const s of c.signals) ids.add(s.id);
    expect(ids.has("reg.dmirs_ahead_of_landgate")).toBe(true);
    expect(ids.has("reg.address_mismatch_landgate")).toBe(true);
    // Specifically the 6 cadastre-lag fixtures must still fire — sanity
    // check on regression.
    const lagAssessments = [
      "TPS-1102-91",
      "KAL-4401-12",
      "ASH-9911-22",
      "KAL-4401-77",
      "MEK-3303-58",
      "ESH-1102-92",
    ];
    for (const a of lagAssessments) {
      const c = candidates.find((cc) => cc.assessmentNumber === a);
      expect(c, `lag candidate ${a} should still be present`).toBeDefined();
      expect(
        c!.signals.map((s) => s.id),
        `lag candidate ${a} still fires the lag signal`,
      ).toContain("reg.dmirs_ahead_of_landgate");
    }
  });
});
