import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this directory. Sibling lockfiles (site/, repo
  // root) would otherwise make Next infer the wrong workspace root.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
