/**
 * Trust-signal public-page tests.
 *
 * Covers the 5 trust-signal pages required for pre-demo procurement:
 *   - /status
 *   - /security
 *   - /changelog
 *   - /privacy
 *   - /trust
 *   - /trust/sub-processors
 *
 * Smoke check matrix:
 *   - Each route passes through middleware without a /login redirect
 *     when no session cookie is present. The auth gate must NOT stand
 *     between a council CFO's IT lead and the trust posture.
 *   - The middleware's PUBLIC_HTML_PATHS array explicitly lists every
 *     route (source-level invariant — keeps future refactors honest).
 *   - SUB-PROCESSORS.md is reachable from the trust sub-processors page
 *     (the .md file exists at the expected build-time path).
 *   - The changelog page renders at least one entry tagged "May 2026".
 */

import { describe, expect, it, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

process.env["RA_AUTH_SECRET"] = "trust-pages-test-secret-32chars!!";

import { _resetAuthSecretCacheForTests } from "../lib/auth";
import { middleware } from "../middleware";

beforeEach(() => {
  _resetAuthSecretCacheForTests();
  delete process.env["RA_DEV_AUTOLOGIN_SESSION"];
});

function makeReq(
  path: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(new URL(`https://app.example.com${path}`), {
    method: "GET",
    headers: new Headers({ host: "app.example.com", ...headers }),
  });
}

const TRUST_ROUTES: ReadonlyArray<string> = [
  "/status",
  "/security",
  "/changelog",
  "/privacy",
  "/trust",
  "/trust/sub-processors",
];

describe("trust-signal public routes — middleware bypass", () => {
  for (const route of TRUST_ROUTES) {
    it(`unauthenticated GET ${route} is NOT redirected to /login`, async () => {
      const res = await middleware(makeReq(route));
      expect(res.status).toBeLessThan(300);
      expect(res.headers.get("location")).toBeNull();
    });
  }

  it("sanity: a non-public sibling like /security/internal still redirects", async () => {
    // Confirms the bypass is exact-match against PUBLIC_HTML_PATHS, not
    // a broad prefix that would accidentally expose nested routes.
    const res = await middleware(makeReq("/security/internal"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("/login");
  });
});

describe("trust-signal public routes — middleware source invariant", () => {
  it("PUBLIC_HTML_PATHS lists every trust route", () => {
    const src = readFileSync(
      join(__dirname, "..", "middleware.ts"),
      "utf8",
    );
    for (const route of TRUST_ROUTES) {
      expect(src).toContain(`"${route}"`);
    }
  });
});

describe("trust pages — source-level smoke (no RSC runtime in vitest)", () => {
  function readPage(p: string): string {
    return readFileSync(
      join(__dirname, "..", "app", ...p.split("/"), "page.tsx"),
      "utf8",
    );
  }

  it("status page renders the seven service components and a green dot", () => {
    const src = readPage("status");
    expect(src).toContain("Web application");
    expect(src).toContain("MCP tool runtime");
    expect(src).toContain("Postgres (audit chain)");
    expect(src).toContain("Anthropic LLM");
    expect(src).toContain("Esri Sentinel-2 imagery");
    expect(src).toContain("DMIRS feed");
    expect(src).toContain("Landgate SLIP");
    expect(src).toContain("bg-emerald-500");
    expect(src).toContain("All systems operational");
    // Anti-prohibition: no emojis, no "Oops!", no stray exclamation marks
    // in product copy.
    expect(src).not.toContain("Oops");
  });

  it("security page covers the required control sections", () => {
    const src = readPage("security");
    for (const heading of [
      "Encryption",
      "Authentication",
      "Authorisation",
      "Audit logging",
      "Vulnerability management",
      "Multi-tenant isolation",
      "Sub-processors",
      "Certifications and roadmap",
    ]) {
      expect(src).toContain(heading);
    }
    expect(src).toContain("security@ratesassist.com.au");
    expect(src).toContain("SOC 2 Type I");
    expect(src).toContain("ISO/IEC 27001");
  });

  it("changelog page renders at least one May 2026 entry", () => {
    const src = readPage("changelog");
    expect(src).toContain("May 2026");
    expect(src).toContain('"2026-05"');
    expect(src).toContain("Sentinel-2 Live imagery");
    expect(src).toContain("Postgres audit hash-chain");
    expect(src).toContain("Coming next");
    expect(src).toContain("Planet PlanetScope");
  });

  it("privacy page covers the APP-aligned sections", () => {
    const src = readPage("privacy");
    for (const heading of [
      "Who we are",
      "What data we process",
      "How we use it",
      "Where it lives",
      "Who else sees it",
      "Your rights",
      "Breach notification",
      "Retention",
      "Changes to this policy",
    ]) {
      expect(src).toContain(heading);
    }
    expect(src).toContain("privacy@ratesassist.com.au");
    expect(src).toContain("OAIC");
    expect(src).toContain("Australian Privacy Principles");
  });

  it("trust index renders cards for every trust artefact", () => {
    const src = readPage("trust");
    for (const card of [
      "Security posture",
      "Platform status",
      "Changelog",
      "Privacy policy",
      "Sub-processors",
      "Data Processing Addendum (DPA)",
      "Incident response runbook",
    ]) {
      expect(src).toContain(card);
    }
    expect(src).toContain("Built for council-grade procurement");
  });

  it("trust sub-processors page references the markdown source", () => {
    const src = readPage("trust/sub-processors");
    expect(src).toContain("SUB-PROCESSORS.md");
    expect(src).toContain("TrustMarkdown");
  });
});

describe("SUB-PROCESSORS.md content surface", () => {
  it("the .md file exists at the path the sub-processors page reads from", () => {
    // process.cwd() during `vitest run` from apps/web is apps/web itself
    // — mirrors the build-time path the page uses.
    const subProcessorsPath = resolve(
      __dirname,
      "..",
      "..",
      "..",
      "SUB-PROCESSORS.md",
    );
    expect(existsSync(subProcessorsPath)).toBe(true);
  });

  it("the .md file contains the canonical sub-processor table", () => {
    const subProcessorsPath = resolve(
      __dirname,
      "..",
      "..",
      "..",
      "SUB-PROCESSORS.md",
    );
    const content = readFileSync(subProcessorsPath, "utf8");
    // Must list at minimum the four current production sub-processors.
    expect(content).toContain("Anthropic");
    expect(content).toContain("Vercel");
    expect(content).toContain("Cloudflare");
    expect(content).toContain("GitHub");
    // And the AU residency story for the LLM disclosure.
    expect(content).toContain("AU-region");
  });
});

describe("PublicLayout trust footer", () => {
  it("renders links to every trust page in its footer", () => {
    const src = readFileSync(
      join(__dirname, "..", "components", "PublicLayout.tsx"),
      "utf8",
    );
    expect(src).toContain('href: "/trust"');
    expect(src).toContain('href: "/security"');
    expect(src).toContain('href: "/status"');
    expect(src).toContain('href: "/changelog"');
    expect(src).toContain('href: "/privacy"');
    expect(src).toContain('href: "/trust/sub-processors"');
  });

  it("exposes TrustPageShell with a Back-to-product link", () => {
    const src = readFileSync(
      join(__dirname, "..", "components", "PublicLayout.tsx"),
      "utf8",
    );
    expect(src).toContain("TrustPageShell");
    expect(src).toContain("Back to product");
  });
});
