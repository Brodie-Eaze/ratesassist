// Content-Security-Policy. `'unsafe-eval'` is needed for Next 14 dev/HMR;
// in prod we should tighten by stripping it from this list. The CSP below
// is intentionally realistic for the live app surfaces (ArcGIS basemaps,
// OSM tiles, ABR JSON, SLIP WFS, Anthropic AU).
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://server.arcgisonline.com https://*.basemaps.cartocdn.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://server.arcgisonline.com https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://tiles.maps.eox.at https://*.tiles.maps.eox.at",
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
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
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
