"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { useFocusTransition } from "./useFocusTransition";
import {
  X,
  Loader2,
  ScanText,
  AlertTriangle,
  Maximize2,
  Minimize2,
  Image as ImageIcon,
} from "lucide-react";
import type { ImageNodeShape } from "@/components/canvas/shapes/ImageNode";
import { readImageText } from "@/components/canvas/ingestImages";

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
  const [name, setName] = useState(shape?.props.filename ?? "");
  const [expanded, setExpanded] = useState(false);
  // Open/close animation: grow out of / shrink back into the card's rect.
  const { style: focusStyle, requestClose } = useFocusTransition(
    shapeId,
    onClose,
  );
  const latest = useRef(ocrText);
  const latestName = useRef(name);
  const flushTimer = useRef<number | null>(null);

  useEffect(() => {
    latest.current = ocrText;
  }, [ocrText]);
  useEffect(() => {
    latestName.current = name;
  }, [name]);

  const flushName = useCallback(() => {
    const current = editor.getShape(shapeId) as ImageNodeShape | undefined;
    if (!current) return;
    const next = latestName.current.trim();
    if (!next || current.props.filename === next) return;
    editor.updateShape<ImageNodeShape>({
      id: shapeId,
      type: "canvas-ai-image",
      props: { filename: next },
    });
  }, [editor, shapeId]);

  // Pull in OCR text that lands after mount (the async OCR pass completing).
  const status = shape?.props.status;
  useEffect(() => {
    if (status === "done" && shape && shape.props.ocrText !== latest.current) {
      setOcrText(shape.props.ocrText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleRead = useCallback(() => {
    void readImageText(editor, shapeId);
  }, [editor, shapeId]);

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
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        flush();
        flushName();
        requestClose();
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [requestClose, flush, flushName]);

  useEffect(() => {
    if (!shape) onClose();
  }, [shape, onClose]);

  // Flush any pending edit on unmount.
  useEffect(
    () => () => {
      flush();
      flushName();
    },
    [flush, flushName],
  );

  if (!shape) return null;

  // Animated art (GIF / animated WebP) has no extracted text: show a single
  // full pane, no text column and no full-screen toggle (already one pane).
  const isAnimated =
    shape.props.mediaType === "image/gif" ||
    shape.props.mediaType === "image/webp";
  const formatLabel =
    shape.props.mediaType === "image/gif"
      ? "GIF"
      : shape.props.mediaType === "image/webp"
        ? "WebP"
        : "Image";
  const single = isAnimated || expanded;

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
      style={focusStyle}
    >
      <div className="border-b border-hairline bg-elevated">
        <div className="mx-auto flex w-full max-w-[1100px] items-center gap-3 px-6 py-3">
          <ScanText className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
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
              placeholder="Untitled image"
              spellCheck={false}
              aria-label="Image name"
              title="Rename this image"
              className="w-full min-w-0 truncate bg-transparent text-[15px] font-medium tracking-tight text-text-primary outline-none placeholder:text-text-tertiary"
            />
            <div className="text-[11px] text-text-tertiary">
              {formatLabel} · {shape.props.naturalW}×{shape.props.naturalH}
            </div>
          </div>
          <button
            type="button"
            title="Close (Esc)"
            aria-label="Close focus mode"
            onClick={() => {
              flush();
              flushName();
              requestClose();
            }}
            className="ml-1 grid h-7 w-7 place-items-center rounded-button text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-app">
        <div
          className={`mx-auto grid h-full w-full gap-6 px-6 py-8 ${
            single
              ? "max-w-[1600px] grid-cols-1"
              : "max-w-[1100px] grid-cols-2"
          }`}
        >
          {/* Left: the image as uploaded */}
          <div className="flex flex-col overflow-hidden">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-text-tertiary">
              <ImageIcon className="h-3 w-3" aria-hidden />
              {formatLabel}
              {!isAnimated && (
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
              )}
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto rounded-node border border-hairline bg-elevated p-3">
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
          </div>

          {/* Right: editable OCR text (hidden for animated art and full screen) */}
          {!isAnimated && !expanded && (
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
                  Couldn’t read text — try again or type it manually.
                </>
              ) : (
                <>
                  <ScanText className="h-3 w-3" aria-hidden />
                  Extracted text (editable)
                </>
              )}
              {shape.props.status !== "ocr" ? (
                <button
                  type="button"
                  onClick={handleRead}
                  title="Reads text from the image with Claude — uses tokens"
                  className="ml-auto flex items-center gap-1.5 rounded-button border border-hairline px-2 py-1 text-[11px] text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
                >
                  <ScanText className="h-3 w-3" aria-hidden />
                  {shape.props.ocrText ? "Read again" : "Read image"}
                  <span className="text-text-tertiary">· uses tokens</span>
                </button>
              ) : null}
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
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined" || !document.body) return overlay;
  return createPortal(overlay, document.body);
}
