// Rough heuristic: ~4 chars per token. Off by maybe 20% in either direction,
// good enough to gate "context too large" warnings well below the real cap.
export const MAX_INPUT_TOKENS_SOFT = 150_000;

export function estimateTokens(input: string | number): number {
  const chars = typeof input === "string" ? input.length : input;
  return Math.ceil(chars / 4);
}

export function fmtTokens(n: number): string {
  if (n < 1_000) return `${n} tok`;
  if (n < 100_000) return `${(n / 1_000).toFixed(1)}k tok`;
  return `${Math.round(n / 1_000)}k tok`;
}
