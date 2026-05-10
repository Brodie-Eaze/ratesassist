/**
 * SEC-003: Verify next.config.js exports the security-headers contract.
 *
 * Next's `headers()` config is consumed by the framework at build/edge time;
 * we don't have a portable way to spin Next up inside vitest. Instead we
 * import the config directly and assert the shape the framework will
 * apply — same data, same matcher.
 */

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextConfig = require("../next.config.js") as {
  headers?: () => Promise<
    Array<{ source: string; headers: Array<{ key: string; value: string }> }>
  >;
};

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
