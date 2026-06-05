import type { Note } from "./types";

/**
 * Render a doc's notes as markdown for AI context, snapshots, and any plain-text
 * surface. Document order (by highlight offset), each note a blockquote of the
 * clipped passage followed by its comment when present.
 */
export function notesToText(notes: Note[]): string {
  return [...notes]
    .sort((a, b) => a.start - b.start)
    .map((n) => {
      const quote = n.quote.trim();
      const comment = n.comment.trim();
      // Manual notes have no clipped passage: emit just the comment.
      if (!quote) return comment;
      return comment ? `> ${quote}\n${comment}` : `> ${quote}`;
    })
    .filter((s) => s.length > 0)
    .join("\n\n");
}
