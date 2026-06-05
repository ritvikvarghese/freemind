"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, createShapeId, toRichText, type TLEventInfo } from "tldraw";
import { Type, StickyNote, FileText, Image as ImageIcon, Upload } from "lucide-react";
import { toast } from "../toast";
import { ingestFiles } from "../ingestFiles";
import { ingestImages } from "../ingestImages";
import { createBlankDoc } from "./MinimalToolbar";

type Menu = {
  /** Screen coords for positioning the popover. */
  x: number;
  y: number;
  /** Page coords where created content is placed. */
  page: { x: number; y: number };
};

const MENU_W = 232;

/**
 * Single-click empty canvas to summon a "create here" palette at the cursor —
 * a floating companion to the left rail. Opens ONLY on a right-click of empty
 * canvas (left/double clicks are left alone — they were too eager). Any left
 * pointer-down closes it; right-clicking a shape closes it and lets the node
 * context menu show. Pen/YouTube stay on the rail (draw/URL flows).
 */
export function FloatingToolbar() {
  const editor = useEditor();
  const [menu, setMenu] = useState<Menu | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Page point captured when a file picker opens, so ingest lands at the
  // click spot even though the picker is async.
  const pendingPage = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const openAt = (pt: { x: number; y: number }) => {
      const rect = editor.getContainer().getBoundingClientRect();
      const page = editor.screenToPage(pt);
      setMenu({
        x: rect.left + pt.x,
        y: rect.top + pt.y,
        page: { x: page.x, y: page.y },
      });
    };

    const onEvent = (info: TLEventInfo) => {
      if (info.type !== "pointer") return;
      // Right-click on empty canvas opens the palette. On a shape, close it and
      // let the node context menu take over.
      if (info.name === "right_click") {
        if (editor.getCurrentToolId() !== "select") return;
        const page = editor.screenToPage(info.point);
        const hit = editor.getShapeAtPoint(page, {
          hitInside: true,
          margin: editor.options.hitTestMargin / editor.getZoomLevel(),
        });
        if (hit) setMenu(null);
        else openAt(info.point);
        return;
      }
      // Any left interaction (click, drag, pan) dismisses an open palette.
      if (info.name === "pointer_down") setMenu(null);
    };

    editor.on("event", onEvent);
    return () => {
      editor.off("event", onEvent);
    };
  }, [editor]);

  // Esc closes the palette.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menu]);

  const close = useCallback(() => setMenu(null), []);

  const addText = useCallback(() => {
    if (!menu) return;
    const id = createShapeId();
    editor.markHistoryStoppingPoint("create text");
    editor.createShape({
      id,
      type: "text",
      x: menu.page.x,
      y: menu.page.y,
      // Explicit black so text never inherits the note tool's armed color.
      props: { richText: toRichText(""), autoSize: true, color: "black" },
    });
    editor.select(id);
    editor.setEditingShape(id);
    close();
  }, [editor, menu, close]);

  const addNote = useCallback(() => {
    if (!menu) return;
    const id = createShapeId();
    editor.markHistoryStoppingPoint("create note");
    // Note default box is ~200px; center it on the cursor.
    editor.createShape({
      id,
      type: "note",
      x: menu.page.x - 100,
      y: menu.page.y - 100,
    });
    editor.select(id);
    editor.setEditingShape(id);
    close();
  }, [editor, menu, close]);

  const addDoc = useCallback(() => {
    if (!menu) return;
    createBlankDoc(editor, menu.page);
    close();
  }, [editor, menu, close]);

  const openImagePicker = useCallback(() => {
    pendingPage.current = menu?.page ?? null;
    imageInputRef.current?.click();
  }, [menu]);

  const openFilePicker = useCallback(() => {
    pendingPage.current = menu?.page ?? null;
    fileInputRef.current?.click();
  }, [menu]);

  if (!menu) return null;

  const left = Math.min(menu.x, window.innerWidth - MENU_W - 8);
  const top = Math.min(menu.y, window.innerHeight - 56);

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[60] flex items-center gap-1 rounded-panel border border-hairline bg-elevated p-1 shadow-[var(--shadow-floating)]"
      style={{ left, top }}
    >
      <FloatingButton label="Text" onClick={addText}>
        <Type className="h-4 w-4" aria-hidden />
      </FloatingButton>
      <FloatingButton label="Sticky note" onClick={addNote}>
        <StickyNote className="h-4 w-4" aria-hidden />
      </FloatingButton>
      <FloatingButton label="Document" onClick={addDoc}>
        <FileText className="h-4 w-4" aria-hidden />
      </FloatingButton>
      <FloatingButton label="Image" onClick={openImagePicker}>
        <ImageIcon className="h-4 w-4" aria-hidden />
      </FloatingButton>
      <FloatingButton label="PDF, Word, or markdown" onClick={openFilePicker}>
        <Upload className="h-4 w-4" aria-hidden />
      </FloatingButton>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          const at = pendingPage.current ?? undefined;
          close();
          if (files.length > 0) {
            try {
              await ingestImages(editor, files, at);
            } catch (err) {
              toast(
                `Could not add image: ${err instanceof Error ? err.message : "unknown error"}`,
                "error",
              );
            }
          }
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          const at = pendingPage.current ?? undefined;
          close();
          if (files.length > 0) await ingestFiles(editor, files, at);
        }}
      />
    </div>,
    document.body,
  );
}

function FloatingButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-button text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text-primary"
    >
      {children}
    </button>
  );
}
