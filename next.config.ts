import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl in no-URL-routing mode: locale + messages are resolved per request
// in i18n/request.ts (from the NEXT_LOCALE cookie / Accept-Language), never from
// a URL prefix — tenant routing already owns the subdomain (see proxy.ts).
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Standalone output for the self-hosted Docker image (DOCKER_BUILD=1 in the
  // Dockerfile). Vercel/local dev builds are unaffected.
  ...(process.env.DOCKER_BUILD ? { output: "standalone" as const } : {}),
  allowedDevOrigins: ["lvh.me", "*.lvh.me"],
  // Pin the workspace root to this directory. Sibling lockfiles (site/, repo
  // root) would otherwise make Next infer the wrong workspace root.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default withNextIntl(nextConfig);
