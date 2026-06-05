"use client";

import type { Editor } from "@tiptap/core";
import type { Proposal } from "@/lib/storage/chatTypes";

export type ResolvedRange = {
  /** Markdown-string offsets within the current serialized doc. */
  from: number;
  to: number;
};

/**
 * Resolve a propose_edit anchor triple against the current markdown. Returns
 * the unique character range, or null if the anchor matches zero or more than
 * one time (treated as stale by the caller).
 */
export function resolveProposeEditRange(
  markdown: string,
  anchorBefore: string,
  oldText: string,
  anchorAfter: string,
): ResolvedRange | null {
  if (!oldText) {
    // Empty old_text means INSERT, not replace (e.g. writing into an empty
    // document, or appending). Return a zero-width range positioned by whichever
    // anchor is present; with neither, append at the end (= start of an empty
    // doc). This is what lets the model fill a blank document at all.
    if (anchorBefore) {
      const a = markdown.indexOf(anchorBefore);
      const dup = a >= 0 ? markdown.indexOf(anchorBefore, a + 1) : -1;
      if (a >= 0 && dup < 0) {
        const pos = a + anchorBefore.length;
        return { from: pos, to: pos };
      }
      return null;
    }
    if (anchorAfter) {
      const a = markdown.indexOf(anchorAfter);
      const dup = a >= 0 ? markdown.indexOf(anchorAfter, a + 1) : -1;
      if (a >= 0 && dup < 0) return { from: a, to: a };
      return null;
    }
    return { from: markdown.length, to: markdown.length };
  }
  const needle = anchorBefore + oldText + anchorAfter;
  const first = markdown.indexOf(needle);
  if (first < 0) {
    // Fall back 1: match `old_text` alone — only succeed if there's a unique hit.
    const a = markdown.indexOf(oldText);
    const b = a >= 0 ? markdown.indexOf(oldText, a + 1) : -1;
    if (a >= 0 && b < 0) {
      return { from: a, to: a + oldText.length };
    }
    // Fall back 2: whitespace-tolerant match. Minor drift (a stray space, a
    // newline vs space) shouldn't make a good edit go stale. Build a regex that
    // lets any run of whitespace in `old_text` match any run in the doc, and
    // accept it only when it resolves to exactly one location.
    const fuzzy = whitespaceTolerantRange(markdown, oldText);
    if (fuzzy) return fuzzy;
    return null;
  }
  // Must be unique with the full triple too.
  const second = markdown.indexOf(needle, first + 1);
  if (second >= 0) return null;
  const from = first + anchorBefore.length;
  return { from, to: from + oldText.length };
}

/** Unique whitespace-insensitive match of `oldText`, mapped to original offsets. */
function whitespaceTolerantRange(
  markdown: string,
  oldText: string,
): ResolvedRange | null {
  const trimmed = oldText.trim();
  if (trimmed.length < 4) return null; // too short to anchor safely
  const pattern = trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  let re: RegExp;
  try {
    re = new RegExp(pattern, "g");
  } catch {
    return null;
  }
  const matches: Array<{ from: number; to: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    matches.push({ from: m.index, to: m.index + m[0].length });
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
    if (matches.length > 1) return null; // ambiguous
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Resolve a propose_replace_section by heading. Section spans from the heading
 * line to (but not including) the next heading of equal or higher level.
 * `heading` is the literal heading line as it appears in the doc (e.g. "## Intro").
 */
export function resolveSectionRange(
  markdown: string,
  heading: string,
): ResolvedRange | null {
  const trimmedHeading = heading.trim();
  const m = trimmedHeading.match(/^(#+)\s+/);
  if (!m) return null;
  const level = m[1].length;

  const lines = markdown.split("\n");
  let lineStart = 0;
  let headingLine = -1;
  let headingCharStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === trimmedHeading) {
      headingLine = i;
      headingCharStart = lineStart;
      break;
    }
    lineStart += lines[i].length + 1;
  }
  if (headingLine < 0) return null;

  let charPos = headingCharStart + lines[headingLine].length + 1;
  let endChar = markdown.length;
  for (let i = headingLine + 1; i < lines.length; i++) {
    const hm = lines[i].match(/^(#+)\s+/);
    if (hm && hm[1].length <= level) {
      endChar = charPos;
      break;
    }
    charPos += lines[i].length + 1;
  }
  return { from: headingCharStart, to: endChar };
}

/**
 * Apply a proposal to the editor by re-serializing the current doc, computing
 * the replaced markdown, and feeding it back through Tiptap. Re-parsing the
 * whole document is heavier than a surgical transaction but it sidesteps the
 * gnarly markdown-position → ProseMirror-position mapping. Tiptap's built-in
 * undo records this as a single history entry.
 */
export function applyProposalToEditor(
  editor: Editor,
  proposal: Proposal,
): { ok: true } | { ok: false; reason: "stale" } {
  const markdown = editor.getMarkdown();
  let range: ResolvedRange | null;
  let replacement: string;
  if (proposal.kind === "propose_edit") {
    range = resolveProposeEditRange(
      markdown,
      proposal.anchor_before,
      proposal.old_text,
      proposal.anchor_after,
    );
    replacement = proposal.new_text;
  } else {
    range = resolveSectionRange(markdown, proposal.heading);
    replacement = proposal.new_markdown;
  }
  if (!range) return { ok: false, reason: "stale" };

  const next =
    markdown.slice(0, range.from) + replacement + markdown.slice(range.to);
  // Preserve the reading position. setContent re-parses the whole document and
  // would otherwise jump the view to the top on every accept.
  const scroller = editor.view.dom.closest(
    ".canvas-ai-focus-paper",
  ) as HTMLElement | null;
  const prevScroll = scroller ? scroller.scrollTop : null;
  editor.commands.setContent(next, { contentType: "markdown", emitUpdate: true });
  if (scroller && prevScroll != null) {
    requestAnimationFrame(() => {
      scroller.scrollTop = prevScroll;
    });
  }
  return { ok: true };
}

export function isProposalResolvable(
  markdown: string,
  proposal: Proposal,
): boolean {
  if (proposal.kind === "propose_edit") {
    return (
      resolveProposeEditRange(
        markdown,
        proposal.anchor_before,
        proposal.old_text,
        proposal.anchor_after,
      ) !== null
    );
  }
  return resolveSectionRange(markdown, proposal.heading) !== null;
}

/**
 * Walk all pending proposals; if two resolved ranges overlap, mark the
 * later-added ones as `blocked`. The first proposal in iteration order keeps
 * its `pending` status. Caller passes the proposals in registry-add order.
 */
export function computeBlockedIds(
  markdown: string,
  proposals: Proposal[],
): Set<string> {
  const claimed: Array<{ from: number; to: number }> = [];
  const blocked = new Set<string>();
  for (const p of proposals) {
    if (p.status !== "pending" && p.status !== "blocked") continue;
    const r =
      p.kind === "propose_edit"
        ? resolveProposeEditRange(
            markdown,
            p.anchor_before,
            p.old_text,
            p.anchor_after,
          )
        : resolveSectionRange(markdown, p.heading);
    if (!r) continue;
    const overlaps = claimed.some(
      (c) => !(r.to <= c.from || r.from >= c.to),
    );
    if (overlaps) blocked.add(p.id);
    else claimed.push(r);
  }
  return blocked;
}
