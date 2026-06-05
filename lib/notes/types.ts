/**
 * A reader's note clipped from a source document (uploaded txt/md/docx for now).
 * Each note is a verbatim highlight plus an optional comment. `start`/`end` are
 * character offsets into the document's RENDERED plain text (i.e. what
 * `Range.toString()` yields walking the focus-mode prose), so the underline can
 * be re-applied on reopen. They are NOT offsets into the raw markdown — the
 * rendered DOM drops `#`, `**`, etc., so raw offsets would not line up.
 */
export type Note = {
  id: string;
  /** The highlighted text, verbatim, for display and AI context. */
  quote: string;
  /** User annotation. May be empty — the highlight alone is a valid note. */
  comment: string;
  /** Char offset of the highlight start within the rendered prose text. */
  start: number;
  /** Char offset of the highlight end (exclusive). */
  end: number;
  createdAt: number;
};

/** Stable highlight name registered in the CSS Custom Highlight registry. */
export const NOTE_HIGHLIGHT_NAME = "canvas-ai-note";

export function newNoteId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `note-${Math.floor(performance.now() * 1000)}`;
}
