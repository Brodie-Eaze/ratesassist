/**
 * SEC-007: lib/llm.ts must throw at module load when NODE_ENV=production
 * and ANTHROPIC_BASE_URL is not an AU endpoint.
 *
 * The check runs once at module load, so we use vi.resetModules() and a
 * fresh import per case.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("llm.ts AU region pinning (SEC-007)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("default (no env) loads cleanly in production (defaults to anthropic.com.au)", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.ANTHROPIC_BASE_URL;
    await expect(import("../lib/llm")).resolves.toBeTruthy();
  });

  it("rejects non-AU base URL in production", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    await expect(import("../lib/llm")).rejects.toThrow(/refused/i);
  });

  it("accepts a Bedrock amazonaws.com endpoint in production", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.ANTHROPIC_BASE_URL =
      "https://bedrock-runtime.ap-southeast-2.amazonaws.com";
    await expect(import("../lib/llm")).resolves.toBeTruthy();
  });

  it("dev mode allows non-AU base URL (with warning)", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    await expect(import("../lib/llm")).resolves.toBeTruthy();
  });
});
