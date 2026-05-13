/**
 * Tests for the WA 2025-26 rate tables.
 *
 * Every council ships a schema-valid table with a non-empty source URL,
 * positive rates, positive minimums, and at least the seven canonical
 * categories used downstream.
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
      const t = WA_RATE_TABLES[code];
      if (!t) throw new Error("missing");
      const mining = findRateLine(t, "Mining")!;
      const rural = findRateLine(t, "Rural")!;
      expect(mining.rateInDollar).toBeGreaterThan(rural.rateInDollar);
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
