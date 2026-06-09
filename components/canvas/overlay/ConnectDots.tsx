"use client";

import { useEditor, useValue, type TLShapeId } from "tldraw";
import { useBoardKey } from "../BoardContext";
import { useDrag } from "@/lib/storage/connectors";
import {
  CONNECT_DOT_STYLE,
  CONNECT_DOT_TITLE,
  startConnectDrag,
} from "../shapes/ConnectHandle";

// Native tldraw shapes that can't host the in-shape ConnectHandle (it's a child
// of our custom shape bodies). The overlay gives them the same connect dots so
// they're full graph nodes you can pull connectors from, like the card nodes.
const NATIVE = new Set(["text", "note"]);

// How far inside the shape edge the dot sits (screen px). Keeping it just inside
// means the pointer is still over the shape while reaching for the dot, so the
// shape stays hovered and the dot doesn't vanish.
const INSET = 7;

/**
 * Connect dots for native text shapes and sticky notes. Rendered (screen-space,
 * position:fixed) at the left/right edges of the hovered shape — or, mid-drag,
 * the shape being dragged from. Reuses the card ConnectHandle's drag logic; the
 * drag line, drop target, and connector rendering already handle native shapes.
 *
 * Rendered inline in this overlay (NOT portaled to body) so the side panels
 * occlude the dots exactly like they occlude the in-shape handle on doc/image
 * cards — a body portal would paint the dots OVER the chat dock / sidebar. The
 * slot's other children (toolbar, chat dock) prove position:fixed is already
 * viewport-relative here. A z-index below the panels keeps them tucked under.
 */
export function ConnectDots() {
  const editor = useEditor();
  const boardKey = useBoardKey();
  const drag = useDrag();

  const dots = useValue(
    "native-connect-dots",
    () => {
      // While dragging, only show the source's dots (matches the card handle's
      // isDragSource behavior); otherwise show the hovered shape's.
      const targetIds = new Set<TLShapeId>();
      if (drag?.fromId) {
        targetIds.add(drag.fromId as TLShapeId);
      } else {
        const hov = editor.getHoveredShapeId();
        if (hov) targetIds.add(hov);
      }

      const out: {
        id: TLShapeId;
        side: "left" | "right";
        x: number;
        y: number;
      }[] = [];
      for (const id of targetIds) {
        const s = editor.getShape(id);
        if (!s || !NATIVE.has(s.type)) continue;
        const b = editor.getShapePageBounds(id);
        if (!b) continue;
        const midY = b.minY + b.h / 2;
        const l = editor.pageToScreen({ x: b.minX, y: midY });
        const r = editor.pageToScreen({ x: b.maxX, y: midY });
        out.push({ id, side: "left", x: l.x + INSET, y: l.y });
        out.push({ id, side: "right", x: r.x - INSET, y: r.y });
      }
      return out;
    },
    [editor, drag],
  );

  if (!boardKey || dots.length === 0) return null;

  return (
    <>
      {dots.map((d) => (
        <div
          key={`${d.id}:${d.side}`}
          title={CONNECT_DOT_TITLE}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            startConnectDrag(editor, boardKey, d.id, e.clientX, e.clientY);
          }}
          style={{
            ...CONNECT_DOT_STYLE,
            position: "fixed",
            left: d.x,
            top: d.y,
            transform: "translate(-50%, -50%)",
            // Below the slot's panels (z-30: toolbar, chat dock) and the
            // sidebar (z-600) so they occlude the dots; still above the canvas.
            zIndex: 20,
          }}
        />
      ))}
    </>
  );
}
