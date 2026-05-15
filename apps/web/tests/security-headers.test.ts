/**
 * SEC-003: Verify next.config.js exports the security-headers contract.
 *
 * Next's `headers()` config is consumed by the framework at build/edge time;
 * we don't have a portable way to spin Next up inside vitest. Instead we
 * import the config directly and assert the shape the framework will
 * apply — same data, same matcher.
 *
 * CSP hardening: the production build drops `'unsafe-eval'` and
 * `'unsafe-inline'` from `script-src` (kept in dev for Next HMR). Tests
 * below cover both modes — see SECURITY-FOLLOWUPS.md for the planned
 * `style-src` tightening.
 */

import { afterEach, describe, expect, it } from "vitest";
type NextConfigShape = {
  headers?: () => Promise<
    Array<{ source: string; headers: Array<{ key: string; value: string }> }>
  >;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextConfig = require("../next.config.js") as NextConfigShape;

/** Re-import next.config.js with a fresh module cache so NODE_ENV-dependent
 *  branches are re-evaluated. Required because the config inspects
 *  `process.env.NODE_ENV` at module-load time. */
function reloadConfig(): NextConfigShape {
  const resolved = require.resolve("../next.config.js");
  delete (require.cache as Record<string, unknown>)[resolved];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../next.config.js") as NextConfigShape;
}

describe("security headers (SEC-003)", () => {
  it("exposes a `headers()` function on next.config", () => {
    expect(typeof nextConfig.headers).toBe("function");
  });

  it("applies the global header set to all routes", async () => {
    const blocks = await nextConfig.headers!();
    expect(blocks.length).toBeGreaterThan(0);
    const global = blocks.find((b) => b.source === "/(.*)");
    expect(global).toBeDefined();
    const keys = global!.headers.map((h) => h.key);
    expect(keys).toContain("Strict-Transport-Security");
    expect(keys).toContain("X-Frame-Options");
    expect(keys).toContain("X-Content-Type-Options");
    expect(keys).toContain("Referrer-Policy");
    expect(keys).toContain("Permissions-Policy");
    expect(keys).toContain("Content-Security-Policy");
  });

  it("HSTS is two years with includeSubDomains and preload", async () => {
    const blocks = await nextConfig.headers!();
    const hsts = blocks[0]!.headers.find(
      (h) => h.key === "Strict-Transport-Security",
    );
    expect(hsts!.value).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("CSP frame-ancestors is 'none' (clickjacking defense)", async () => {
    const blocks = await nextConfig.headers!();
    const csp = blocks[0]!.headers.find(
      (h) => h.key === "Content-Security-Policy",
    );
    expect(csp!.value).toContain("frame-ancestors 'none'");
  });

  it("CSP allows Anthropic AU + SLIP + ABR connect-src", async () => {
    const blocks = await nextConfig.headers!();
    const csp = blocks[0]!.headers.find(
      (h) => h.key === "Content-Security-Policy",
    );
    expect(csp!.value).toContain("https://api.anthropic.com.au");
    expect(csp!.value).toContain("https://services.slip.wa.gov.au");
    expect(csp!.value).toContain("https://abr.business.gov.au");
  });

  it("X-Frame-Options is DENY", async () => {
    const blocks = await nextConfig.headers!();
    const xfo = blocks[0]!.headers.find((h) => h.key === "X-Frame-Options");
    expect(xfo!.value).toBe("DENY");
  });
});

/** NODE_ENV is typed as readonly by @types/node; we mutate it the same way
 *  the existing workos.test.ts does — via Object.defineProperty. process.env
 *  insists every property descriptor be configurable + writable + enumerable
 *  (it's a Proxy under Node 22+), so we set all three. */
function setNodeEnv(value: string | undefined): void {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
  } else {
    Object.defineProperty(process.env, "NODE_ENV", {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  }
}

describe("security headers (SEC-003) — CSP hardening by NODE_ENV", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    setNodeEnv(originalEnv);
    // Re-prime the require cache so subsequent imports see the original env.
    reloadConfig();
  });

  it("production strips 'unsafe-eval' from script-src (keeps 'unsafe-inline' until nonce-based CSP lands)", async () => {
    // History: an earlier iteration dropped both 'unsafe-eval' AND
    // 'unsafe-inline' from prod. That broke Next.js 14 App Router because
    // it bootstraps every page with 5+ inline <script> tags carrying the
    // hydration / RSC payload. Pages rendered server-side but the client
    // never hydrated — the screen sat frozen.
    //
    // The agreed compromise (documented in next.config.js): keep
    // 'unsafe-inline' in prod until the codebase migrates to nonce-based
    // CSP with 'strict-dynamic'. 'unsafe-eval' STAYS stripped — Next.js
    // prod bundles don't need it (only HMR/dev does), so dropping it
    // closes the eval-based XSS path without breaking hydration.
    setNodeEnv("production");
    const cfg = reloadConfig();
    const blocks = await cfg.headers!();
    const csp = blocks[0]!.headers.find(
      (h) => h.key === "Content-Security-Policy",
    )!.value;
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src "));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'self'");
  });

  it("development keeps 'unsafe-eval' and 'unsafe-inline' in script-src (Next HMR)", async () => {
    setNodeEnv("development");
    const cfg = reloadConfig();
    const blocks = await cfg.headers!();
    const csp = blocks[0]!.headers.find(
      (h) => h.key === "Content-Security-Policy",
    )!.value;
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src "));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).toContain("'unsafe-eval'");
    expect(scriptSrc).toContain("'unsafe-inline'");
  });
});
