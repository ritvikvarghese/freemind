"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { useFocusTransition } from "./useFocusTransition";
import {
  X,
  FileText,
  FileType,
  MonitorPlay,
  ExternalLink,
  ScanText,
  Maximize2,
  Minimize2,
  Plus,
  Copy,
  SquarePlus,
  type LucideIcon,
} from "lucide-react";
import { MarkdownView } from "@/components/MarkdownView";
import type { UploadNodeShape } from "@/components/canvas/shapes/UploadNode";
import { syncNotesNode } from "@/components/canvas/shapes/NotesNode";
import { copyTextToCanvas } from "@/components/canvas/copyToCanvas";
import type { Note } from "@/lib/notes/types";
import { newNoteId } from "@/lib/notes/types";
import {
  getSelectionInfo,
  applyNoteHighlights,
  clearNoteHighlights,
  scrollToNote,
} from "@/lib/notes/highlight";
import { NotesPanel } from "./NotesPanel";

type Props = {
  shapeId: TLShapeId;
  onClose: () => void;
};

/**
 * Two-pane focus view of an upload (mirrors ImageFocusMode). Left: the file
 * rendered as authored (the PDF itself, or rendered markdown). Right: the
 * read-only extracted text the AI uses as context. The title is editable here
 * (it autosaves to `filename`, which is also the source label the AI sees);
 * the content stays read-only. We do NOT set `isReadonly` (it silently kills
 * shape writes in tldraw v5, which would block the rename) and the overlay
 * already shields the canvas. YouTube uploads (legacy) have no raw doc, so
 * they show their transcript single-pane.
 */
export function UploadFocusMode({ shapeId, onClose }: Props) {
  const editor = useEditor();
  const shape = editor.getShape(shapeId) as UploadNodeShape | undefined;
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Open/close animation: grow out of / shrink back into the card's rect.
  const { style: focusStyle, requestClose } = useFocusTransition(
    shapeId,
    onClose,
  );
  // PDFs open on the original "document" tab (with a notes rail); "extracted"
  // is the note-taking text you slide over to. Non-PDF uploads ignore this.
  const [pdfTab, setPdfTab] = useState<"extracted" | "document">("document");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [name, setName] = useState(shape?.props.filename ?? "");
  const latestName = useRef(name);
  const nameTimer = useRef<number | null>(null);

  useEffect(() => {
    latestName.current = name;
  }, [name]);

  // Persist the rename to the shape's `filename` (debounced). Falls back to the
  // existing name if the field is blanked, so a source is never left untitled.
  const flushName = useCallback(() => {
    const current = editor.getShape(shapeId) as UploadNodeShape | undefined;
    if (!current) return;
    const next = latestName.current.trim() || current.props.filename;
    if (current.props.filename === next) return;
    editor.updateShape<UploadNodeShape>({
      id: shapeId,
      type: "canvas-ai-upload",
      props: { filename: next },
    });
  }, [editor, shapeId]);

  const scheduleFlushName = useCallback(() => {
    if (nameTimer.current !== null) window.clearTimeout(nameTimer.current);
    nameTimer.current = window.setTimeout(() => {
      nameTimer.current = null;
      flushName();
    }, 250);
  }, [flushName]);

  // Flush any pending rename on unmount (covers Esc / close).
  useEffect(() => () => flushName(), [flushName]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        flushName();
        requestClose();
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [requestClose, flushName]);

  useEffect(() => {
    if (!shape) onClose();
  }, [shape, onClose]);

  // Render PDFs from a Blob URL set imperatively on the iframe, not a `data:`
  // URL. Chromium's PDF viewer silently refuses large `data:` URIs (a 100+
  // page book is several MB), leaving the iframe blank; Blob URLs have no such
  // limit. Setting src via ref (not state) keeps this off the set-state-in-
  // effect path and re-runs cleanly under StrictMode.
  useEffect(() => {
    const s = editor.getShape(shapeId) as UploadNodeShape | undefined;
    const data = s?.props.kind === "pdf" ? s.props.pdfData : "";
    const el = iframeRef.current;
    if (!data || !el) return;
    let url: string;
    try {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    } catch {
      return;
    }
    el.src = url;
    return () => URL.revokeObjectURL(url);
    // pdfTab: the iframe only mounts on the Document tab, so (re)apply the blob
    // src when the user slides to it.
  }, [editor, shapeId, pdfTab]);


  // ---- Reader notes (txt / md / docx highlights + comments) ----------------
  const proseRef = useRef<HTMLDivElement>(null);

  const notes = useValue(
    "upload-notes",
    () =>
      ((editor.getShape(shapeId) as UploadNodeShape | undefined)?.props.notes ??
        []) as Note[],
    [editor, shapeId],
  );

  const readNotes = useCallback(
    () =>
      ((editor.getShape(shapeId) as UploadNodeShape | undefined)?.props.notes ??
        []) as Note[],
    [editor, shapeId],
  );

  const writeNotes = useCallback(
    (next: Note[]) => {
      // Source upload owns the notes; mirror them onto the linked notes node
      // (created on first note). One run() so add/edit/delete is a single undo.
      editor.run(() => {
        editor.updateShape<UploadNodeShape>({
          id: shapeId,
          type: "canvas-ai-upload",
          props: { notes: next },
        });
        syncNotesNode(editor, shapeId, next);
      });
    },
    [editor, shapeId],
  );

  // The selection-anchored "Underline" pill: captured at mouseup, rendered at
  // the selection's screen rect. We stash the offsets so the action survives
  // the selection being cleared by the click.
  const [pending, setPending] = useState<{
    start: number;
    end: number;
    quote: string;
    top: number;
    left: number;
  } | null>(null);

  const handleProseMouseUp = useCallback(() => {
    const el = proseRef.current;
    if (!el) return;
    const info = getSelectionInfo(el);
    const sel = window.getSelection();
    const rect =
      info && sel && sel.rangeCount > 0
        ? sel.getRangeAt(0).getBoundingClientRect()
        : null;
    if (!info || !rect) {
      setPending(null);
      return;
    }
    setPending({
      start: info.start,
      end: info.end,
      quote: info.quote,
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
  }, []);

  const addPendingNote = useCallback(() => {
    if (!pending) return;
    const note: Note = {
      id: newNoteId(),
      quote: pending.quote,
      comment: "",
      start: pending.start,
      end: pending.end,
      createdAt: Date.now(),
    };
    writeNotes([...readNotes(), note]);
    window.getSelection()?.removeAllRanges();
    setPending(null);
  }, [pending, writeNotes, readNotes]);

  // Copy arbitrary text to the clipboard (best-effort; silent if blocked).
  const copyText = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      /* clipboard unavailable (insecure context / denied) — no-op */
    }
  }, []);

  // Selection-box actions: operate on the captured quote so they survive the
  // selection being cleared, then dismiss the box.
  const copyPending = useCallback(() => {
    if (!pending) return;
    void copyText(pending.quote);
    window.getSelection()?.removeAllRanges();
    setPending(null);
  }, [pending, copyText]);

  const copyPendingToCanvas = useCallback(() => {
    if (!pending) return;
    copyTextToCanvas(editor, shapeId, pending.quote);
    window.getSelection()?.removeAllRanges();
    setPending(null);
  }, [pending, editor, shapeId]);

  // Note-card actions (right rail): copy / send the note's text to the canvas.
  const copyNote = useCallback(
    (note: Note) => void copyText(noteText(note)),
    [copyText],
  );
  const copyNoteToCanvas = useCallback(
    (note: Note) => copyTextToCanvas(editor, shapeId, noteText(note)),
    [editor, shapeId],
  );

  const updateNoteComment = useCallback(
    (id: string, comment: string) => {
      writeNotes(readNotes().map((n) => (n.id === id ? { ...n, comment } : n)));
    },
    [writeNotes, readNotes],
  );

  const deleteNote = useCallback(
    (id: string) => {
      writeNotes(readNotes().filter((n) => n.id !== id));
    },
    [writeNotes, readNotes],
  );

  // Add a note of one's own, with no clipped passage / highlight (start/end
  // -1 mark it as manual; the highlighter skips it). Works on any tab,
  // including the original-PDF view where text can't be selected.
  const addManualNote = useCallback(() => {
    const note: Note = {
      id: newNoteId(),
      quote: "",
      comment: "",
      start: -1,
      end: -1,
      createdAt: Date.now(),
    };
    writeNotes([...readNotes(), note]);
  }, [writeNotes, readNotes]);

  const jumpToNote = useCallback((note: Note) => {
    const el = proseRef.current;
    if (el) scrollToNote(el, note.start, note.end);
  }, []);

  // Paint the underlines whenever the notes change (and once mounted, so the
  // prose DOM exists). No-ops on PDF/youtube branches (no proseRef).
  useEffect(() => {
    const el = proseRef.current;
    if (el) applyNoteHighlights(el, notes);
    // pdfTab: the extracted-text surface unmounts on the Document tab, so
    // re-paint the highlights when the user slides back to it.
  }, [notes, mounted, pdfTab]);

  // Drop the global highlight registry entry when leaving this view.
  useEffect(() => () => clearNoteHighlights(), []);

  if (!shape) return null;

  const Icon =
    shape.props.kind === "pdf"
      ? FileText
      : shape.props.kind === "youtube"
        ? MonitorPlay
        : FileType;
  const meta =
    shape.props.kind === "pdf"
      ? `PDF · ${shape.props.pageCount} page${shape.props.pageCount === 1 ? "" : "s"}`
      : shape.props.kind === "youtube"
        ? "YouTube transcript"
        : "Markdown";

  // The Notes rail, shared by every notes-capable surface (md/docx prose, PDF
  // extracted text, and the original PDF). `onAddNote` lets the user add their
  // own note without selecting text in the document.
  const notesRail = (
    <NotesPanel
      notes={notes}
      onUpdateComment={updateNoteComment}
      onDelete={deleteNote}
      onJump={jumpToNote}
      onAddNote={addManualNote}
      onCopy={copyNote}
      onCopyToCanvas={copyNoteToCanvas}
    />
  );

  // Shared note-taking stage: a selectable text column (prose for md/docx, raw
  // extracted text for PDFs) plus the Notes rail. Full screen hides the rail
  // and widens the text. `proseRef` + the selection/highlight handlers are the
  // same machinery the md/docx flow already uses.
  const noteTakingStage = (
    inner: React.ReactNode,
    proseClassName: string,
    fullscreen: boolean,
  ) => (
    <div className="flex-1 overflow-hidden bg-app">
      <div
        className={`mx-auto grid h-full w-full gap-6 px-6 py-8 ${
          fullscreen
            ? "max-w-[1600px] grid-cols-1"
            : "max-w-[1100px] grid-cols-[minmax(0,1fr)_340px]"
        }`}
      >
        <div className="flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto rounded-node border border-hairline bg-elevated px-6 py-5">
            <div
              ref={proseRef}
              className={proseClassName}
              onMouseUp={handleProseMouseUp}
              onMouseDown={() => setPending(null)}
            >
              {inner}
            </div>
          </div>
        </div>
        {!fullscreen && notesRail}
      </div>
    </div>
  );

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upload focus mode"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      onKeyPress={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="canvas-ai-focus-root fixed inset-0 z-50 flex flex-col bg-overlay"
      style={focusStyle}
    >
      <div className="border-b border-hairline bg-elevated">
        <div className="mx-auto flex w-full max-w-[1100px] items-center gap-3 px-6 py-3">
          <Icon
            className="h-4 w-4 shrink-0 text-text-secondary"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.currentTarget.value);
                scheduleFlushName();
              }}
              onBlur={flushName}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  flushName();
                  e.currentTarget.blur();
                }
              }}
              onKeyUp={(e) => e.stopPropagation()}
              placeholder="Untitled"
              spellCheck={false}
              aria-label="File name"
              title="Rename this file"
              className="w-full min-w-0 truncate bg-transparent text-[15px] font-medium tracking-tight text-text-primary outline-none placeholder:text-text-tertiary"
            />
            <div className="text-[11px] text-text-tertiary">{meta}</div>
          </div>
          {shape.props.kind === "youtube" && shape.props.sourceUrl ? (
            <a
              href={shape.props.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-button px-2 py-1 text-[12px] text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Watch
            </a>
          ) : null}
          <button
            type="button"
            title="Close (Esc)"
            aria-label="Close focus mode"
            onClick={() => {
              flushName();
              requestClose();
            }}
            className="ml-1 grid h-7 w-7 place-items-center rounded-button text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {shape.props.kind === "pdf" ? (
        // Tab switcher: Original Document (default, with a notes rail) <->
        // Extracted text (note-taking). Full-screen applies to the open tab.
        <div className="border-b border-hairline bg-elevated">
          <div className="mx-auto flex h-[46px] w-full max-w-[1100px] items-center gap-1 px-6">
            <button
              type="button"
              onClick={() => setPdfTab("document")}
              className={`flex h-[46px] items-center gap-2 border-b-2 px-1 text-[13px] font-medium transition-colors ${
                pdfTab === "document"
                  ? "border-accent text-text-primary"
                  : "border-transparent text-text-tertiary hover:text-text-secondary"
              }`}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden />
              Original Document
            </button>
            <button
              type="button"
              onClick={() => setPdfTab("extracted")}
              className={`ml-4 flex h-[46px] items-center gap-2 border-b-2 px-1 text-[13px] font-medium transition-colors ${
                pdfTab === "extracted"
                  ? "border-accent text-text-primary"
                  : "border-transparent text-text-tertiary hover:text-text-secondary"
              }`}
            >
              <ScanText className="h-3.5 w-3.5" aria-hidden />
              Extracted text
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? "Exit full screen" : "Full screen"}
              className="flex h-7 items-center gap-1.5 rounded-button border border-hairline px-2.5 text-[12px] text-text-secondary transition-colors duration-100 hover:border-hairline-hover hover:text-text-primary"
            >
              {expanded ? (
                <Minimize2 className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" aria-hidden />
              )}
              {expanded ? "Exit full screen" : "Full screen"}
            </button>
          </div>
        </div>
      ) : null}

      {shape.props.kind === "youtube" ? (
        // Legacy YouTube upload: no source document, just the transcript.
        <div className="flex-1 overflow-auto bg-app">
          <div className="mx-auto w-full max-w-[760px] px-6 py-8">
            <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-text-primary">
              {shape.props.fullText || "No transcript."}
            </pre>
          </div>
        </div>
      ) : shape.props.kind === "pdf" ? (
        pdfTab === "document" ? (
          // Original PDF + a notes rail (your own notes; no text selection on
          // the PDF itself). Full screen hides the rail and widens the PDF.
          <div className="flex-1 overflow-hidden bg-app">
            <div
              className={`mx-auto grid h-full w-full gap-6 px-6 py-8 ${
                expanded
                  ? "max-w-[1600px] grid-cols-1"
                  : "max-w-[1100px] grid-cols-[minmax(0,1fr)_340px]"
              }`}
            >
              <div className="flex h-full w-full flex-col overflow-hidden rounded-node border border-hairline bg-elevated">
                {shape.props.pdfData ? (
                  <iframe
                    ref={iframeRef}
                    title={shape.props.filename}
                    className="h-full w-full border-0"
                  />
                ) : (
                  <div className="px-5 py-4 text-[12px] leading-relaxed text-text-tertiary">
                    The raw PDF wasn&apos;t stored for this upload. Re-upload it
                    to view the original with images and formatting. The
                    extracted text is on the Extracted text tab.
                  </div>
                )}
              </div>
              {!expanded && notesRail}
            </div>
          </div>
        ) : (
          // Extracted text = the note-taking surface (same flow as md/docx).
          // Plain text, preserving the extraction's line breaks.
          noteTakingStage(
            shape.props.fullText || "No extracted text.",
            "mx-auto max-w-[680px] whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text-primary",
            expanded,
          )
        )
      ) : (
        // Markdown / Word: clean prose + reader notes. Select text to highlight.
        noteTakingStage(
          <MarkdownView>{shape.props.fullText || ""}</MarkdownView>,
          "canvas-ai-prose mx-auto max-w-[680px]",
          false,
        )
      )}

      {pending ? (
        <div
          // Keep the selection alive through the click so the captured quote is
          // never lost mid-action.
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: "fixed",
            top: pending.top,
            left: pending.left,
            transform: "translate(-50%, -100%)",
          }}
          className="z-[60] flex items-center gap-0.5 rounded-button bg-text-primary p-1 text-app shadow-[var(--shadow-floating)]"
        >
          <SelectionAction icon={Plus} label="Add to notes" onClick={addPendingNote} />
          <span className="mx-0.5 h-4 w-px bg-app/20" aria-hidden />
          <SelectionAction icon={Copy} label="Copy" onClick={copyPending} />
          <SelectionAction
            icon={SquarePlus}
            label="Copy to canvas"
            onClick={copyPendingToCanvas}
          />
        </div>
      ) : null}
    </div>
  );

  if (typeof document === "undefined" || !document.body) {
    return overlay;
  }
  return createPortal(overlay, document.body);
}

/** A note's copyable text: its quote plus any comment. */
function noteText(note: Note): string {
  return [note.quote, note.comment]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** One labeled button in the floating text-selection action box. */
function SelectionAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex items-center gap-1.5 rounded-button px-2 py-1 text-[12px] font-medium text-app transition-colors duration-100 hover:bg-app/15"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}
