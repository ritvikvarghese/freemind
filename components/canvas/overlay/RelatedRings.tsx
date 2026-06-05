"use client";

import { useEffect } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { useBoardKey } from "../BoardContext";
import { ensureConnectorsLoaded, useConnectors } from "@/lib/storage/connectors";
import { getProvenanceEdges } from "@/lib/canvas/provenance";

/**
 * When a node is selected, ring the nodes CONNECTED to it so the related set
 * lights up at a glance — regardless of which end stored the link. Covers both
 * provenance edges (source <-> document/notes, undirected) and manual
 * connectors. Drawn in the same `OnTheCanvas` (world-space) slot as
 * SelectionRings, but in a softer dashed style to read as "related, not
 * selected." The selected nodes themselves keep their solid accent ring.
 */
export function RelatedRings() {
  const editor = useEditor();
  const boardKey = useBoardKey();
  const connectors = useConnectors(boardKey);

  useEffect(() => {
    if (boardKey) void ensureConnectorsLoaded(boardKey);
  }, [boardKey]);

  const rings = useValue(
    "canvas-ai-related-rings",
    () => {
      const selected = new Set(editor.getSelectedShapeIds());
      if (selected.size === 0) return [];

      const neighbors = new Set<TLShapeId>();
      for (const e of getProvenanceEdges(editor)) {
        if (selected.has(e.from)) neighbors.add(e.to);
        if (selected.has(e.to)) neighbors.add(e.from);
      }
      for (const c of connectors) {
        const from = c.fromId as TLShapeId;
        const to = c.toId as TLShapeId;
        if (selected.has(from)) neighbors.add(to);
        if (selected.has(to)) neighbors.add(from);
      }

      const out: { key: string; x: number; y: number; w: number; h: number }[] =
        [];
      for (const id of neighbors) {
        if (selected.has(id)) continue; // already has the solid selection ring
        const b = editor.getShapePageBounds(id);
        if (!b) continue;
        out.push({ key: id, x: b.x, y: b.y, w: b.w, h: b.h });
      }
      return out;
    },
    [editor, connectors],
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
            strokeOpacity={0.5}
            strokeWidth={2}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ))}
      </g>
    </svg>
  );
}
