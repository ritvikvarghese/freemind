"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DefaultRichTextToolbar,
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

/**
 * Rich text toolbar for canvas text shapes. tldraw's rich text is Tiptap under
 * the hood, so we render the SAME button row as focus mode bound to the
 * editing shape's Tiptap editor (`editor.getRichTextEditor()`).
 *
 * Crucially this uses tldraw's own `DefaultRichTextToolbar` for POSITIONING
 * (TldrawUiContextualToolbar), not Tiptap's BubbleMenuPlugin. The plugin
 * reparents its DOM element, which clashed with React unmounting as tldraw
 * destroys its text editor per edit and crashed the app; tldraw's container is
 * a stable React subtree, so there's no such conflict.
 *
 * Color is added as a leading control: tldraw text color is a per-SHAPE style
 * (one color per text shape), not an inline Tiptap mark, so it's driven off the
 * tldraw editor (the editing shape) rather than the Tiptap selection.
 */
export function CanvasRichTextToolbar() {
  const editor = useEditor();
  const textEditor = useValue(
    "canvas-rich-text-editor",
    () => editor.getRichTextEditor(),
    [editor],
  );
  if (!textEditor) return null;
  return (
    <DefaultRichTextToolbar>
      {/* No headings: tldraw text shapes don't render them. Keep inline
          formatting (bold/italic/underline/strike/highlight/code), align,
          lists, link. Color leads (per-shape, set on the editing shape). */}
      <EditorToolbarContent
        editor={textEditor as unknown as TiptapEditor}
        showHeadings={false}
        leadingControl={<TextColorControl editor={editor} />}
        fontControl={<CanvasFontControl editor={editor} />}
      />
    </DefaultRichTextToolbar>
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
