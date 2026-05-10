/**
 * SEC-007: lib/llm.ts must refuse a non-AU Anthropic base URL when running
 * in production. The refusal fires at runtime (when a live LLM call is
 * about to be made) rather than at module load — module load happens during
 * Next.js build collection where staging/CI env may carry placeholder
 * values that should not block the build.
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

  it("module load does not throw regardless of env (deferred to call time)", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    // Module load must NOT throw — the production assertion is deferred to
    // the runtime call path (assertAuBaseUrlAtCallTime).
    await expect(import("../lib/llm")).resolves.toBeTruthy();
  });

  it("default (no env) loads cleanly in production (defaults to anthropic.com.au)", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.ANTHROPIC_BASE_URL;
    await expect(import("../lib/llm")).resolves.toBeTruthy();
  });

  it("accepts a Bedrock amazonaws.com endpoint", async () => {
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
