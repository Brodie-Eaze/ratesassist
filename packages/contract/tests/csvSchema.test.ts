/**
 * Tests for the rating-roll CSV schema and parser.
 */

import { describe, expect, it } from "vitest";

import { parseRatingRollCsv, RatingRollRowSchema } from "../src/csvSchema.js";

const HEADER =
  "assessment_number,address,suburb,postcode,state,landuse,valuation,annual_rates,owner_name";

const GOOD_ROW =
  "TPS-9001-01,12 Hamersley Drive,Tom Price,6751,WA,Residential,420000,2100,Carter Holdings";

describe("RatingRollRowSchema", () => {
  it("accepts a minimal valid row", () => {
    const r = RatingRollRowSchema.safeParse({
      assessmentNumber: "TPS-9001-01",
      address: "12 Hamersley Drive",
      suburb: "Tom Price",
      postcode: "6751",
      state: "WA",
      landUse: "Residential",
      valuation: 420000,
      annualRates: 2100,
      ownerName: "Carter Holdings",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a 3-digit postcode", () => {
    const r = RatingRollRowSchema.safeParse({
      assessmentNumber: "TPS-9001-01",
      address: "x",
      suburb: "Tom Price",
      postcode: "675",
      state: "WA",
      landUse: "Residential",
      valuation: 1,
      annualRates: 1,
      ownerName: "Carter",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an ABN that is not 11 digits", () => {
    const r = RatingRollRowSchema.safeParse({
      assessmentNumber: "TPS-9001-01",
      address: "x",
      suburb: "Tom Price",
      postcode: "6751",
      state: "WA",
      landUse: "Residential",
      valuation: 1,
      annualRates: 1,
      ownerName: "Carter",
      ownerAbn: "1234567",
    });
    expect(r.success).toBe(false);
  });
});

describe("parseRatingRollCsv", () => {
  it("parses a happy-path CSV", () => {
    const r = parseRatingRollCsv(`${HEADER}\n${GOOD_ROW}\n`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.length).toBe(1);
    expect(r.errors.length).toBe(0);
    expect(r.rows[0]!.assessmentNumber).toBe("TPS-9001-01");
  });

  it("rejects a CSV that is missing a required header", () => {
    const badHeader = HEADER.replace("postcode,", "");
    const r = parseRatingRollCsv(`${badHeader}\nTPS-9001-01,addr,suburb,WA,Residential,1,1,Carter`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/postcode/);
  });

  it("collects per-row errors instead of aborting the whole import", () => {
    const csv = [
      HEADER,
      GOOD_ROW,
      // Bad postcode
      "TPS-9001-02,addr,Tom Price,675,WA,Residential,420000,2100,Carter",
      // Bad landuse
      "TPS-9001-03,addr,Tom Price,6751,WA,Vapor,420000,2100,Carter",
    ].join("\n");
    const r = parseRatingRollCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.length).toBe(1);
    expect(r.errors.length).toBe(2);
  });

  it("tolerates extra columns and quoted fields with commas", () => {
    const csv = [
      `${HEADER},extra_col`,
      `TPS-9001-01,"12 Hamersley Drive, Unit 2",Tom Price,6751,WA,Residential,420000,2100,Carter,ignored`,
    ].join("\n");
    const r = parseRatingRollCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0]!.address).toBe("12 Hamersley Drive, Unit 2");
  });

  it("strips a BOM and CRLF line endings", () => {
    const csv = `﻿${HEADER}\r\n${GOOD_ROW}\r\n`;
    const r = parseRatingRollCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.length).toBe(1);
  });

  it("rejects empty input", () => {
    const r = parseRatingRollCsv("");
    expect(r.ok).toBe(false);
  });

  it("rejects a header-only CSV", () => {
    const r = parseRatingRollCsv(HEADER);
    expect(r.ok).toBe(false);
  });
});
