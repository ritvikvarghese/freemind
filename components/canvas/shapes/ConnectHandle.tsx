"use client";

import { useEditor, useValue, type TLShape, type TLShapeId } from "tldraw";
import { useBoardKey } from "../BoardContext";
import { addConnector, setDrag, useDrag } from "@/lib/storage/connectors";

const CONNECTABLE = new Set([
  "canvas-ai-text",
  "canvas-ai-upload",
  "canvas-ai-image",
  "canvas-ai-document",
  "canvas-ai-notes",
  "text",
  "note",
]);

/**
 * Grab dots on a node's left and right edges. Drag one onto another node to
 * draw a visual connector. Rendered as opt-in interactive children of the shape
 * body (the body itself is pointer-events:none, see gotcha #4) — they sit just
 * inside the edge so tldraw keeps the shape "hovered" while you reach for them.
 */
export function ConnectHandle({ shapeId }: { shapeId: TLShapeId }) {
  const editor = useEditor();
  const boardKey = useBoardKey();
  const drag = useDrag();
  const visible = useValue(
    "connect-handle-visible",
    () => editor.getHoveredShapeId() === shapeId,
    [editor, shapeId],
  );
  const isDragSource = drag?.fromId === shapeId;

  if (!visible && !isDragSource) return null;

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (!boardKey) return;

    const toPage = (clientX: number, clientY: number) =>
      editor.screenToPage({ x: clientX, y: clientY });

    const start = toPage(e.clientX, e.clientY);
    setDrag({ fromId: shapeId, toX: start.x, toY: start.y });

    const onMove = (ev: PointerEvent) => {
      const p = toPage(ev.clientX, ev.clientY);
      setDrag({ fromId: shapeId, toX: p.x, toY: p.y });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      const p = toPage(ev.clientX, ev.clientY);
      const target = editor.getShapeAtPoint(p, {
        hitInside: true,
        filter: (s: TLShape) => CONNECTABLE.has(s.type),
      });
      if (target && target.id !== shapeId) {
        addConnector(boardKey, shapeId, target.id);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const dot = (side: "left" | "right") => (
    <div
      title="Drag to another node to connect"
      onPointerDown={startDrag}
      style={{
        position: "absolute",
        top: "50%",
        [side]: 3,
        transform: "translateY(-50%)",
        width: 13,
        height: 13,
        borderRadius: "50%",
        background: "var(--color-accent)",
        border: "2px solid var(--color-elevated)",
        cursor: "crosshair",
        pointerEvents: "all",
        opacity: isDragSource ? 1 : 0.85,
        zIndex: 2,
      }}
    />
  );

  return (
    <>
      {dot("left")}
      {dot("right")}
    </>
  );
}
