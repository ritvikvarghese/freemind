"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, StickyNote, Plus, Copy, SquarePlus } from "lucide-react";
import type { Note } from "@/lib/notes/types";

type NotesPanelProps = {
  notes: Note[];
  onUpdateComment: (id: string, comment: string) => void;
  onDelete: (id: string) => void;
  onJump: (note: Note) => void;
  /** Add an empty note of your own (no highlight). When omitted, the button is
   *  hidden. */
  onAddNote?: () => void;
  /** Copy a note's text (quote + comment) to the clipboard. */
  onCopy?: (note: Note) => void;
  /** Drop a note's text onto the canvas as its own shape. */
  onCopyToCanvas?: (note: Note) => void;
};

/**
 * Right-rail notes list for an upload's focus view. Notes are shown in document
 * order (by highlight offset). Each note is the verbatim quote plus an optional
 * comment; the comment autosaves (debounced) back to the source shape.
 */
export function NotesPanel({
  notes,
  onUpdateComment,
  onDelete,
  onJump,
  onAddNote,
  onCopy,
  onCopyToCanvas,
}: NotesPanelProps) {
  const ordered = useMemo(
    () =>
      [...notes].sort((a, b) => {
        // Highlighted notes first, in document order; manual notes (no
        // highlight, start < 0) after them, oldest first.
        const am = a.start < 0;
        const bm = b.start < 0;
        if (am !== bm) return am ? 1 : -1;
        if (am && bm) return a.createdAt - b.createdAt;
        return a.start - b.start;
      }),
    [notes],
  );

  return (
    <div className="flex flex-col overflow-hidden">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-text-tertiary">
        <StickyNote className="h-3 w-3" aria-hidden />
        Notes
        {ordered.length > 0 ? (
          <span className="text-text-tertiary">· {ordered.length}</span>
        ) : null}
        {onAddNote ? (
          <button
            type="button"
            onClick={onAddNote}
            title="Add your own note"
            className="ml-auto flex items-center gap-1 rounded-button px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
          >
            <Plus className="h-3 w-3" aria-hidden />
            new note
          </button>
        ) : null}
      </div>
      <div className="flex-1 overflow-auto rounded-node border border-hairline bg-elevated p-3">
        {ordered.length === 0 ? (
          <div className="px-1 py-2 text-[12px] leading-relaxed text-text-tertiary">
            Select text in the document and choose{" "}
            <span className="text-text-secondary">Add to notes</span> to clip it
            here, or use{" "}
            <span className="text-text-secondary">new note</span> to write your
            own. A comment is optional.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {ordered.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onUpdateComment={onUpdateComment}
                onDelete={onDelete}
                onJump={onJump}
                onCopy={onCopy}
                onCopyToCanvas={onCopyToCanvas}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NoteCard({
  note,
  onUpdateComment,
  onDelete,
  onJump,
  onCopy,
  onCopyToCanvas,
}: {
  note: Note;
  onUpdateComment: (id: string, comment: string) => void;
  onDelete: (id: string) => void;
  onJump: (note: Note) => void;
  onCopy?: (note: Note) => void;
  onCopyToCanvas?: (note: Note) => void;
}) {
  const [comment, setComment] = useState(note.comment);
  const latest = useRef(comment);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    latest.current = comment;
  }, [comment]);

  const flush = useCallback(() => {
    onUpdateComment(note.id, latest.current);
  }, [onUpdateComment, note.id]);

  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      flush();
    }, 300);
  }, [flush]);

  useEffect(() => () => flush(), [flush]);

  // Manual notes (added via "new note") have no clipped passage / highlight.
  const isManual = !note.quote;

  return (
    <div className="group rounded-button border border-hairline bg-app p-2.5">
      <div className="flex items-start gap-2">
        {isManual ? (
          <div className="min-w-0 flex-1 border-l-2 border-[var(--color-accent)] pl-2 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
            Note
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onJump(note)}
            title="Jump to highlight"
            className="min-w-0 flex-1 cursor-pointer border-l-2 border-[var(--color-accent)] pl-2 text-left text-[12.5px] leading-relaxed text-text-primary"
          >
            {note.quote}
          </button>
        )}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
          {onCopy ? (
            <button
              type="button"
              onClick={() => onCopy(note)}
              title="Copy note text"
              aria-label="Copy note text"
              className="grid h-6 w-6 place-items-center rounded-button text-text-tertiary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          {onCopyToCanvas ? (
            <button
              type="button"
              onClick={() => onCopyToCanvas(note)}
              title="Copy note to canvas"
              aria-label="Copy note to canvas"
              className="grid h-6 w-6 place-items-center rounded-button text-text-tertiary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
            >
              <SquarePlus className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDelete(note.id)}
            title="Delete note"
            aria-label="Delete note"
            className="grid h-6 w-6 place-items-center rounded-button text-text-tertiary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
      <textarea
        value={comment}
        onChange={(e) => {
          setComment(e.currentTarget.value);
          schedule();
        }}
        onBlur={flush}
        onKeyDown={(e) => {
          e.stopPropagation();
          // Enter concludes the note (commit + blur); Shift+Enter newlines.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            flush();
            e.currentTarget.blur();
          }
        }}
        onKeyUp={(e) => e.stopPropagation()}
        rows={comment ? 2 : 1}
        placeholder={isManual ? "Write your note…" : "Add a comment (optional)"}
        spellCheck
        autoFocus={isManual && !comment}
        className="mt-2 w-full resize-none rounded-button bg-transparent px-2 py-1 text-[12px] leading-relaxed text-text-secondary outline-none placeholder:text-text-tertiary focus:bg-elevated"
      />
    </div>
  );
}
