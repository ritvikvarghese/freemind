"use client";

import { useEditor, useValue, type TLShape } from "tldraw";

/**
 * Per-shape selection ring rendered ON the canvas (world space). tldraw's
 * default selection chrome collapses multi-select into a single bounding box
 * — that hides WHICH shapes are in the selection. This overlay draws an
 * always-visible accent ring around each of our source/document shapes when
 * it's selected, so the user can always see what's in their selection.
 */

const OUR_TYPES = new Set([
  "canvas-ai-text",
  "canvas-ai-upload",
  "canvas-ai-image", // dropped/pasted image card
  "canvas-ai-document",
  "canvas-ai-link", // pasted-link card
  "text", // tldraw native text shape (created by the T toolbar button)
  "note", // tldraw native sticky note (created by the toolbar button) — usable as a source
  "bookmark", // tldraw native bookmark shape (pasted link) — usable as a source
]);

export function SelectionRings() {
  const editor = useEditor();

  const rings = useValue(
    "canvas-ai-selection-rings",
    () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length === 0) return [];
      const out: {
        key: string;
        x: number;
        y: number;
        w: number;
        h: number;
      }[] = [];
      for (const id of ids) {
        const shape = editor.getShape(id) as TLShape | undefined;
        if (!shape || !OUR_TYPES.has(shape.type)) continue;
        const bounds = editor.getShapePageBounds(id);
        if (!bounds) continue;
        out.push({
          key: id,
          x: bounds.x,
          y: bounds.y,
          w: bounds.w,
          h: bounds.h,
        });
      }
      return out;
    },
    [editor],
  );

  if (rings.length === 0) return null;

  const PAD = 100_000;
  return (
    <svg
      style={{
        position: "absolute",
        left: -PAD,
        top: -PAD,
        width: 2 * PAD,
        height: 2 * PAD,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <g transform={`translate(${PAD}, ${PAD})`}>
        {rings.map((r) => (
          <rect
            key={r.key}
            x={r.x - 2}
            y={r.y - 2}
            width={r.w + 4}
            height={r.h + 4}
            rx={12}
            ry={12}
            fill="none"
            stroke="var(--color-accent)"
            strokeOpacity={0.85}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ))}
      </g>
    </svg>
  );
}
