/**
 * Tests for `./tengraph.ts`.
 *
 * TenGraph has no documented deep-link pattern, so the helper builds the
 * viewer home with the tenement id stashed in the hash fragment for paste
 * convenience. These tests pin that behaviour and the availability flag.
 */

import { describe, it, expect } from "vitest";
import {
  TENGRAPH_BASE,
  buildTengraphUrl,
  tengraphAvailable,
} from "../src/tengraph.js";

describe("tengraph constants & availability", () => {
  it("uses the DMIRS host", () => {
    expect(TENGRAPH_BASE).toBe("https://tengraph.dmirs.wa.gov.au");
  });

  it("is reported available (browser-only viewer)", () => {
    expect(tengraphAvailable()).toBe(true);
  });
});

describe("buildTengraphUrl", () => {
  it("falls back to the viewer root for an empty id", () => {
    expect(buildTengraphUrl("")).toBe(`${TENGRAPH_BASE}/`);
    expect(buildTengraphUrl("   ")).toBe(`${TENGRAPH_BASE}/`);
  });

  it("appends the raw tenement id into the hash fragment, percent-encoded", () => {
    const url = buildTengraphUrl("M  4701612");
    expect(url.startsWith(`${TENGRAPH_BASE}/#tenement=`)).toBe(true);
    expect(url).toContain("M%20%204701612");
  });

  it("preserves trailing identifier shape for a different type code", () => {
    const url = buildTengraphUrl("G  2600123");
    expect(url).toContain("G%20%202600123");
  });
});
