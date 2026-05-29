"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { X, Loader2, ScanText, AlertTriangle } from "lucide-react";
import type { ImageNodeShape } from "@/components/canvas/shapes/ImageNode";

type Props = {
  shapeId: TLShapeId;
  onClose: () => void;
};

const AUTOSAVE_MS = 250;

/**
 * Focus view for an image source: the picture on the left, its editable OCR
 * transcription on the right. The transcription is what feeds research/chat as
 * text (alongside the image itself for vision), so letting the user correct it
 * matters. We do NOT set `isReadonly` — that silently kills shape writes
 * (tldraw v5) and the overlay already shields the canvas.
 */
export function ImageFocusMode({ shapeId, onClose }: Props) {
  const editor = useEditor();
  const shape = useValue(
    `image-focus-${shapeId}`,
    () => editor.getShape(shapeId) as ImageNodeShape | undefined,
    [editor, shapeId],
  );

  const [ocrText, setOcrText] = useState(shape?.props.ocrText ?? "");
  const [mounted, setMounted] = useState(false);
  const latest = useRef(ocrText);
  const flushTimer = useRef<number | null>(null);

  useEffect(() => {
    latest.current = ocrText;
  }, [ocrText]);

  // Pull in OCR text that lands after mount (the async OCR pass completing).
  const status = shape?.props.status;
  useEffect(() => {
    if (status === "done" && shape && shape.props.ocrText !== latest.current) {
      setOcrText(shape.props.ocrText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const flush = useCallback(() => {
    const current = editor.getShape(shapeId) as ImageNodeShape | undefined;
    if (!current) return;
    if (current.props.ocrText === latest.current) return;
    editor.updateShape<ImageNodeShape>({
      id: shapeId,
      type: "canvas-ai-image",
      props: { ocrText: latest.current },
    });
  }, [editor, shapeId]);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      flush();
    }, AUTOSAVE_MS);
  }, [flush]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        flush();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose, flush]);

  useEffect(() => {
    if (!shape) onClose();
  }, [shape, onClose]);

  // Flush any pending edit on unmount.
  useEffect(() => () => flush(), [flush]);

  if (!shape) return null;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image focus mode"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
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
          <ScanText className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium tracking-tight text-text-primary">
              {shape.props.filename}
            </div>
            <div className="text-[11px] text-text-tertiary">
              Image · {shape.props.naturalW}×{shape.props.naturalH}
            </div>
          </div>
          <button
            type="button"
            title="Close (Esc)"
            aria-label="Close focus mode"
            onClick={() => {
              flush();
              onClose();
            }}
            className="ml-1 grid h-7 w-7 place-items-center rounded-button text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-app">
        <div className="mx-auto grid h-full w-full max-w-[1100px] grid-cols-2 gap-6 px-6 py-8">
          <div className="flex items-center justify-center overflow-auto rounded-node border border-hairline bg-elevated p-3">
            {shape.props.dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shape.props.dataUrl}
                alt={shape.props.filename}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-text-tertiary text-[12px]">No image</span>
            )}
          </div>

          <div className="flex flex-col overflow-hidden">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-text-tertiary">
              {shape.props.status === "ocr" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  Reading text…
                </>
              ) : shape.props.status === "error" ? (
                <>
                  <AlertTriangle
                    className="h-3 w-3 text-[var(--color-error)]"
                    aria-hidden
                  />
                  OCR failed — type the text manually if needed.
                </>
              ) : (
                <>
                  <ScanText className="h-3 w-3" aria-hidden />
                  Extracted text (editable)
                </>
              )}
            </div>
            <textarea
              value={ocrText}
              onChange={(e) => {
                setOcrText(e.currentTarget.value);
                scheduleFlush();
              }}
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
              placeholder="No text found in this image. You can type a description or caption here — it becomes context for the AI."
              spellCheck
              className="flex-1 resize-none rounded-node border border-hairline bg-elevated p-4 text-[14px] leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary focus:border-hairline-hover"
            />
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined" || !document.body) return overlay;
  return createPortal(overlay, document.body);
}
