/**
 * SEC-016: scrubPii redacts AU ABNs, AU phone numbers, and emails.
 */

import { describe, expect, it, beforeEach } from "vitest";

import { scrubPii } from "../lib/llm";

describe("scrubPii (SEC-016)", () => {
  beforeEach(() => {
    delete process.env.RA_DISABLE_PII_SCRUB;
  });

  it("redacts a formatted AU ABN", () => {
    const out = scrubPii("ABN is 32 614 882 110 please verify");
    expect(out).toContain("[ABN-REDACTED]");
    expect(out).not.toContain("32 614 882 110");
  });

  it("redacts an unformatted 11-digit ABN", () => {
    const out = scrubPii("abn=32614882110 done");
    expect(out).toContain("[ABN-REDACTED]");
    expect(out).not.toContain("32614882110");
  });

  it("redacts an email address", () => {
    const out = scrubPii("contact john.doe+rates@council.wa.gov.au tomorrow");
    expect(out).toContain("[EMAIL-REDACTED]");
    expect(out).not.toContain("john.doe");
  });

  it("redacts an AU mobile (04XX XXX XXX)", () => {
    const out = scrubPii("call me on 0412 345 678");
    expect(out).toContain("[PHONE-REDACTED]");
    expect(out).not.toContain("0412 345 678");
  });

  it("redacts a +61 phone number", () => {
    const out = scrubPii("ring +61 412 345 678 today");
    expect(out).toContain("[PHONE-REDACTED]");
  });

  it("preserves surrounding structure", () => {
    const out = scrubPii(
      "Hi, my email is x@y.com and ABN 32 614 882 110.",
    );
    expect(out.startsWith("Hi, my email is ")).toBe(true);
    expect(out.endsWith(".")).toBe(true);
  });

  it("RA_DISABLE_PII_SCRUB=1 bypasses scrubbing", () => {
    process.env.RA_DISABLE_PII_SCRUB = "1";
    try {
      const out = scrubPii("ABN 32 614 882 110");
      expect(out).toBe("ABN 32 614 882 110");
    } finally {
      delete process.env.RA_DISABLE_PII_SCRUB;
    }
  });

  it("leaves benign text unchanged", () => {
    const text = "Run the recovery audit for council TPS.";
    expect(scrubPii(text)).toBe(text);
  });
});
