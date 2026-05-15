/**
 * Tests for the WA 2025-26 rate tables.
 *
 * Every council ships a schema-valid table with a non-empty source URL,
 * positive rates, positive minimums, and every canonical category used
 * downstream.
 *
 * Verified-source invariants (added 2026-05-14 refresh)
 * -----------------------------------------------------
 * Each pilot council must ship `verified: true` after the rate-table
 * refresh against published 2025-26 budgets. The provenance audit trail
 * lives in `internal/RATE-TABLES-PROVENANCE.md`. Councils that cannot be
 * verified should keep `verified: false` AND carry a `note` explaining
 * why — the test below allows that path but flags it loudly so a
 * regression to the old "all unverified" state breaks CI.
 */

import { describe, it, expect } from "vitest";
import {
  WA_RATE_TABLES,
  findRateLine,
  getRateTable,
  type LandUseCategory,
} from "../src/index.js";

const REQUIRED_COUNCILS = ["TPS", "ESH", "SST", "KAL", "MEK", "ASH"] as const;

const REQUIRED_CATEGORIES: readonly LandUseCategory[] = [
  "Residential",
  "Commercial",
  "Industrial",
  "Rural",
  "Vacant",
  "Mining",
  "Pastoral",
  "MiningOther",
];

/**
 * Allowlist for any council that legitimately remains unverified after a
 * refresh attempt. Empty by design — a council ending up here must also
 * ship a `note` documenting why the published source was unreachable.
 */
const UNVERIFIED_ALLOWED: ReadonlySet<string> = new Set<string>([]);

describe("WA_RATE_TABLES — per-council shape", () => {
  for (const code of REQUIRED_COUNCILS) {
    it(`${code} ships a table with required fields`, () => {
      const t = WA_RATE_TABLES[code];
      expect(t).toBeDefined();
      if (!t) return;
      expect(t.councilCode).toBe(code);
      expect(t.financialYear).toBe("2025-26");
      expect(t.effectiveFrom).toBe("2025-07-01");
      expect(t.effectiveTo).toBe("2026-06-30");
      expect(t.sourceUrl).toMatch(/^https?:\/\//);
      expect(t.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof t.verified).toBe("boolean");
      expect(t.lines.length).toBeGreaterThanOrEqual(6);
    });

    it(`${code} covers every required land-use category`, () => {
      const t = WA_RATE_TABLES[code];
      if (!t) throw new Error("missing");
      // All 8 schema categories must resolve (analogues are documented
      // in the council's `note`).
      expect(t.lines.length).toBe(REQUIRED_CATEGORIES.length);
      for (const cat of REQUIRED_CATEGORIES) {
        const line = findRateLine(t, cat);
        expect(line, `${code} missing ${cat}`).toBeDefined();
        if (!line) continue;
        expect(line.rateInDollar).toBeGreaterThan(0);
        expect(line.rateInDollar).toBeLessThan(1);
        expect(line.minimumPayment).toBeGreaterThan(0);
        expect(line.basis === "GRV" || line.basis === "UV").toBe(true);
      }
    });

    it(`${code} uses UV basis for Rural and Mining`, () => {
      const t = WA_RATE_TABLES[code];
      if (!t) throw new Error("missing");
      expect(findRateLine(t, "Rural")?.basis).toBe("UV");
      expect(findRateLine(t, "Mining")?.basis).toBe("UV");
    });

    it(`${code} mining rate > rural rate (differential exists)`, () => {
      // Every pilot's 2025-26 schedule strikes mining strictly above
      // rural / pastoral — this is the structural fact the recovery
      // engine's uplift signal exploits.
      const t = WA_RATE_TABLES[code];
      if (!t) throw new Error("missing");
      const mining = findRateLine(t, "Mining")!;
      const rural = findRateLine(t, "Rural")!;
      expect(mining.rateInDollar).toBeGreaterThan(rural.rateInDollar);
    });

    it(`${code} sourceUrl is https://*.wa.gov.au (published WA council)`, () => {
      const t = WA_RATE_TABLES[code];
      if (!t) throw new Error("missing");
      expect(t.sourceUrl).toMatch(/^https:\/\/[a-z0-9.-]+\.wa\.gov\.au(\/|$)/i);
    });

    it(`${code} ships verified: true OR carries an explicit unverified note`, () => {
      const t = WA_RATE_TABLES[code];
      if (!t) throw new Error("missing");
      if (t.verified) {
        expect(t.verified).toBe(true);
        return;
      }
      // Unverified path: must be allowlisted AND must carry a note.
      expect(
        UNVERIFIED_ALLOWED.has(code),
        `${code} is unverified but not on UNVERIFIED_ALLOWED. Either verify against a published source or add to the allowlist with a justified note.`,
      ).toBe(true);
      expect(t.note, `${code} unverified without note`).toBeDefined();
      expect((t.note ?? "").length).toBeGreaterThan(20);
    });

    it(`${code} retrievedAt is from the 2026-05 refresh window or later`, () => {
      const t = WA_RATE_TABLES[code];
      if (!t) throw new Error("missing");
      // Lexicographic ISO date comparison: anything from 2026-05-01
      // onward is acceptable; older values would mean the table
      // pre-dates the refresh.
      expect(t.retrievedAt >= "2026-05-01").toBe(true);
    });
  }
});

describe("getRateTable", () => {
  it("returns the table for a known council", () => {
    expect(getRateTable("KAL")?.councilCode).toBe("KAL");
  });
  it("returns undefined for unknown councils", () => {
    expect(getRateTable("XYZ")).toBeUndefined();
  });
});

describe("findRateLine", () => {
  it("returns undefined for an unknown category", () => {
    const t = WA_RATE_TABLES["KAL"]!;
    // @ts-expect-error testing runtime guard
    expect(findRateLine(t, "Bogus")).toBeUndefined();
  });
});

describe("TPS alias provenance", () => {
  it("TPS points at the Ashburton schedule (Tom Price is in ASH)", () => {
    const tps = WA_RATE_TABLES["TPS"]!;
    const ash = WA_RATE_TABLES["ASH"]!;
    // Every rate line should match the ASH schedule.
    for (const cat of REQUIRED_CATEGORIES) {
      const tpsLine = findRateLine(tps, cat)!;
      const ashLine = findRateLine(ash, cat)!;
      expect(tpsLine.rateInDollar).toBe(ashLine.rateInDollar);
      expect(tpsLine.minimumPayment).toBe(ashLine.minimumPayment);
      expect(tpsLine.basis).toBe(ashLine.basis);
    }
    // And the note must say so explicitly.
    expect(tps.note).toMatch(/deprecated|Ashburton/i);
  });
});
