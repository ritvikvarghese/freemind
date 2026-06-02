import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    // Don't eagerly load every page's JS modules into memory on server start.
    // Trims the dev-server footprint on this memory-heavy app (tldraw + pdfjs
    // + Anthropic SDK). Docs: next/dist/docs/01-app/02-guides/memory-usage.md.
    preloadEntriesOnStart: false,
  },
};

export default nextConfig;
