"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, type TLShapeId } from "tldraw";
import {
  X,
  FileText,
  FileType,
  MonitorPlay,
  ExternalLink,
  ScanText,
  Maximize2,
  Minimize2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownUrlTransform } from "@/lib/markdown/urlTransform";
import type { UploadNodeShape } from "@/components/canvas/shapes/UploadNode";

type Props = {
  shapeId: TLShapeId;
  onClose: () => void;
};

/**
 * Two-pane focus view of an upload (mirrors ImageFocusMode). Left: the file
 * rendered as authored — the PDF itself (images + formatting) or rendered
 * markdown. Right: the read-only extracted text the AI uses as context.
 * Uploads stay read-only, so keeping `isReadonly: true` here is safe (unlike
 * ImageFocusMode, which edits and must avoid it). YouTube uploads (legacy)
 * have no "raw doc" — they show their transcript single-pane.
 */
export function UploadFocusMode({ shapeId, onClose }: Props) {
  const editor = useEditor();
  const shape = editor.getShape(shapeId) as UploadNodeShape | undefined;
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    editor.updateInstanceState({ isReadonly: true });
    return () => {
      editor.updateInstanceState({ isReadonly: false });
    };
  }, [editor]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

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
  }, [editor, shapeId]);

  const markdownComponents = useMemo(
    () => ({
      a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a {...props} target="_blank" rel="noreferrer" />
      ),
    }),
    [],
  );

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
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(4px)",
        transition:
          "opacity 200ms var(--ease-out-fast), transform 200ms var(--ease-out-fast)",
      }}
    >
      <div className="border-b border-hairline bg-elevated">
        <div className="mx-auto flex w-full max-w-[1100px] items-center gap-3 px-6 py-3">
          <Icon
            className="h-4 w-4 shrink-0 text-text-secondary"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium tracking-tight text-text-primary">
              {shape.props.filename}
            </div>
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
            onClick={onClose}
            className="ml-1 grid h-7 w-7 place-items-center rounded-button text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {shape.props.kind === "youtube" ? (
        // Legacy YouTube upload: no source document, just the transcript.
        <div className="flex-1 overflow-auto bg-app">
          <div className="mx-auto w-full max-w-[760px] px-6 py-8">
            <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-text-primary">
              {shape.props.fullText || "No transcript."}
            </pre>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden bg-app">
          <div
            className={`mx-auto grid h-full w-full gap-6 px-6 py-8 ${
              expanded
                ? "max-w-[1600px] grid-cols-1"
                : "max-w-[1100px] grid-cols-2"
            }`}
          >
            {/* Left: the document as authored */}
            <div className="flex flex-col overflow-hidden">
              <div className="mb-2 flex items-center gap-2 text-[11px] text-text-tertiary">
                <FileText className="h-3 w-3" aria-hidden />
                Document
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  title={expanded ? "Exit full screen" : "Full screen"}
                  aria-label={expanded ? "Exit full screen" : "Full screen"}
                  className="ml-auto grid h-6 w-6 place-items-center rounded-button text-text-tertiary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
                >
                  {expanded ? (
                    <Minimize2 className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
              </div>
              <div className="flex-1 overflow-auto rounded-node border border-hairline bg-elevated">
                {shape.props.kind === "pdf" ? (
                  shape.props.pdfData ? (
                    <iframe
                      ref={iframeRef}
                      title={shape.props.filename}
                      className="h-full w-full border-0"
                    />
                  ) : (
                    <div className="px-5 py-4 text-[12px] leading-relaxed text-text-tertiary">
                      The raw PDF wasn&apos;t stored for this upload. Re-upload
                      it to view the original with images and formatting. The
                      extracted text is on the right.
                    </div>
                  )
                ) : (
                  <div className="canvas-ai-doc-preview px-5 py-4 text-[14px] leading-relaxed text-text-primary">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                      urlTransform={markdownUrlTransform}
                    >
                      {shape.props.fullText}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>

            {/* Right: read-only extracted text (what the AI reads) */}
            {!expanded && (
              <div className="flex flex-col overflow-hidden">
                <div className="mb-2 flex items-center gap-2 text-[11px] text-text-tertiary">
                  <ScanText className="h-3 w-3" aria-hidden />
                  Extracted text
                </div>
                <div className="flex-1 overflow-auto whitespace-pre-wrap break-words rounded-node border border-hairline bg-elevated p-4 text-[13.5px] leading-relaxed text-text-secondary">
                  {shape.props.fullText || "No extracted text."}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document === "undefined" || !document.body) {
    return overlay;
  }
  return createPortal(overlay, document.body);
}
