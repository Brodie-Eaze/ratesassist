/**
 * Legal-risk guards. The miscellaneous-licence guard flags recoveries that rest
 * on contested law (WASC 274 + the 2025 Bill) so they're confirmed before being
 * pursued — never silently suppressed (they are rateable under current law).
 */

import { describe, expect, it } from "vitest";

import { miscLicenceLegalRisk, legalRiskNotes } from "../src/legalRisk.js";
import type { Tenement, TenementType } from "@ratesassist/contract";

function tenement(tenementId: string, type: TenementType): Tenement {
  return {
    tenementId,
    type,
    status: "Live",
    holder: "Acme Resources Pty Ltd",
    holderAbn: null,
    commodity: ["Iron Ore"],
    grantedDate: "2020-01-01",
    expiryDate: "2041-01-01",
    areaHectares: 100,
    intersectsAssessmentNumbers: [],
    isProducing: true,
    lastWorkProgramYear: null,
    polygon: [],
  };
}

describe("miscLicenceLegalRisk", () => {
  it("flags a miscellaneous licence (type L) with the contested-law advisory", () => {
    const note = miscLicenceLegalRisk([tenement("L 123456", "L")]);
    expect(note).not.toBeNull();
    expect(note!.category).toBe("miscellaneous_licence");
    expect(note!.affectedTenementIds).toEqual(["L 123456"]);
    expect(note!.note).toMatch(/Mount Magnet|WASC 274/);
    expect(note!.note).toMatch(/refund liability/i);
  });

  it("returns null when no miscellaneous licence is present", () => {
    expect(miscLicenceLegalRisk([tenement("M 1", "M"), tenement("E 2", "E")])).toBeNull();
  });

  it("collects every affected miscellaneous-licence id", () => {
    const note = miscLicenceLegalRisk([
      tenement("M 1", "M"),
      tenement("L 9", "L"),
      tenement("L 10", "L"),
    ]);
    expect(note!.affectedTenementIds).toEqual(["L 9", "L 10"]);
  });

  it("legalRiskNotes returns the applicable notes as an array", () => {
    expect(legalRiskNotes([tenement("M 1", "M")])).toHaveLength(0);
    expect(legalRiskNotes([tenement("L 9", "L")])).toHaveLength(1);
  });
});
