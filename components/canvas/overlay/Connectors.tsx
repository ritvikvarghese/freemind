"use client";

import { useEditor, useValue, type TLShapeId } from "tldraw";
import { useEffect, useState } from "react";
import { useBoardKey } from "../BoardContext";
import {
  ensureConnectorsLoaded,
  removeConnector,
  useConnectors,
  useDrag,
} from "@/lib/storage/connectors";
import { edgePointToward, edgeToEdge } from "@/lib/canvas/lineEndpoints";

/**
 * Manual, visual-only connectors. Lives in the `Background` slot (below shapes)
 * alongside ProvenanceLines so the lines tuck under nodes in the same warm-grey
 * style. The slot is SCREEN space, so we apply the camera transform ourselves —
 * see ProvenanceLines for the same pattern. Hover a line to reveal an x at its
 * midpoint that deletes it.
 */
export function Connectors() {
  const editor = useEditor();
  const boardKey = useBoardKey();
  const connectors = useConnectors(boardKey);
  const drag = useDrag();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    if (boardKey) void ensureConnectorsLoaded(boardKey);
  }, [boardKey]);

  const camera = useValue("canvas-ai-camera", () => editor.getCamera(), [
    editor,
  ]);

  // Recomputes whenever a node moves, the camera changes, or the set changes.
  const lines = useValue(
    "canvas-ai-connector-lines",
    () => {
      const out: {
        id: string;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        mx: number;
        my: number;
      }[] = [];
      for (const c of connectors) {
        const a = editor.getShapePageBounds(c.fromId as TLShapeId);
        const b = editor.getShapePageBounds(c.toId as TLShapeId);
        if (!a || !b) continue; // orphaned endpoint — skip silently
        // Clip to each shape's edge so the line never crosses a shape (matters
        // for transparent text shapes; cards look identical since the line was
        // hidden under them anyway).
        const { x1, y1, x2, y2 } = edgeToEdge(a, b);
        out.push({ id: c.id, x1, y1, x2, y2, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 });
      }
      return out;
    },
    [editor, connectors],
  );

  const dragLine = useValue(
    "canvas-ai-connector-drag",
    () => {
      if (!drag) return null;
      const a = editor.getShapePageBounds(drag.fromId as TLShapeId);
      if (!a) return null;
      // Leave from the source shape's edge toward the live pointer.
      const p = edgePointToward(a, drag.toX, drag.toY);
      return { x1: p.x, y1: p.y, x2: drag.toX, y2: drag.toY };
    },
    [editor, drag],
  );

  if (lines.length === 0 && !dragLine) return null;

  const z = camera.z;

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
      <g transform={`translate(${camera.x * z} ${camera.y * z}) scale(${z})`}>
        {lines.map((l) => (
          <g
            key={l.id}
            onPointerEnter={() => setHoveredId(l.id)}
            onPointerLeave={() => setHoveredId((id) => (id === l.id ? null : id))}
          >
            {/* invisible fat hit area — constant 16px regardless of zoom */}
            <line
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="transparent"
              strokeWidth={16}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "stroke" }}
            />
            <line
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="var(--color-provenance)"
              strokeWidth={1}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
            {hoveredId === l.id && boardKey ? (
              <g transform={`translate(${l.mx} ${l.my}) scale(${1 / z})`}>
                <circle
                  r={9}
                  fill="var(--color-elevated)"
                  stroke="var(--color-hairline)"
                  strokeWidth={1}
                  style={{ pointerEvents: "all", cursor: "pointer" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    removeConnector(boardKey, l.id);
                    setHoveredId(null);
                  }}
                />
                <line
                  x1={-3.2}
                  y1={-3.2}
                  x2={3.2}
                  y2={3.2}
                  stroke="var(--color-text-secondary)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
                <line
                  x1={3.2}
                  y1={-3.2}
                  x2={-3.2}
                  y2={3.2}
                  stroke="var(--color-text-secondary)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              </g>
            ) : null}
          </g>
        ))}
        {dragLine ? (
          <line
            x1={dragLine.x1}
            y1={dragLine.y1}
            x2={dragLine.x2}
            y2={dragLine.y2}
            stroke="var(--color-provenance)"
            strokeWidth={1}
            strokeLinecap="round"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ) : null}
      </g>
    </svg>
  );
}
