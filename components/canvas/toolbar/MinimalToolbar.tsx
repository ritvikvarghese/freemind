"use client";

import {
  useEditor,
  useValue,
  createShapeId,
  getColorStyleItems,
  DefaultColorStyle,
  DefaultSizeStyle,
  type Editor,
  type TLDefaultColorStyle,
  type TLDefaultSizeStyle,
} from "tldraw";
import {
  Type,
  StickyNote,
  Pen,
  FileText,
  Upload,
  Image as ImageIcon,
  MonitorPlay,
  Loader2,
  CornerDownLeft,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "../toast";
import {
  DOCUMENT_NODE_DEFAULT_H,
  DOCUMENT_NODE_DEFAULT_W,
  type DocumentNodeShape,
} from "../shapes/DocumentNode";
import { ingestFiles } from "../ingestFiles";
import { ingestImages } from "../ingestImages";
import { ingestYouTube } from "../ingestYouTube";

export function MinimalToolbar() {
  const editor = useEditor();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [ytOpen, setYtOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [penOpen, setPenOpen] = useState(false);

  return (
    <div
      className="pointer-events-auto fixed left-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1 rounded-panel bg-elevated border border-hairline p-1 shadow-[var(--shadow-panel)]"
      // Don't let toolbar clicks reach the canvas (would deselect shapes / pop
      // the floating create palette or context menu).
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <ToolbarButton
        label="Add text (click canvas to place)"
        onClick={() => {
          // Text and notes share tldraw's single DefaultColorStyle, so the note
          // tool may have armed it yellow; force black (theme-aware ink) so new
          // text never inherits the note color. Color is then changed per shape
          // from the selection toolbar (CanvasRichTextToolbar).
          editor.setStyleForNextShapes(DefaultColorStyle, "black");
          editor.setCurrentTool("text");
        }}
      >
        <Type className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      <div className="relative">
        <ToolbarButton
          label="Add sticky note (pick a color, then click canvas)"
          active={noteOpen}
          onClick={() => {
            setYtOpen(false);
            setPenOpen(false);
            setNoteOpen((v) => !v);
          }}
        >
          <StickyNote className="h-4 w-4" aria-hidden />
        </ToolbarButton>
        {noteOpen ? (
          <NoteColorPicker editor={editor} onClose={() => setNoteOpen(false)} />
        ) : null}
      </div>
      <div className="relative">
        <ToolbarButton
          label="Pen (pick thickness, then draw)"
          active={penOpen}
          onClick={() => {
            setYtOpen(false);
            setNoteOpen(false);
            setPenOpen((v) => !v);
          }}
        >
          <Pen className="h-4 w-4" aria-hidden />
        </ToolbarButton>
        {penOpen ? (
          <PenPicker editor={editor} onClose={() => setPenOpen(false)} />
        ) : null}
      </div>
      <ToolbarButton
        label="New document"
        onClick={() => createBlankDoc(editor)}
      >
        <FileText className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Add image"
        onClick={() => imageInputRef.current?.click()}
      >
        <ImageIcon className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Upload PDF, Word, or markdown"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Add YouTube transcript"
        active={ytOpen}
        onClick={() => {
          setNoteOpen(false);
          setPenOpen(false);
          setYtOpen((v) => !v);
        }}
      >
        <MonitorPlay className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      {ytOpen ? (
        <YouTubeInput editor={editor} onClose={() => setYtOpen(false)} />
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          if (files.length > 0) await ingestFiles(editor, files);
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          if (files.length > 0) await addImages(editor, files);
        }}
      />
    </div>
  );
}

// Drops image files onto the canvas as our ImageNode shapes — downscaled,
// vision-OCR'd, and selectable as AI sources (unlike tldraw's native image).
async function addImages(editor: Editor, files: File[]): Promise<void> {
  try {
    await ingestImages(editor, files);
  } catch (err) {
    toast(
      `Could not add image: ${err instanceof Error ? err.message : "unknown error"}`,
      "error",
    );
  }
}

// Swatch flyout for the sticky-note tool. Picking a color arms tldraw's native
// note tool with that color (setStyleForNextShapes) so the next placed note
// uses it. Swatch fills come live from the editor theme (light/dark), so they
// exactly match the note that gets dropped. Yellow leads (the default) and grey
// is swapped for white; the rest follow tldraw's order. Laid out two per row.
function NoteColorPicker({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const swatches = useValue(
    "note-color-swatches",
    () => {
      const colors = editor.getCurrentTheme().colors[editor.getColorMode()];
      const fills = colors as unknown as Record<string, { noteFill: string }>;
      // Replace grey with white, then lead with yellow (the default).
      const names = getColorStyleItems(colors)
        .map((item) => (item.value === "grey" ? "white" : item.value))
        .filter((name) => name !== "yellow");
      return ["yellow", ...names].map((name) => ({
        name,
        fill: fills[name]?.noteFill,
      }));
    },
    [editor],
  );
  const active = useValue(
    "note-color-active",
    () => editor.getStyleForNextShape(DefaultColorStyle),
    [editor],
  );

  // Yellow is the default sticky-note color: when the armed color is tldraw's
  // global default (black, also what the pen sets), open on yellow. A color the
  // user actively picked for notes persists.
  useEffect(() => {
    if (editor.getStyleForNextShape(DefaultColorStyle) === "black") {
      editor.setStyleForNextShapes(DefaultColorStyle, "yellow");
    }
  }, [editor]);

  function pick(name: string) {
    editor.setStyleForNextShapes(DefaultColorStyle, name as TLDefaultColorStyle);
    editor.setCurrentTool("note");
    onClose();
  }

  return (
    <div
      className="absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 z-30 grid grid-cols-2 gap-2.5 rounded-panel border border-hairline bg-elevated p-2.5 shadow-[var(--shadow-floating)]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {swatches.map((s) => (
        <button
          key={s.name}
          type="button"
          title={s.name}
          aria-label={`Sticky note: ${s.name}`}
          onClick={() => pick(s.name)}
          style={{ backgroundColor: s.fill }}
          className={
            "h-7 w-7 rounded-[6px] border transition-transform duration-100 hover:scale-110 " +
            (active === s.name
              ? "border-text-secondary/60 ring-1 ring-text-secondary/40 ring-offset-1 ring-offset-elevated"
              : "border-hairline")
          }
        />
      ))}
    </div>
  );
}

// Thickness flyout for the pen. Picking a level arms tldraw's native draw tool
// with that stroke size and the theme-aware "black" ink, then switches to it.
const PEN_SIZES: { size: TLDefaultSizeStyle; dot: number; label: string }[] = [
  { size: "s", dot: 4, label: "Thin" },
  { size: "m", dot: 8, label: "Medium" },
  { size: "l", dot: 13, label: "Thick" },
];

function PenPicker({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const active = useValue(
    "pen-size-active",
    () => editor.getStyleForNextShape(DefaultSizeStyle),
    [editor],
  );

  function pick(size: TLDefaultSizeStyle) {
    // tldraw's "black" is theme-aware ink: dark on the light canvas and
    // near-white on the dark canvas, and it flips automatically when the theme
    // changes — so strokes stay visible (black on light, white on dark).
    editor.setStyleForNextShapes(DefaultColorStyle, "black");
    editor.setStyleForNextShapes(DefaultSizeStyle, size);
    editor.setCurrentTool("draw");
    onClose();
  }

  return (
    <div
      className="absolute left-[calc(100%+8px)] top-1/2 z-30 flex -translate-y-1/2 items-center gap-2 rounded-panel border border-hairline bg-elevated p-2.5 shadow-[var(--shadow-floating)]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {PEN_SIZES.map((s) => (
        <button
          key={s.size}
          type="button"
          title={s.label}
          aria-label={`Pen thickness: ${s.label}`}
          onClick={() => pick(s.size)}
          className={
            "grid h-9 w-9 place-items-center rounded-button border transition-transform duration-100 hover:scale-105 " +
            (active === s.size
              ? "border-text-secondary/60 bg-surface-hover ring-1 ring-text-secondary/40"
              : "border-hairline")
          }
        >
          <span
            className="rounded-full bg-text-primary"
            style={{ width: s.dot, height: s.dot }}
          />
        </button>
      ))}
    </div>
  );
}

function ToolbarButton({
  label,
  children,
  onClick,
  active = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={
        "h-9 w-9 grid place-items-center rounded-button transition-colors duration-100 " +
        (active
          ? "bg-surface-hover text-text-primary"
          : "text-text-secondary hover:text-text-primary hover:bg-surface-hover")
      }
    >
      {children}
    </button>
  );
}

function YouTubeInput({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function submit() {
    const trimmed = url.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    const ok = await ingestYouTube(editor, trimmed);
    setLoading(false);
    if (ok) onClose();
  }

  return (
    <div
      className="absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 w-72 rounded-panel border border-hairline bg-elevated p-2 shadow-[var(--shadow-floating)]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
          onKeyUp={(e) => e.stopPropagation()}
          placeholder="Paste a YouTube link…"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent px-1.5 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary"
        />
        <button
          type="button"
          onClick={submit}
          disabled={loading || url.trim().length === 0}
          aria-label="Fetch transcript"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-button bg-accent text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}

/** Create a blank document node centered at `center` (defaults to the viewport
 *  center). Exported so the double-click floating toolbar can drop a doc at the
 *  cursor too. */
export function createBlankDoc(
  editor: Editor,
  center?: { x: number; y: number },
) {
  const at = center ?? editor.getViewportPageBounds().center;
  const id = createShapeId();
  editor.createShape<DocumentNodeShape>({
    id,
    type: "canvas-ai-document",
    x: at.x - DOCUMENT_NODE_DEFAULT_W / 2,
    y: at.y - DOCUMENT_NODE_DEFAULT_H / 2,
    props: {
      w: DOCUMENT_NODE_DEFAULT_W,
      h: DOCUMENT_NODE_DEFAULT_H,
      title: "",
      markdown: "",
      status: "done",
      userPrompt: "",
      sourceIds: [],
      sourceSnapshots: [],
      sourcesUsed: [],
      errorMessage: "",
    },
  });
  editor.select(id);
}
