"use client";

import { useEditor, createShapeId, type Editor } from "tldraw";
import {
  Type,
  FileText,
  Upload,
  Image as ImageIcon,
  MonitorPlay,
  Loader2,
  CornerDownLeft,
} from "lucide-react";
import { useRef, useState } from "react";
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

  return (
    <div className="pointer-events-auto fixed left-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1 rounded-panel bg-elevated border border-hairline p-1 shadow-[var(--shadow-panel)]">
      <ToolbarButton
        label="Add text (click canvas to place)"
        onClick={() => editor.setCurrentTool("text")}
      >
        <Type className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="New document"
        onClick={() => addBlankDocAtViewportCenter(editor)}
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
        label="Upload PDF or markdown"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        label="Add YouTube transcript"
        active={ytOpen}
        onClick={() => setYtOpen((v) => !v)}
      >
        <MonitorPlay className="h-4 w-4" aria-hidden />
      </ToolbarButton>
      {ytOpen ? (
        <YouTubeInput editor={editor} onClose={() => setYtOpen(false)} />
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.md,.markdown,application/pdf,text/markdown,text/plain"
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

function addBlankDocAtViewportCenter(editor: Editor) {
  const viewport = editor.getViewportPageBounds();
  const id = createShapeId();
  editor.createShape<DocumentNodeShape>({
    id,
    type: "canvas-ai-document",
    x: viewport.center.x - DOCUMENT_NODE_DEFAULT_W / 2,
    y: viewport.center.y - DOCUMENT_NODE_DEFAULT_H / 2,
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
