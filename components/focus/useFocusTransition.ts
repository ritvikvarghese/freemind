"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useEditor, type TLShapeId } from "tldraw";
import { expandFromShapeTransform } from "./expandFromShape";

// Slow, smooth grow out of the card on open; the same path reversed (shrink
// back into the card) on close. Tuned slow on purpose.
const OPEN_TRANSITION =
  "opacity 530ms cubic-bezier(0.22, 1, 0.36, 1), transform 875ms cubic-bezier(0.16, 1, 0.3, 1)";
const CLOSE_TRANSITION =
  "opacity 700ms cubic-bezier(0.16, 1, 0.3, 1), transform 740ms cubic-bezier(0.16, 1, 0.3, 1)";
const CLOSE_MS = 740;

/**
 * Drives the focus overlay's open/close animation. The panel grows out of the
 * shape's on-canvas rect on open and shrinks back into it on close. `style` is
 * applied to the overlay root; `requestClose` plays the exit animation and then
 * calls `onClose` (which unmounts) so the reverse animation is actually seen.
 */
export function useFocusTransition(shapeId: TLShapeId, onClose: () => void) {
  const editor = useEditor();
  const [expandFrom] = useState(() => expandFromShapeTransform(editor, shapeId));
  const [phase, setPhase] = useState<"enter" | "open" | "exit">("enter");
  const closing = useRef(false);

  useEffect(() => {
    if (phase !== "enter") return;
    const id = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(id);
  }, [phase]);

  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setPhase("exit");
    window.setTimeout(onClose, CLOSE_MS);
  }, [onClose]);

  const open = phase === "open";
  const style: CSSProperties = {
    opacity: open ? 1 : 0,
    transformOrigin: "0 0",
    transform: open ? "none" : expandFrom,
    transition: open ? OPEN_TRANSITION : CLOSE_TRANSITION,
  };

  return { style, requestClose };
}
