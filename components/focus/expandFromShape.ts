"use client";

import type { Editor, TLShapeId } from "tldraw";

/**
 * Build the initial CSS transform for the focus-open animation: it maps the
 * full viewport down onto the shape's on-screen rectangle (origin top-left), so
 * the focus panel can animate from there to identity and appear to GROW OUT OF
 * the card's place on the canvas (like Spatial). Returns a fallback centred
 * scale if the shape's bounds can't be resolved.
 *
 * Call once (cache in a ref) before first paint so the panel's first frame is
 * already sitting on the card.
 */
export function expandFromShapeTransform(
  editor: Editor,
  shapeId: TLShapeId,
): string {
  try {
    const b = editor.getShapePageBounds(shapeId);
    if (!b) return "scale(0.94)";
    const zoom = editor.getZoomLevel();
    const tl = editor.pageToScreen({ x: b.x, y: b.y });
    const w = b.width * zoom;
    const h = b.height * zoom;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!w || !h || !vw || !vh) return "scale(0.94)";
    const sx = w / vw;
    const sy = h / vh;
    return `translate(${Math.round(tl.x)}px, ${Math.round(tl.y)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
  } catch {
    return "scale(0.94)";
  }
}
