"use client";

import { useEditor, useValue } from "tldraw";
import { getProvenanceEdges } from "@/lib/canvas/provenance";
import { edgeToEdge } from "@/lib/canvas/lineEndpoints";

/**
 * Lives under tldraw's `Background` slot (below shapes). The Background slot
 * is rendered in SCREEN space, not transformed world space, so we apply the
 * editor camera transform ourselves before drawing page-coordinate endpoints.
 */
export function ProvenanceLines() {
  const editor = useEditor();
  const camera = useValue("canvas-ai-camera", () => editor.getCamera(), [
    editor,
  ]);

  const edges = useValue(
    "canvas-ai-provenance-edges",
    () => {
      const selectedIds = new Set(editor.getSelectedShapeIds());
      if (selectedIds.size === 0) return [];
      const out: {
        key: string;
        sx: number;
        sy: number;
        dx: number;
        dy: number;
      }[] = [];
      // Edges are undirected for highlighting: draw any provenance link where
      // EITHER end is selected, so selecting a source reveals the docs/notes
      // built from it just as selecting a doc reveals its sources.
      for (const e of getProvenanceEdges(editor)) {
        if (!selectedIds.has(e.from) && !selectedIds.has(e.to)) continue;
        const docBounds = editor.getShapePageBounds(e.from);
        const srcBounds = editor.getShapePageBounds(e.to);
        if (!docBounds || !srcBounds) continue;
        // Clip to edges so a line never crosses a shape (transparent text
        // shapes otherwise show the line piercing to their center).
        const { x1, y1, x2, y2 } = edgeToEdge(srcBounds, docBounds);
        out.push({ key: `${e.from}->${e.to}`, sx: x1, sy: y1, dx: x2, dy: y2 });
      }
      return out;
    },
    [editor],
  );

  if (edges.length === 0) return null;

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <g
        transform={`translate(${camera.x * camera.z} ${camera.y * camera.z}) scale(${camera.z})`}
      >
        {edges.map((e) => (
          <line
            key={e.key}
            x1={e.sx}
            y1={e.sy}
            x2={e.dx}
            y2={e.dy}
            stroke="var(--color-provenance)"
            strokeWidth={1}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ))}
      </g>
    </svg>
  );
}
