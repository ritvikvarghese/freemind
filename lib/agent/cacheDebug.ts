import type { Usage } from "@anthropic-ai/sdk/resources/messages";

/**
 * Dev-only prompt-cache instrumentation. Reads the per-request token breakdown
 * off any Anthropic response `usage` and logs a per-path cumulative hit ratio,
 * so we can attribute cache reads / writes / waste to a specific call site
 * (research vs chat vs OCR) instead of one org-wide Console number.
 *
 * Gated on NEXT_PUBLIC_CACHE_DEBUG=1 (inlined at build time). Off in the
 * published product: zero output, zero behavior change.
 */
const ON =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_CACHE_DEBUG === "1";

type Tally = { read: number; write: number; uncached: number; calls: number };
const tally = new Map<string, Tally>();

export function logUsage(path: string, u?: Partial<Usage> | null): void {
  if (!ON || !u) return;
  const t = tally.get(path) ?? { read: 0, write: 0, uncached: 0, calls: 0 };
  t.read += u.cache_read_input_tokens ?? 0;
  t.write += u.cache_creation_input_tokens ?? 0;
  t.uncached += u.input_tokens ?? 0;
  t.calls += 1;
  tally.set(path, t);
  const total = t.read + t.write + t.uncached;
  const hit = total ? ((t.read / total) * 100).toFixed(1) : "0";
  console.debug(
    `[cache:${path}] read=${u.cache_read_input_tokens ?? 0} write=${u.cache_creation_input_tokens ?? 0} uncached=${u.input_tokens ?? 0} | cum hit=${hit}% over ${t.calls}`,
  );
}
