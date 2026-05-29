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
  if (!oldText) return null;
  const needle = anchorBefore + oldText + anchorAfter;
  const first = markdown.indexOf(needle);
  if (first < 0) {
    // Fall back: anchors might have been mangled by whitespace normalization.
    // Try matching `old_text` alone — only succeed if there's a unique hit.
    const a = markdown.indexOf(oldText);
    const b = a >= 0 ? markdown.indexOf(oldText, a + 1) : -1;
    if (a >= 0 && b < 0) {
      return { from: a, to: a + oldText.length };
    }
    return null;
  }
  // Must be unique with the full triple too.
  const second = markdown.indexOf(needle, first + 1);
  if (second >= 0) return null;
  const from = first + anchorBefore.length;
  return { from, to: from + oldText.length };
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
  editor.commands.setContent(next, { contentType: "markdown", emitUpdate: true });
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
