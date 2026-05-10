/**
 * SEC-011: DMIRS_WFS_BASE allowlist. Module load must throw when the env
 * value points outside the WA SLIP host.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { isAllowedDmirsBase } from "../src/dmirs.js";

const ORIGINAL_ENV = { ...process.env };

describe("DMIRS_WFS_BASE allowlist (SEC-011)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("isAllowedDmirsBase accepts the SLIP host", () => {
    expect(
      isAllowedDmirsBase(
        "https://services.slip.wa.gov.au/public/services/x/MapServer/WFSServer",
      ),
    ).toBe(true);
  });

  it("isAllowedDmirsBase rejects non-SLIP hosts", () => {
    expect(isAllowedDmirsBase("https://evil.example.com/wfs")).toBe(false);
    expect(isAllowedDmirsBase("https://services-slip.wa.gov.au/")).toBe(false);
    expect(isAllowedDmirsBase("http://services.slip.wa.gov.au/")).toBe(false);
  });

  it("module load throws when DMIRS_WFS_BASE is not on the allowlist", async () => {
    process.env.DMIRS_WFS_BASE = "https://attacker.test/wfs";
    await expect(import("../src/dmirs.js?case=bad")).rejects.toThrow(
      /DMIRS_WFS_BASE refused/,
    );
  });

  it("module load succeeds when DMIRS_WFS_BASE is on the allowlist", async () => {
    process.env.DMIRS_WFS_BASE =
      "https://services.slip.wa.gov.au/some/path/WFSServer";
    await expect(import("../src/dmirs.js?case=good")).resolves.toBeTruthy();
  });

  it("module load succeeds with no env override", async () => {
    delete process.env.DMIRS_WFS_BASE;
    await expect(import("../src/dmirs.js?case=none")).resolves.toBeTruthy();
  });
});
