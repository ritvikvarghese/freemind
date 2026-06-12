import type { NextConfig } from "next";
import path from "node:path";

// Content-Security-Policy for this bring-your-own-key app. The load-bearing
// directive is `connect-src`: the user's Anthropic key lives in localStorage,
// so the real defense against key theft is restricting where the browser may
// send data. With connect-src locked to our own origin + api.anthropic.com,
// even injected or compromised-dependency code cannot POST the key to an
// attacker endpoint (api.anthropic.com only accepts that user's own key, and
// our same-origin routes never receive or forward it).
//
// script-src/style-src intentionally keep 'unsafe-inline' (plus 'wasm-unsafe-eval'
// for tldraw/pdf.js WASM). Next's hydration and tldraw inject inline scripts and
// styles; a nonce-based policy would force every page into dynamic rendering and
// give up static prerendering/caching, a real performance cost. Since key
// exfiltration is gated by connect-src regardless of whether a script runs, that
// tradeoff is acceptable here.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:", // link-card thumbnails are arbitrary https; image cards use data:/blob:
  "font-src 'self' data: https://cdn.tldraw.com", // tldraw loads its UI fonts from its CDN
  // The browser may only talk to us, Anthropic, and tldraw's static asset CDN
  // (translations/fonts). cdn.tldraw.com is a Cloudflare static CDN, not an
  // attacker-controllable sink, so it does not open a key-exfiltration channel.
  "connect-src 'self' https://api.anthropic.com https://cdn.tldraw.com",
  "worker-src 'self' blob:", // pdf.js / tldraw workers
  "frame-src 'self' blob:", // PDFs render in a blob: iframe
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'", // no embedding (clickjacking)
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // same-origin (not no-referrer): our same-origin proxy routes (/api/transcript,
  // /api/fetch-url) authorize callers via the Referer header, and a same-origin
  // GET sends no Origin header. no-referrer stripped the Referer too and broke
  // them with 403. same-origin keeps the referrer for our own requests while
  // still sending nothing to external sites.
  { key: "Referrer-Policy", value: "same-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

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
  async headers() {
    // Apply the security headers to every route.
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
