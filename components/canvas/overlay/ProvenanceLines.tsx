"use client";

import { useEditor, useValue, type TLShapeId } from "tldraw";
import type { DocumentNodeShape } from "../shapes/DocumentNode";

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
      for (const shape of editor.getCurrentPageShapes()) {
        if (shape.type !== "canvas-ai-document") continue;
        if (!selectedIds.has(shape.id)) continue;
        const doc = shape as DocumentNodeShape;
        const docBounds = editor.getShapePageBounds(doc.id);
        if (!docBounds) continue;
        const dcx = docBounds.x + docBounds.w / 2;
        const dcy = docBounds.y + docBounds.h / 2;
        for (const sourceId of doc.props.sourceIds) {
          const srcBounds = editor.getShapePageBounds(sourceId as TLShapeId);
          if (!srcBounds) continue;
          const scx = srcBounds.x + srcBounds.w / 2;
          const scy = srcBounds.y + srcBounds.h / 2;
          out.push({
            key: `${doc.id}->${sourceId}`,
            sx: scx,
            sy: scy,
            dx: dcx,
            dy: dcy,
          });
        }
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
