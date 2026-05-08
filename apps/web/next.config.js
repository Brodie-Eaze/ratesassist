/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
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
