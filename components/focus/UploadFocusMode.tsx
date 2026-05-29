"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, type TLShapeId } from "tldraw";
import { X, FileText, FileType, MonitorPlay, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownUrlTransform } from "@/lib/markdown/urlTransform";
import type { UploadNodeShape } from "@/components/canvas/shapes/UploadNode";

type Props = {
  shapeId: TLShapeId;
  onClose: () => void;
};

/**
 * Read-only full-text view of an upload (PDF or markdown). Lets the user
 * actually read the contents instead of squinting at the card preview. No
 * editing — what's stored as extracted text is what we render.
 */
export function UploadFocusMode({ shapeId, onClose }: Props) {
  const editor = useEditor();
  const shape = editor.getShape(shapeId) as UploadNodeShape | undefined;
  const [mounted, setMounted] = useState(false);

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
      <div className="canvas-ai-focus-paper border-b border-hairline bg-elevated">
        <div className="mx-auto flex w-full max-w-[760px] items-center gap-3 px-6 py-3">
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

      {shape.props.pdfData ? (
        // Scanned PDF: no transcript to show, so render the PDF itself so the
        // user can read it. The AI reads these bytes directly as a vision
        // source at research/chat time.
        <div className="flex-1 overflow-hidden bg-app">
          <iframe
            src={`data:application/pdf;base64,${shape.props.pdfData}`}
            title={shape.props.filename}
            className="h-full w-full border-0"
          />
        </div>
      ) : (
        <div className="canvas-ai-focus-paper flex-1 overflow-auto bg-app">
          <div className="mx-auto w-full max-w-[760px] px-6 py-8">
            {shape.props.kind === "markdown" ? (
              <div className="canvas-ai-doc-preview text-[14px] leading-relaxed text-text-primary">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                  urlTransform={markdownUrlTransform}
                >
                  {shape.props.fullText}
                </ReactMarkdown>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-text-primary">
                {shape.props.fullText || "No extracted text."}
              </pre>
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
