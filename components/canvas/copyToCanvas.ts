import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import type { TextNodeShape } from "./shapes/TextNode";

// A "copy to canvas" clip is a canvas-ai-text node: same 13px body text as the
// doc / image cards (so clips read at the card size, not tldraw's larger native
// text), and a real node — connectable, editable, and usable as an AI source.
const CLIP_W = 280;
// Breathing room between a clip and the source / notes node / other clips.
const GAP = 40;

type Box = { x: number; y: number; w: number; h: number };

/**
 * Drop `text` onto the canvas as a text node, placed in the first collision-free
 * slot of an expanding frame AROUND `sourceId` (so repeated clips fan out
 * cleanly around the source document with spacing, never stacking on top of each
 * other or on the existing shapes / notes node). Returns the new shape id, or
 * null when there's nothing to place.
 */
export function copyTextToCanvas(
  editor: Editor,
  sourceId: TLShapeId,
  text: string,
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // The node auto-fits its height after mount; this is the initial estimate used
  // only to pick a non-overlapping slot.
  const h = estimateClipHeight(trimmed, CLIP_W);
  const at = findSlotAroundSource(editor, sourceId, CLIP_W, h);

  const id = createShapeId();
  editor.markHistoryStoppingPoint("copy to canvas");
  editor.createShape<TextNodeShape>({
    id,
    type: "canvas-ai-text",
    x: at.x,
    y: at.y,
    props: { w: CLIP_W, h, text: trimmed },
  });
  return id;
}

// Find a free top-left for a w x h box around the source. Walks expanding
// rectangular frames (right column, bottom row, left column, top row per ring)
// and returns the first slot that clears every shape on the page by GAP.
// Exported so the reader-notes node uses the same spacing logic (so a clip and
// the notes node never land on top of each other, whichever is created first).
export function findSlotAroundSource(
  editor: Editor,
  sourceId: TLShapeId,
  w: number,
  h: number,
): { x: number; y: number } {
  const src = editor.getShapePageBounds(sourceId);
  if (!src) {
    const c = editor.getViewportPageBounds().center;
    return { x: c.x - w / 2, y: c.y - h / 2 };
  }

  const obstacles = editor
    .getCurrentPageShapes()
    .map((s) => editor.getShapePageBounds(s.id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
    .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));

  for (const slot of candidateSlots(src, w, h)) {
    const box = { x: slot.x, y: slot.y, w, h };
    if (!obstacles.some((o) => overlaps(box, o, GAP * 0.5))) return slot;
  }
  // Exhausted the frames (very crowded board): land below-right of the source.
  return { x: src.maxX + GAP, y: src.maxY + GAP };
}

function candidateSlots(
  src: { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number },
  w: number,
  h: number,
): { x: number; y: number }[] {
  const slots: { x: number; y: number }[] = [];
  const stepX = w + GAP;
  const stepY = h + GAP;
  // Enough cells per lane to span the source plus a little overhang.
  const down = Math.max(1, Math.ceil(src.h / stepY)) + 2;
  const across = Math.max(1, Math.ceil(src.w / stepX)) + 2;

  for (let ring = 1; ring <= 6; ring++) {
    const rightX = src.maxX + GAP + (ring - 1) * stepX;
    const leftX = src.minX - GAP - w - (ring - 1) * stepX;
    const topY = src.minY - GAP - h - (ring - 1) * stepY;
    const botY = src.maxY + GAP + (ring - 1) * stepY;

    // Right column, aligned to the source top and running down.
    for (let i = 0; i < down; i++) slots.push({ x: rightX, y: src.minY + i * stepY });
    // Bottom row, left to right.
    for (let i = 0; i < across; i++) slots.push({ x: src.minX + i * stepX, y: botY });
    // Left column, top-aligned, running down.
    for (let i = 0; i < down; i++) slots.push({ x: leftX, y: src.minY + i * stepY });
    // Top row, left to right.
    for (let i = 0; i < across; i++) slots.push({ x: src.minX + i * stepX, y: topY });
  }
  return slots;
}

function overlaps(a: Box, b: Box, pad: number): boolean {
  return (
    a.x < b.x + b.w + pad &&
    b.x < a.x + a.w + pad &&
    a.y < b.y + b.h + pad &&
    b.y < a.y + a.h + pad
  );
}

// Rough initial height for picking a non-overlapping slot; the text node
// measures and auto-fits its real height after it mounts. Matches the node's
// 13px/1.6 body text and 32px vertical padding.
function estimateClipHeight(text: string, width: number): number {
  const charsPerLine = Math.max(8, Math.floor((width - 32) / 6.5));
  let lines = 0;
  for (const para of text.split("\n")) {
    lines += Math.max(1, Math.ceil(para.length / charsPerLine));
  }
  return Math.min(1200, Math.max(56, lines * 21 + 32));
}
