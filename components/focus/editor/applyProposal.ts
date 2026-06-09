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
    //
    // Anchors resolve through `uniqueAnchorRange` so the insert path gets the
    // SAME serialization-drift tolerance the replace path has (a stray space,
    // newline-vs-space, or re-escaped `*`→`\*`). Inserts ("add to the bottom",
    // "add after this section") used to require a byte-exact anchor and so were
    // the most fragile operation; this brings them in line.
    if (anchorBefore) {
      const r = uniqueAnchorRange(markdown, anchorBefore);
      return r ? { from: r.to, to: r.to } : null;
    }
    if (anchorAfter) {
      const r = uniqueAnchorRange(markdown, anchorAfter);
      return r ? { from: r.from, to: r.from } : null;
    }
    return { from: markdown.length, to: markdown.length };
  }
  const needle = anchorBefore + oldText + anchorAfter;
  const first = markdown.indexOf(needle);
  if (first < 0) {
    // The anchored triple drifted. Fall back to locating `old_text` on its own,
    // tolerantly and only when unambiguous (see uniqueAnchorRange).
    return uniqueAnchorRange(markdown, oldText);
  }
  // Must be unique with the full triple too.
  const second = markdown.indexOf(needle, first + 1);
  if (second >= 0) return null;
  const from = first + anchorBefore.length;
  return { from, to: from + oldText.length };
}

/**
 * Locate a single string unambiguously: a unique exact match if there is one,
 * otherwise the drift-tolerant `flexibleRange` fallback (which also requires a
 * single hit). Returns the matched range — so an insert can sit at its start or
 * end — or null when the text is missing or ambiguous. Shared by the INSERT and
 * replace-fallback paths so both tolerate the same serialization drift.
 */
function uniqueAnchorRange(
  markdown: string,
  anchor: string,
): ResolvedRange | null {
  if (!anchor) return null;
  const a = markdown.indexOf(anchor);
  if (a >= 0 && markdown.indexOf(anchor, a + 1) < 0) {
    return { from: a, to: a + anchor.length };
  }
  return flexibleRange(markdown, anchor);
}

// Markdown punctuation the serializer may backslash-escape (`*` → `\*`).
const ESCAPABLE = "\\`*_{}[]()#+-.!>~|";

// Characters the model (or a typography pass) routinely swaps for a look-alike,
// so an "exact" copy of the doc text no longer matches byte-for-byte. Each maps
// to a regex fragment matching the whole family, so a straight quote in the
// model's text still finds a curly quote in the doc and vice versa.
const EQUIV_CLASS: Record<string, string> = {
  '"': '["“”]',
  "“": '["“”]',
  "”": '["“”]',
  "'": "['‘’]",
  "‘": "['‘’]",
  "’": "['‘’]",
  // dashes are also markdown-escapable, so allow an optional leading backslash.
  "-": "\\\\?[-–—]",
  "–": "\\\\?[-–—]",
  "—": "\\\\?[-–—]",
};

/**
 * Unique match of `oldText` tolerant of the ways a copy of the doc text can stop
 * matching byte-for-byte: whitespace reflow (newline vs space, collapsed runs),
 * markdown re-escaping (`*` vs `\*`), and look-alike punctuation swaps (straight
 * vs curly quotes, hyphen vs en/em dash, `...` vs `…`). Builds a regex over the
 * ORIGINAL markdown so the returned offsets map straight back, and accepts the
 * result only when it's unambiguous (exactly one location).
 */
function flexibleRange(
  markdown: string,
  oldText: string,
): ResolvedRange | null {
  const trimmed = oldText.trim();
  if (trimmed.length < 4) return null; // too short to anchor safely
  let pattern = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (/\s/.test(ch)) {
      pattern += "\\s+";
      while (i + 1 < trimmed.length && /\s/.test(trimmed[i + 1])) i++; // collapse run
      continue;
    }
    const eq = EQUIV_CLASS[ch];
    if (eq) {
      pattern += eq;
      continue;
    }
    if (ch === "…") {
      pattern += "(?:…|\\.\\.\\.)"; // ellipsis char or three literal dots
      continue;
    }
    if (ch === "." && trimmed[i + 1] === "." && trimmed[i + 2] === ".") {
      pattern += "(?:\\.\\.\\.|…)"; // three literal dots or the ellipsis char
      i += 2;
      continue;
    }
    const lit = ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Let an escapable char match with OR without a leading backslash in the doc.
    pattern += ESCAPABLE.includes(ch) ? "\\\\?" + lit : lit;
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, "g");
  } catch {
    return null;
  }
  let found: ResolvedRange | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    if (found) return null; // ambiguous — more than one location
    found = { from: m.index, to: m.index + m[0].length };
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
  }
  return found;
}

const ATX_HEADING = /^(#+)\s+/;
// A line that is ENTIRELY bold/strong, used as a section title in AI-written
// markdown that doesn't use `#` headings (e.g. "**What she might object to.**").
const BOLD_HEADING = /^(\*\*|__).+\1$/;

function isAtxHeadingLine(line: string): boolean {
  return ATX_HEADING.test(line.trim());
}
function isBoldHeadingLine(line: string): boolean {
  return BOLD_HEADING.test(line.trim());
}
function isHeadingLine(line: string): boolean {
  return isAtxHeadingLine(line) || isBoldHeadingLine(line);
}

/** Comparable key for a heading: trim + collapse whitespace, then strip the
 *  `#`/`##` prefix and any surrounding `**`/`__` so a section matches whether
 *  the model quoted the markers or just the words, and tolerates re-serialized
 *  spacing drift ("##  Intro " === "## Intro" === "Intro"). */
function headingKey(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .replace(ATX_HEADING, "")
    .replace(/^(\*\*|__)/, "")
    .replace(/(\*\*|__)$/, "")
    .trim();
}

/** Does `line` start a new section that ends the current one? An ATX section
 *  ends only at an ATX heading of equal-or-higher level (sub-headings stay in).
 *  A bold pseudo-heading section has no sub-levels, so it ends at the next
 *  heading of ANY kind. */
function isSectionBoundary(line: string, level: number | null): boolean {
  const atx = line.trim().match(ATX_HEADING);
  if (level == null) return isHeadingLine(line);
  return !!atx && atx[1].length <= level;
}

/** Per-line mask of fenced code blocks (``` or ~~~). Lines inside a fence — and
 *  the fence delimiters themselves — must not be read as headings or section
 *  boundaries, or a `# comment` / `**bold**` line inside a code sample would
 *  mis-target or truncate a section. */
function codeFenceMask(lines: string[]): boolean[] {
  const mask: boolean[] = new Array(lines.length).fill(false);
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{0,3}(```|~~~)/.test(lines[i])) {
      mask[i] = true; // the delimiter line is never a heading
      inside = !inside;
      continue;
    }
    mask[i] = inside;
  }
  return mask;
}

/**
 * Resolve a propose_replace_section by heading. Section spans from the heading
 * line to (but not including) the next heading that ends it. Handles both real
 * ATX headings ("## Intro") and bold lines used as section titles
 * ("**Alternatives considered.**") — AI docs commonly use the latter, and the
 * model targets whichever it sees.
 */
export function resolveSectionRange(
  markdown: string,
  heading: string,
): ResolvedRange | null {
  const wantKey = headingKey(heading);
  if (!wantKey) return null;

  const lines = markdown.split("\n");
  const inCode = codeFenceMask(lines);
  let lineStart = 0;
  let headingLine = -1;
  let headingCharStart = 0;
  let matchCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (
      !inCode[i] &&
      isHeadingLine(lines[i]) &&
      headingKey(lines[i]) === wantKey
    ) {
      matchCount++;
      if (headingLine < 0) {
        headingLine = i;
        headingCharStart = lineStart;
      }
    }
    lineStart += lines[i].length + 1;
  }
  // Ambiguous: the same title appears more than once, so we can't know which
  // section the model meant. Treat as stale rather than silently overwriting the
  // first one (which could clobber unrelated content).
  if (headingLine < 0 || matchCount > 1) return null;

  // Take the level from the matched doc line (ground truth), not the model's
  // quoted heading: ATX → its `#` count; bold pseudo-heading → null.
  const atx = lines[headingLine].trim().match(ATX_HEADING);
  const level = atx ? atx[1].length : null;

  let charPos = headingCharStart + lines[headingLine].length + 1;
  let endChar = markdown.length;
  for (let i = headingLine + 1; i < lines.length; i++) {
    if (!inCode[i] && isSectionBoundary(lines[i], level)) {
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
 * True when the proposal's result is ALREADY in the document: the original text
 * can no longer be located but the replacement now sits where it belongs. This
 * is the difference between "the doc moved underneath this edit" (stale — needs
 * redo) and "this edit succeeded" (accepted). Without it, an applied edit reads
 * as stale and the only offered action (Redo) finds nothing to do.
 */
export function isProposalApplied(
  markdown: string,
  proposal: Proposal,
): boolean {
  if (proposal.kind === "propose_edit") {
    if (!proposal.new_text) return false; // pure insert — nothing to detect
    // If old_text still resolves, the edit hasn't been applied yet.
    if (
      resolveProposeEditRange(
        markdown,
        proposal.anchor_before,
        proposal.old_text,
        proposal.anchor_after,
      )
    )
      return false;
    // old_text is gone and new_text now resolves in its place → applied.
    return (
      resolveProposeEditRange(
        markdown,
        proposal.anchor_before,
        proposal.new_text,
        proposal.anchor_after,
      ) !== null
    );
  }
  // Section replace: the replacement body is present (whitespace-normalized).
  if (!proposal.new_markdown.trim()) return false;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return norm(markdown).includes(norm(proposal.new_markdown));
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
