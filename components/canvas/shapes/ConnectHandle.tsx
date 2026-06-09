"use client";

import {
  useEditor,
  useValue,
  type Editor,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import { useBoardKey } from "../BoardContext";
import { addConnector, setDrag, useDrag } from "@/lib/storage/connectors";

const CONNECTABLE = new Set([
  "canvas-ai-text",
  "canvas-ai-upload",
  "canvas-ai-image",
  "canvas-ai-document",
  "canvas-ai-link",
  "canvas-ai-notes",
  "text",
  "note",
]);

/** Title shown on a connect dot. */
export const CONNECT_DOT_TITLE = "Drag to another node to connect";

/** Shared look of a connect dot (the draggable port). Callers layer on the
 *  positioning (absolute inside a card vs fixed in the overlay) and z-index. */
export const CONNECT_DOT_STYLE: React.CSSProperties = {
  width: 13,
  height: 13,
  borderRadius: "50%",
  background: "var(--color-accent)",
  border: "2px solid var(--color-elevated)",
  cursor: "crosshair",
  pointerEvents: "all",
};

/**
 * Begin a connector drag from `fromId` at a screen (client) point. Tracks the
 * pointer until release, then connects to whatever connectable shape it lands
 * on. Shared by the in-shape ConnectHandle (card nodes) and the ConnectDots
 * overlay (native text / sticky-note shapes, which can't host the handle).
 */
export function startConnectDrag(
  editor: Editor,
  boardKey: string,
  fromId: TLShapeId,
  clientX: number,
  clientY: number,
): void {
  const toPage = (cx: number, cy: number) =>
    editor.screenToPage({ x: cx, y: cy });

  const start = toPage(clientX, clientY);
  setDrag({ fromId, toX: start.x, toY: start.y });

  const onMove = (ev: PointerEvent) => {
    const p = toPage(ev.clientX, ev.clientY);
    setDrag({ fromId, toX: p.x, toY: p.y });
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
    if (target && target.id !== fromId) {
      addConnector(boardKey, fromId, target.id);
    }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

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
    startConnectDrag(editor, boardKey, shapeId, e.clientX, e.clientY);
  };

  const dot = (side: "left" | "right") => (
    <div
      title={CONNECT_DOT_TITLE}
      onPointerDown={startDrag}
      style={{
        ...CONNECT_DOT_STYLE,
        position: "absolute",
        top: "50%",
        [side]: 3,
        transform: "translateY(-50%)",
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
