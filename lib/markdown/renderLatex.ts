import katex from "katex";

// Typesetting is the expensive part of showing an equation, and markdown views
// re-render whole documents on every autosave. Cache by source so an unchanged
// equation costs a map lookup; bounded so a long editing session can't grow it
// without limit (oldest entry evicted first).
const MAX_ENTRIES = 500;
const cache = new Map<string, string>();

/** KaTeX HTML for `latex`. Invalid LaTeX renders KaTeX's inline error text. */
export function renderLatex(latex: string, displayMode: boolean): string {
  const key = `${displayMode ? "D" : "I"}${latex}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const html = katex.renderToString(latex, { displayMode, throwOnError: false });
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, html);
  return html;
}
