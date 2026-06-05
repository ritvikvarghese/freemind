import { NOTE_HIGHLIGHT_NAME } from "./types";

/**
 * Highlighting reader notes without mutating React's DOM.
 *
 * We use the CSS Custom Highlight API (`CSS.highlights` + `Highlight` + `Range`)
 * so the underline is painted by the browser over live `Range`s — React keeps
 * full ownership of the prose DOM, and re-applying after a re-render is just
 * rebuilding the ranges. Offsets are measured with `Range.toString()` semantics
 * (concatenated text-node content), and re-applied by walking text nodes the
 * same way, so the two stay consistent.
 *
 * Feature-detected: on a browser without the API (older Safari/Firefox) the
 * helpers no-op and notes simply render without the in-document underline. The
 * Notes panel and the linked node still work everywhere.
 */

type OffsetRange = { start: number; end: number };

function highlightApiSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    // `highlights` is a recent addition; cast through unknown to avoid lib drift.
    "highlights" in CSS &&
    typeof (globalThis as { Highlight?: unknown }).Highlight === "function"
  );
}

/**
 * Offsets + text of the current window selection within `container`, or null
 * when there's no usable (non-empty, in-container) selection.
 */
export function getSelectionInfo(
  container: HTMLElement,
): { start: number; end: number; quote: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const quote = range.toString();
  if (!quote.trim()) return null;

  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + quote.length, quote };
}

/** Build a DOM Range for [start, end) by walking `container`'s text nodes. */
function rangeForOffsets(
  container: HTMLElement,
  start: number,
  end: number,
): Range | null {
  if (end <= start) return null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    if (startNode === null && pos + len > start) {
      startNode = node;
      startOffset = start - pos;
    }
    if (pos + len >= end) {
      endNode = node;
      endOffset = end - pos;
      break;
    }
    pos += len;
    node = walker.nextNode() as Text | null;
  }

  if (!startNode || !endNode) return null;
  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  } catch {
    return null;
  }
}

/**
 * Paint underlines for `notes` over `container`. Replaces any previously
 * registered note highlight. Returns false when the API is unavailable.
 */
export function applyNoteHighlights(
  container: HTMLElement,
  notes: OffsetRange[],
): boolean {
  if (!highlightApiSupported()) return false;
  const ranges: Range[] = [];
  for (const n of notes) {
    const r = rangeForOffsets(container, n.start, n.end);
    if (r) ranges.push(r);
  }
  const HighlightCtor = (globalThis as { Highlight: new (...r: Range[]) => unknown })
    .Highlight;
  const registry = (CSS as unknown as { highlights: Map<string, unknown> })
    .highlights;
  if (ranges.length === 0) {
    registry.delete(NOTE_HIGHLIGHT_NAME);
    return true;
  }
  registry.set(NOTE_HIGHLIGHT_NAME, new HighlightCtor(...ranges));
  return true;
}

/** Scroll `container` so the note at [start, end) is brought into view. */
export function scrollToNote(
  container: HTMLElement,
  start: number,
  end: number,
): void {
  const range = rangeForOffsets(container, start, end);
  const target = range?.startContainer.parentElement;
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
}

/** Remove the note highlight from the global registry (on focus-mode close). */
export function clearNoteHighlights(): void {
  if (!highlightApiSupported()) return;
  (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(
    NOTE_HIGHLIGHT_NAME,
  );
}
