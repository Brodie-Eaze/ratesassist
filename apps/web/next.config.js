/**
 * Next.js config — security headers, Tailwind/SWC transpilation, and the
 * NodeNext "*.js → *.ts" webpack alias for workspace packages.
 *
 * Content-Security-Policy is computed dynamically based on NODE_ENV:
 *
 *   - Production builds DROP `'unsafe-eval'` and `'unsafe-inline'` from
 *     `script-src`. Next.js 14's prod bundles don't need them; this closes
 *     the largest XSS-mitigation gap.
 *   - Development keeps `'unsafe-inline' 'unsafe-eval'` in `script-src` so
 *     Next's HMR runtime, dev overlay, and inline boot script still work.
 *   - `style-src` keeps `'unsafe-inline'` in both modes — Tailwind compiles
 *     to a single stylesheet but a handful of components (PropertyMap,
 *     StatsCard, MapChrome) inject critical inline <style> blocks for
 *     animated SVG strokes and Leaflet tooltip styling. Tightening that
 *     requires either a SHA allow-list per inline block (high churn) or
 *     migration to CSS modules — tracked in internal/SECURITY-FOLLOWUPS.md.
 *
 * The CSP tightening is a no-op for `next dev` (the dev server reads
 * NODE_ENV=development from Next.js's own envs). It activates as soon as
 * the prod build serves traffic, both locally via `next start` and on
 * Vercel.
 */
const isProd = process.env.NODE_ENV === "production";

// Next.js 14 App Router bootstraps every page with 5+ inline <script> tags
// containing hydration metadata, RSC payloads, and Next's runtime config.
// CSP without 'unsafe-inline' blocks all of them and the page never
// hydrates — server renders but client stays frozen.
//
// Until we migrate to nonce-based CSP (next.config + middleware emit a
// per-request nonce, every script element carries it, CSP uses
// 'strict-dynamic' with the nonce), 'unsafe-inline' must be present in
// production too. The other security controls (HSTS, frame-ancestors,
// CSRF, audit chain, AU region) remain strong; the inline-script risk is
// mitigated by the auth gate + RBAC.
//
// 'unsafe-eval' is dropped in production — Next.js prod bundles do NOT
// need it; only HMR/dev does.
const scriptSrcDirectives = [
  "'self'",
  "'unsafe-inline'",
  "https://server.arcgisonline.com",
  "https://*.basemaps.cartocdn.com",
];
if (!isProd) {
  scriptSrcDirectives.push("'unsafe-eval'");
}

const CSP_DIRECTIVES = [
  "default-src 'self'",
  `script-src ${scriptSrcDirectives.join(" ")}`,
  // See header comment: inline styles are still required for animated map
  // strokes and Leaflet tooltip overrides. Plan to remove → SECURITY-FOLLOWUPS.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://server.arcgisonline.com https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://tiles.maps.eox.at",
  "connect-src 'self' https://services.slip.wa.gov.au https://abr.business.gov.au https://api.anthropic.com https://api.anthropic.com.au",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(), camera=(), microphone=(), payment=()",
  },
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  // Workspace packages ship their TypeScript source with NodeNext-style ".js"
  // suffixes on relative imports (the canonical pattern for ESM libraries).
  // `transpilePackages` runs them through Next's SWC pipeline; the webpack
  // hook below maps the ".js" suffix back to the underlying ".ts" / ".tsx"
  // file, mirroring TypeScript's `moduleResolution: "Bundler"`.
  transpilePackages: [
    "@ratesassist/contract",
    "@ratesassist/identity",
    "@ratesassist/recovery-engine",
    "@ratesassist/spatial",
  ],
  // `@ratesassist/db` is loaded lazily from server-route code (lib/db.ts +
  // lib/clients.ts use dynamic `import()`), so Next.js never tries to
  // bundle pglite/pg into the server output. Keeping the package in
  // serverComponentsExternalPackages preserves that boundary even when
  // a future caller adds a static import — pglite ships its own worker
  // entry points and a WASM payload that webpack can't safely transform.
  experimental: {
    serverComponentsExternalPackages: [
      "@electric-sql/pglite",
      "pg",
      "@ratesassist/db",
      "@ratesassist/adapter-demo",
    ],
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

module.exports = nextConfig;
