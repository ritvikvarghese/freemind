// Server-side request guards for the two unauthenticated proxy routes
// (/api/fetch-url, /api/transcript). On a public deploy these are the only
// owner-cost / owner-risk surface, so we (1) reject cross-origin callers,
// (2) block SSRF to private / loopback / link-local / metadata addresses after
// DNS resolution (defeats name-based rebinding), and (3) re-validate every
// redirect hop so an allowed host cannot 302 the fetch to an internal target.
//
// Node runtime only: uses node:dns and node:net. Set `export const runtime =
// "nodejs"` on any route that imports this (the Edge runtime lacks dns).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Thrown when a request or target is rejected. Routes map this to a 4xx. */
export class GuardError extends Error {}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    n = (n << 8) | octet;
  }
  return n >>> 0;
}

function ipv4Blocked(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable: block, never allow through
  const inRange = (base: string, bits: number): boolean => {
    const b = ipv4ToInt(base);
    if (b === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange("0.0.0.0", 8) || // "this" network
    inRange("10.0.0.0", 8) || // private
    inRange("100.64.0.0", 10) || // carrier-grade NAT
    inRange("127.0.0.0", 8) || // loopback
    inRange("169.254.0.0", 16) || // link-local incl. 169.254.169.254 metadata
    inRange("172.16.0.0", 12) || // private
    inRange("192.168.0.0", 16) // private
  );
}

function ipv6Blocked(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/%.*$/, ""); // strip zone id
  // IPv4-mapped (::ffff:a.b.c.d): classify by the embedded IPv4.
  const mapped = lower.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return ipv4Blocked(mapped[1]);
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  const head = lower.split(":")[0];
  const first = head === "" ? 0 : parseInt(head, 16);
  if (Number.isNaN(first)) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/**
 * Reject a hostname that resolves to a private / loopback / link-local address.
 * Resolves AFTER DNS so a public name pointing at an internal IP is caught;
 * literal IPs are checked directly. Throws GuardError on any blocked or
 * unresolvable host.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const literal = isIP(hostname);
  if (literal === 4) {
    if (ipv4Blocked(hostname)) throw new GuardError("Blocked address.");
    return;
  }
  if (literal === 6) {
    if (ipv6Blocked(hostname)) throw new GuardError("Blocked address.");
    return;
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw new GuardError("Could not resolve host.");
  }
  if (addrs.length === 0) throw new GuardError("Could not resolve host.");
  for (const { address, family } of addrs) {
    const blocked = family === 6 ? ipv6Blocked(address) : ipv4Blocked(address);
    if (blocked) throw new GuardError("Blocked address (private or loopback).");
  }
}

/**
 * Reject callers whose Origin/Referer host is not our own. Not a hard auth
 * boundary (headers are spoofable by a non-browser client), but it cuts casual
 * cross-site and scripted abuse of the open proxy. Behind Railway's proxy the
 * public host arrives as x-forwarded-host.
 */
export function assertSameOrigin(request: Request): void {
  const expected =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!expected) throw new GuardError("Missing host.");
  const source =
    request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) throw new GuardError("Missing origin."); // blocks curl/tools
  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    throw new GuardError("Bad origin.");
  }
  if (sourceHost !== expected) {
    throw new GuardError("Cross-origin request rejected.");
  }
}

/**
 * fetch() that follows redirects manually, re-running the SSRF host check on
 * every hop (including the initial URL). Only http(s). Throws GuardError on a
 * blocked host, a non-http(s) scheme, or too many redirects.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new GuardError("Only http(s) URLs are allowed.");
    }
    await assertPublicHost(parsed.hostname);
    const res = await fetch(current, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new GuardError("Too many redirects.");
}

const YOUTUBE_HOST =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|googlevideo\.com|ytimg\.com)$/i;

/** Reject a URL whose host is not a YouTube domain (transcript route). */
export function assertYouTubeHost(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new GuardError("Bad URL.");
  }
  if (!YOUTUBE_HOST.test(host)) {
    throw new GuardError("Non-YouTube host blocked.");
  }
}
