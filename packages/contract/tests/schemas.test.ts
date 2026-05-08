/**
 * Characterization tests for @ratesassist/contract.
 *
 * Pin the wire shapes that adapters must produce and consumers must accept.
 * Any drift in these tests is a contract change — handle as semver.
 */

import { describe, it, expect } from "vitest";
import {
  inputs,
  toolResult,
  adapterIdentity,
} from "../src/schemas.js";

describe("inputs schemas — round-trip", () => {
  it("search_property: valid query parses, empty rejected", () => {
    expect(inputs.search_property.parse({ query: "Pilbara" })).toEqual({
      query: "Pilbara",
    });
    const bad = inputs.search_property.safeParse({ query: "" });
    expect(bad.success).toBe(false);
  });

  it("get_property_detail: alphanumeric+dash assessment numbers, rejects symbols", () => {
    expect(
      inputs.get_property_detail.parse({ assessmentNumber: "A123-456" }),
    ).toEqual({ assessmentNumber: "A123-456" });
    expect(
      inputs.get_property_detail.safeParse({ assessmentNumber: "BAD!" })
        .success,
    ).toBe(false);
  });

  it("list_overdue: optional council + minDaysOverdue with bounds", () => {
    expect(inputs.list_overdue.parse({})).toEqual({});
    expect(
      inputs.list_overdue.parse({ council: "TPS", minDaysOverdue: 30 }),
    ).toEqual({ council: "TPS", minDaysOverdue: 30 });
    // out-of-bounds
    expect(
      inputs.list_overdue.safeParse({ minDaysOverdue: -1 }).success,
    ).toBe(false);
    expect(
      inputs.list_overdue.safeParse({ minDaysOverdue: 9999 }).success,
    ).toBe(false);
  });

  it("list_councils: strict empty object rejects extra keys", () => {
    expect(inputs.list_councils.parse({})).toEqual({});
    expect(
      inputs.list_councils.safeParse({ extra: 1 }).success,
    ).toBe(false);
  });

  it("draft_payment_reminder: tone defaults to friendly", () => {
    const parsed = inputs.draft_payment_reminder.parse({
      assessmentNumber: "A123",
    });
    expect(parsed.tone).toBe("friendly");
  });

  it("update_owner_contact: requires phone or email; confirm defaults false", () => {
    const empty = inputs.update_owner_contact.safeParse({ ownerId: "O1" });
    expect(empty.success).toBe(false);

    const ok = inputs.update_owner_contact.parse({
      ownerId: "O1",
      newPhone: "0400000000",
    });
    expect(ok.confirm).toBe(false);
  });

  it("update_owner_contact: rejects malformed email", () => {
    const bad = inputs.update_owner_contact.safeParse({
      ownerId: "O1",
      newEmail: "not-an-email",
    });
    expect(bad.success).toBe(false);
  });

  it("verify_abn: 11-digit ABN with optional spaces accepted; short rejected", () => {
    expect(inputs.verify_abn.parse({ abn: "32614882110" }).abn).toBe(
      "32614882110",
    );
    expect(
      inputs.verify_abn.parse({ abn: "32 614 882 110" }).abn,
    ).toBe("32 614 882 110");
    expect(inputs.verify_abn.safeParse({ abn: "12345" }).success).toBe(false);
  });

  it("find_mining_mismatches: minSeverity must be high|medium|low", () => {
    expect(
      inputs.find_mining_mismatches.parse({ minSeverity: "high" }).minSeverity,
    ).toBe("high");
    expect(
      inputs.find_mining_mismatches.safeParse({ minSeverity: "critical" })
        .success,
    ).toBe(false);
  });

  it("generate_statutory_certificate: requires email; certificateType length-bounded", () => {
    expect(
      inputs.generate_statutory_certificate.parse({
        assessmentNumber: "A123",
        certificateType: "WA-6.76",
        requesterName: "Jo",
        requesterEmail: "jo@example.com",
      }).certificateType,
    ).toBe("WA-6.76");
    expect(
      inputs.generate_statutory_certificate.safeParse({
        assessmentNumber: "A123",
        certificateType: "X",
        requesterName: "Jo",
        requesterEmail: "jo@example.com",
      }).success,
    ).toBe(false);
  });
});

describe("toolResult discriminated union", () => {
  it("ok=true variant: applies mutated default false", () => {
    const r = toolResult.parse({ ok: true, output: "hello" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toBe("hello");
      expect(r.mutated).toBe(false);
    }
  });

  it("ok=true with commitToken + data passes through", () => {
    const r = toolResult.parse({
      ok: true,
      output: "preview",
      data: { foo: 1 },
      commitToken: "tok-1",
      mutated: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.commitToken).toBe("tok-1");
  });

  const errorCodes = [
    "not_found",
    "invalid_input",
    "unauthorized",
    "forbidden",
    "conflict",
    "commit_token_invalid",
    "commit_token_expired",
    "rate_limited",
    "upstream_error",
    "timeout",
    "internal_error",
  ] as const;

  for (const code of errorCodes) {
    it(`ok=false code=${code} round-trips`, () => {
      const r = toolResult.parse({ ok: false, error: "x", code });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe(code);
        expect(r.retryable).toBe(false); // default
      }
    });
  }

  it("rejects unknown error code", () => {
    const bad = toolResult.safeParse({
      ok: false,
      error: "x",
      code: "wat",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects ok=true with no output", () => {
    expect(toolResult.safeParse({ ok: true }).success).toBe(false);
  });
});

describe("adapterIdentity schema", () => {
  it("parses a valid identity", () => {
    const id = adapterIdentity.parse({
      id: "demo",
      name: "Demo Adapter",
      vendor: "RatesAssist",
      version: "0.2.0",
      contractVersion: "0.2.0",
      capabilities: ["read.property", "write.add_property_note"],
    });
    expect(id.id).toBe("demo");
  });

  it("rejects non-semver versions", () => {
    expect(
      adapterIdentity.safeParse({
        id: "demo",
        name: "Demo",
        vendor: "RA",
        version: "alpha",
        contractVersion: "0.2.0",
        capabilities: [],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown capability strings", () => {
    expect(
      adapterIdentity.safeParse({
        id: "demo",
        name: "Demo",
        vendor: "RA",
        version: "0.2.0",
        contractVersion: "0.2.0",
        capabilities: ["read.everything"],
      }).success,
    ).toBe(false);
  });
});
