// In-memory per-IP rate limiter for the unauthenticated proxy routes
// (/api/fetch-url, /api/transcript). assertSameOrigin only stops casual/browser
// abuse; a scripted client can spoof Origin and use these as an open proxy. This
// is the actual abuse defense: a fixed-window cap per IP per route.
//
// Scope: process-local. Fine for a single long-lived Railway instance (resets on
// redeploy, not shared across instances). When the app scales horizontally or
// needs durable limits, swap rateLimit() for a Redis/Upstash-backed check behind
// the same assertRateLimit() seam — callers won't change.

import { GuardError } from "./guardFetch";

/** Thrown when a caller exceeds its rate budget. Routes map this to a 429. */
export class RateLimitError extends GuardError {
  constructor(public retryAfterSeconds: number) {
    super("Rate limit exceeded.");
  }
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastSweep = 0;

/** Best-effort client IP. Behind Railway the real IP is the first x-forwarded-for hop. */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function sweep(now: number): void {
  // Drop expired buckets occasionally so the map can't grow without bound.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(key);
  }
}

/**
 * Enforce `limit` requests per `windowMs` for `key`. Throws RateLimitError when
 * the budget is spent. `name` namespaces the bucket so routes don't share quota.
 */
export function assertRateLimit(
  request: Request,
  name: string,
  limit: number,
  windowMs: number,
): void {
  const now = Date.now();
  sweep(now);
  const key = `${name}:${clientIp(request)}`;
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (b.count >= limit) {
    throw new RateLimitError(Math.ceil((b.resetAt - now) / 1000));
  }
  b.count++;
}
