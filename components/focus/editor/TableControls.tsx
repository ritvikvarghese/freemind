"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { MoreHorizontal, Plus } from "lucide-react";

type Props = {
  editor: Editor;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
};

type ActiveTable = {
  /** Document position just before the table node. */
  pos: number;
  node: PMNode;
  /** Table box relative to the editor wrapper. */
  box: { top: number; left: number; width: number; height: number };
};

/** How far outside a hovered table the pointer can go (to reach the + bars). */
const HOVER_SLACK_PX = 56;
const BAR_PX = 16;

/**
 * Table affordances: a "+" bar under the table (add row), one on its right
 * (add column), and a "…" menu for the rest. Shown while the cursor is in a
 * table or the pointer is over one. The header row can't be deleted or have a
 * row inserted above it: a markdown table always has exactly one header row,
 * so anything else would not survive a reload.
 */
export function TableControls({ editor, wrapperRef }: Props) {
  const [active, setActive] = useState<ActiveTable | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const hoveredRef = useRef<HTMLTableElement | null>(null);

  const measure = useCallback(
    (pos: number): ActiveTable | null => {
      const node = editor.state.doc.nodeAt(pos);
      const wrapper = wrapperRef.current;
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
      const table = dom?.tagName === "TABLE" ? dom : dom?.querySelector("table");
      if (!node || node.type.name !== "table" || !wrapper || !table) return null;
      const r = table.getBoundingClientRect();
      const w = wrapper.getBoundingClientRect();
      return {
        pos,
        node,
        box: { top: r.top - w.top, left: r.left - w.left, width: r.width, height: r.height },
      };
    },
    [editor, wrapperRef],
  );

  const refresh = useCallback(() => {
    let pos = selectionTablePos(editor);
    const hovered = hoveredRef.current;
    if (pos === null && hovered?.isConnected) {
      try {
        pos = tablePosAt(editor, editor.view.posAtDOM(hovered, 0));
      } catch {
        pos = null;
      }
    }
    setActive(pos === null ? null : measure(pos));
  }, [editor, measure]);

  useEffect(() => {
    editor.on("transaction", refresh);
    return () => {
      editor.off("transaction", refresh);
    };
  }, [editor, refresh]);

  useEffect(() => {
    const surface =
      (wrapperRef.current?.closest(".canvas-ai-focus-paper") as HTMLElement | null) ??
      wrapperRef.current;
    if (!surface) return;
    const onMove = (e: MouseEvent) => {
      const current = hoveredRef.current;
      if (current?.isConnected) {
        const r = current.getBoundingClientRect();
        const near =
          e.clientX >= r.left - HOVER_SLACK_PX &&
          e.clientX <= r.right + HOVER_SLACK_PX &&
          e.clientY >= r.top - HOVER_SLACK_PX &&
          e.clientY <= r.bottom + HOVER_SLACK_PX;
        if (near) return;
      }
      const table = (e.target as HTMLElement | null)?.closest?.("table") ?? null;
      const next = table && editor.view.dom.contains(table) ? table : null;
      if (next === current) return;
      hoveredRef.current = next;
      refresh();
    };
    const onLeave = () => {
      hoveredRef.current = null;
      refresh();
    };
    surface.addEventListener("mousemove", onMove);
    surface.addEventListener("mouseleave", onLeave);
    surface.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh);
    return () => {
      surface.removeEventListener("mousemove", onMove);
      surface.removeEventListener("mouseleave", onLeave);
      surface.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [editor, wrapperRef, refresh]);

  if (!active || !editor.isEditable) return null;

  const { node, pos, box } = active;
  const lastRow = node.childCount - 1;
  const lastCol = node.child(0).childCount - 1;
  const inThisTable = selectionTablePos(editor) === pos;
  const inHeaderRow = inThisTable && selectionRowIndex(editor) === 0;

  // Put the cursor in a given cell, then run a prosemirror-tables command.
  const inCell = (row: number, col: number) =>
    editor.chain().focus().setTextSelection(cellTextPos(node, pos, row, col));

  const items: { label: string; run: () => void; disabled?: boolean }[] = [
    { label: "Insert row above", run: () => editor.chain().focus().addRowBefore().run(), disabled: inHeaderRow },
    { label: "Insert row below", run: () => editor.chain().focus().addRowAfter().run() },
    { label: "Insert column left", run: () => editor.chain().focus().addColumnBefore().run() },
    { label: "Insert column right", run: () => editor.chain().focus().addColumnAfter().run() },
    { label: "Delete row", run: () => editor.chain().focus().deleteRow().run(), disabled: inHeaderRow || lastRow === 0 },
    { label: "Delete column", run: () => editor.chain().focus().deleteColumn().run(), disabled: lastCol === 0 },
    { label: "Delete table", run: () => editor.chain().focus().deleteTable().run() },
  ];

  return (
    <>
      <button
        type="button"
        title="Add row"
        aria-label="Add row"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => inCell(lastRow, 0).addRowAfter().run()}
        className="absolute z-10 grid place-items-center rounded-button bg-surface-hover text-text-tertiary transition-colors hover:bg-hairline hover:text-text-secondary"
        style={{ top: box.top + box.height + 4, left: box.left, width: box.width, height: BAR_PX }}
      >
        <Plus className="h-3 w-3" aria-hidden />
      </button>
      <button
        type="button"
        title="Add column"
        aria-label="Add column"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => inCell(0, lastCol).addColumnAfter().run()}
        className="absolute z-10 grid place-items-center rounded-button bg-surface-hover text-text-tertiary transition-colors hover:bg-hairline hover:text-text-secondary"
        style={{ top: box.top, left: box.left + box.width + 4, width: BAR_PX, height: box.height }}
      >
        <Plus className="h-3 w-3" aria-hidden />
      </button>
      {inThisTable ? (
        <button
          type="button"
          title="Table options"
          aria-label="Table options"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => setMenuAnchor(e.currentTarget.getBoundingClientRect())}
          className="absolute z-10 grid h-7 w-7 place-items-center rounded-button border border-hairline bg-elevated text-text-tertiary shadow-panel hover:text-text-secondary"
          style={{ top: box.top, left: box.left + box.width + BAR_PX + 10 }}
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
      {menuAnchor && inThisTable ? (
        <TableMenu anchor={menuAnchor} items={items} onClose={() => setMenuAnchor(null)} />
      ) : null}
    </>
  );
}

function TableMenu({
  anchor,
  items,
  onClose,
}: {
  anchor: DOMRect;
  items: { label: string; run: () => void; disabled?: boolean }[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[70] min-w-[180px] rounded-button border border-hairline bg-elevated p-1 shadow-floating"
      style={{ top: anchor.bottom + 6, left: Math.max(8, anchor.right - 180) }}
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          type="button"
          disabled={item.disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            if (item.disabled) return;
            item.run();
            onClose();
          }}
          className={
            "flex w-full rounded-button px-2 py-1.5 text-left text-[12px] transition-colors duration-75 " +
            (item.disabled
              ? "cursor-default text-text-tertiary opacity-50"
              : "text-text-secondary hover:bg-surface-hover hover:text-text-primary") +
            (i === items.length - 1 ? " mt-1 border-t border-hairline pt-2" : "")
          }
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** Position before the table node containing `pos`, or null. */
function tablePosAt(editor: Editor, pos: number): number | null {
  const $pos = editor.state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === "table") return $pos.before(d);
  }
  return null;
}

function selectionTablePos(editor: Editor): number | null {
  return tablePosAt(editor, editor.state.selection.from);
}

function selectionRowIndex(editor: Editor): number | null {
  const $from = editor.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "tableRow") return $from.index(d - 1);
  }
  return null;
}

/** A text position inside cell (row, col) of the table at `tablePos`. */
function cellTextPos(table: PMNode, tablePos: number, row: number, col: number): number {
  let pos = tablePos + 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  pos += 1; // into the row
  const rowNode = table.child(row);
  for (let c = 0; c < col; c++) pos += rowNode.child(c).nodeSize;
  return pos + 2; // into the cell, then into its paragraph
}
