/** Escape XML/HTML special chars for safe embedding in prompt context blocks. */
export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Truncate to at most `n` chars, appending an ellipsis when cut. */
export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
