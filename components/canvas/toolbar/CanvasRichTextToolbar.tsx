"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getColorStyleItems,
  useEditor,
  useValue,
  type Editor,
  type TLDefaultColorStyle,
  type TLDefaultFontStyle,
  type TLShapePartial,
} from "tldraw";
import type { Editor as TiptapEditor } from "@tiptap/core";
import {
  EditorToolbarContent,
  FontMenu,
  type DocFont,
} from "@/components/focus/editor/BubbleToolbar";

const SCREEN_MARGIN = 16;
const TOOLBAR_GAP = 8;

function clamp(n: number, min: number, max: number): number {
  // When the toolbar is wider than the safe area, `max` can fall below `min`;
  // prefer staying pinned to the left margin rather than going negative.
  return Math.max(min, Math.min(max, n));
}

/**
 * Rich text toolbar for canvas text shapes. tldraw's rich text is Tiptap under
 * the hood, so we render the SAME button row as focus mode bound to the
 * editing shape's Tiptap editor (`editor.getRichTextEditor()`).
 *
 * Positioning is OURS, not tldraw's `DefaultRichTextToolbar`. tldraw anchors
 * the toolbar to the vertical MIDPOINT of the selection and refuses to show it
 * when that midpoint leaves the viewport (`getToolbarScreenPosition` returns
 * undefined when `midY` is off-screen). A text box taller than the viewport
 * therefore loses its toolbar the moment the whole thing is selected (a
 * partial selection works, selecting everything does not). We instead anchor to
 * the TOP of the selection and clamp into the viewport, so the toolbar is
 * always reachable however much text is selected. We keep tldraw's stable React
 * subtree approach (a portal, not Tiptap's BubbleMenuPlugin, which reparents its
 * DOM and crashes as tldraw destroys the text editor per edit).
 *
 * Color/font are leading controls: tldraw text color and font are per-SHAPE
 * styles (one per text shape), not inline Tiptap marks, so they're driven off
 * the tldraw editor (the editing shape) rather than the Tiptap selection.
 */
export function CanvasRichTextToolbar() {
  const editor = useEditor();
  const textEditor = useValue(
    "canvas-rich-text-editor",
    () => editor.getRichTextEditor(),
    [editor],
  );
  const isCoarsePointer = useValue(
    "canvas-rich-text-coarse",
    () => editor.getInstanceState().isCoarsePointer,
    [editor],
  );
  // Reposition on pan/zoom: selection client rects are viewport-relative, so a
  // camera move shifts where the (fixed) toolbar should sit.
  const camera = useValue("canvas-rich-text-camera", () => editor.getCamera(), [
    editor,
  ]);
  if (!textEditor || isCoarsePointer) return null;
  return (
    <PositionedTextToolbar editor={editor} textEditor={textEditor} camera={camera} />
  );
}

function PositionedTextToolbar({
  editor,
  textEditor,
  camera,
}: {
  editor: Editor;
  textEditor: ReturnType<Editor["getRichTextEditor"]>;
  camera: unknown;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Hide while the user is actively drag-selecting so the toolbar doesn't chase
  // the cursor; it settles into place on pointer-up.
  const [isMousingDown, setIsMousingDown] = useState(false);
  const [tick, setTick] = useState(0);

  // Recompute on selection change, layout/size change, scroll, and resize.
  useEffect(() => {
    const te = textEditor as unknown as TiptapEditor;
    const bump = () => setTick((t) => t + 1);
    te.on("selectionUpdate", bump);
    te.on("transaction", bump);
    // Ground truth for selection changes: fires on collapse-to-cursor too, where
    // Tiptap's selectionUpdate can miss, so the toolbar reliably hides.
    document.addEventListener("selectionchange", bump);
    window.addEventListener("scroll", bump, true);
    window.addEventListener("resize", bump);
    const dom = te.view?.dom as HTMLElement | undefined;
    const down = () => setIsMousingDown(true);
    const up = () => {
      setIsMousingDown(false);
      bump();
    };
    dom?.addEventListener("pointerdown", down);
    dom?.addEventListener("mousedown", down);
    dom?.addEventListener("touchstart", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("mouseup", up);
    document.addEventListener("touchend", up);
    const ro = new ResizeObserver(bump);
    if (ref.current) ro.observe(ref.current);
    bump();
    return () => {
      te.off("selectionUpdate", bump);
      te.off("transaction", bump);
      document.removeEventListener("selectionchange", bump);
      window.removeEventListener("scroll", bump, true);
      window.removeEventListener("resize", bump);
      dom?.removeEventListener("pointerdown", down);
      dom?.removeEventListener("mousedown", down);
      dom?.removeEventListener("touchstart", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("touchend", up);
      ro.disconnect();
    };
  }, [textEditor]);

  useLayoutEffect(() => {
    const el = ref.current;
    const win = editor.getContainer().ownerDocument.defaultView ?? window;
    const sel = win.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setPos(null);
      return;
    }
    // Bounding box of every selection range, in viewport coordinates.
    let top = Infinity;
    let left = Infinity;
    let right = -Infinity;
    for (let i = 0; i < sel.rangeCount; i++) {
      const r = sel.getRangeAt(i).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      top = Math.min(top, r.top);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
    }
    if (!Number.isFinite(top)) {
      setPos(null);
      return;
    }
    const tb = el.getBoundingClientRect();
    if (!tb.width || !tb.height) return; // not measured yet; next tick fixes it
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    const midX = (left + right) / 2;
    // Anchor above the top of the selection; clamp fully into the viewport so a
    // selection taller than the screen still shows the toolbar near the top.
    const x = clamp(midX - tb.width / 2, SCREEN_MARGIN, vw - tb.width - SCREEN_MARGIN);
    const y = clamp(
      top - tb.height - TOOLBAR_GAP,
      SCREEN_MARGIN,
      vh - tb.height - SCREEN_MARGIN,
    );
    setPos({ left: Math.round(x), top: Math.round(y) });
  }, [editor, textEditor, tick, camera]);

  const visible = pos !== null && !isMousingDown;

  return createPortal(
    <div
      ref={ref}
      onPointerDown={(e) => e.stopPropagation()}
      className="tlui-rich-text__toolbar z-50 rounded-button border border-hairline bg-elevated p-1 shadow-floating"
      style={{
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: visible ? "visible" : "hidden",
        boxShadow: "var(--shadow-floating)",
      }}
    >
      {/* No headings: tldraw text shapes don't render them. Keep inline
          formatting (bold/italic/underline/strike/highlight/code), align,
          lists, link. Color leads (per-shape, set on the editing shape). */}
      <EditorToolbarContent
        editor={textEditor as unknown as TiptapEditor}
        showHeadings={false}
        leadingControl={<TextColorControl editor={editor} />}
        fontControl={<CanvasFontControl editor={editor} />}
      />
    </div>,
    document.body,
  );
}

// Per-shape font picker for the editing text (or note) shape. tldraw stores one
// font per text shape as a native style prop (draw/sans/serif/mono), so picking
// restyles the whole shape and persists in the tldraw store with no extra prop.
// The default `draw` slot is themed to the app sans (see CanvasRoot.onMount), so
// it surfaces as "Sans" here.
function CanvasFontControl({ editor }: { editor: Editor }) {
  const editingShape = useValue(
    "canvas-text-font-shape",
    () => {
      const id = editor.getEditingShapeId() ?? editor.getOnlySelectedShape()?.id;
      const shape = id ? editor.getShape(id) : null;
      if (!shape || (shape.type !== "text" && shape.type !== "note")) return null;
      return shape;
    },
    [editor],
  );

  const current: DocFont = useValue(
    "canvas-text-font-current",
    () => {
      const font = (editingShape?.props as { font?: string } | undefined)?.font;
      // `draw` is themed to the app sans, so it reads as "Sans" in the picker.
      return font === "serif" || font === "mono" ? font : "sans";
    },
    [editingShape],
  );

  if (!editingShape) return null;

  const pick = (font: DocFont) => {
    editor.markHistoryStoppingPoint("set text font");
    editor.updateShape({
      id: editingShape.id,
      type: editingShape.type,
      props: { font: font as TLDefaultFontStyle },
    } as TLShapePartial);
  };

  return <FontMenu current={current} onSelect={pick} />;
}

// Per-shape color picker for the editing text (or note) shape. tldraw colors a
// whole text shape with one color, so picking recolors the entire shape being
// edited, not just the highlighted range. Swatch fills come from the live theme
// (the `solid` value text renders with); black leads (theme-aware ink).
function TextColorControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const swatches = useValue(
    "canvas-text-color-swatches",
    () => {
      const colors = editor.getCurrentTheme().colors[editor.getColorMode()];
      const fills = colors as unknown as Record<string, { solid: string }>;
      const names = getColorStyleItems(colors)
        .map((item) => item.value)
        .filter((name) => name !== "black");
      return ["black", ...names].map((name) => ({
        name,
        fill: fills[name]?.solid,
      }));
    },
    [editor],
  );

  // The shape currently being edited (its color drives the active swatch).
  const current = useValue(
    "canvas-text-color-current",
    () => {
      const id = editor.getEditingShapeId() ?? editor.getOnlySelectedShape()?.id;
      const shape = id ? editor.getShape(id) : null;
      return (shape?.props as { color?: string } | undefined)?.color ?? "black";
    },
    [editor],
  );
  const currentFill = swatches.find((s) => s.name === current)?.fill;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 6 });
    }
    setOpen((o) => !o);
  };

  const pick = (name: string) => {
    const id = editor.getEditingShapeId() ?? editor.getOnlySelectedShape()?.id;
    const shape = id ? editor.getShape(id) : null;
    // Only text and sticky notes carry the rich-text editor + a color prop.
    if (!shape || (shape.type !== "text" && shape.type !== "note")) return;
    editor.markHistoryStoppingPoint("set text color");
    editor.updateShape({
      id: shape.id,
      type: shape.type,
      props: { color: name as TLDefaultColorStyle },
    } as TLShapePartial);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Text color"
        onClick={toggle}
        className="group/tt relative grid h-6 w-6 place-items-center rounded-button text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
      >
        <span
          className="h-3.5 w-3.5 rounded-full border border-hairline"
          style={{ backgroundColor: currentFill }}
        />
        <span className="pointer-events-none absolute left-1/2 top-full z-[80] mt-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-button border border-hairline bg-elevated px-2 py-1 text-[11px] font-medium text-text-secondary shadow-floating group-hover/tt:block">
          Text color
        </span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              onMouseDown={(e) => e.preventDefault()}
              style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 80 }}
              className="grid grid-cols-3 gap-2 rounded-panel border border-hairline bg-elevated p-2 shadow-floating"
            >
              {swatches.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  aria-label={`Text color: ${s.name}`}
                  onClick={() => pick(s.name)}
                  style={{ backgroundColor: s.fill }}
                  className={
                    "h-6 w-6 rounded-[6px] border transition-transform duration-100 hover:scale-110 " +
                    (current === s.name
                      ? "border-text-secondary/60 ring-1 ring-text-secondary/40 ring-offset-1 ring-offset-elevated"
                      : "border-hairline")
                  }
                />
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
