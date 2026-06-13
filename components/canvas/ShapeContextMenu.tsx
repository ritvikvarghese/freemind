"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DefaultContextMenu,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  TldrawUiMenuSubmenu,
  useEditor,
  useMenuClipboardEvents,
  createShapeId,
  toRichText,
  type Editor,
  type TLShape,
  type TLShapeId,
  type TLUiContextMenuProps,
  type TLUiTranslationKey,
  type VecLike,
} from "tldraw";
import type { ImageNodeShape } from "./shapes/ImageNode";
import type { UploadNodeShape } from "./shapes/UploadNode";
import type { DocumentNodeShape } from "./shapes/DocumentNode";
import type { LinkNodeShape } from "./shapes/LinkNode";
import { readImageText, ingestImages } from "./ingestImages";
import { ingestFiles } from "./ingestFiles";
import { createBlankDoc } from "./toolbar/MinimalToolbar";
import { useBoardKey } from "./BoardContext";
import { openExternalUrl } from "@/lib/url/openExternal";
import { getBoards } from "@/lib/storage/boards";
import { queueShapeTransfer } from "@/lib/storage/shapeTransfers";
import { stripProvenance, withoutProvenance } from "@/lib/canvas/stripProvenance";
import { toast } from "./toast";

// Menu labels are human strings, not tldraw translation keys; msg() echoes
// unknown keys, so they render verbatim.
const tk = (s: string) => s as TLUiTranslationKey;

type Mode =
  | { kind: "shape"; shape: TLShape }
  | { kind: "multi"; ids: TLShapeId[] }
  | { kind: "empty" };

/**
 * Right-click menu, Freemind-styled across the board (no tldraw default menu):
 *  - on 2+ selected shapes → actions applied to all of them
 *  - on a Freemind node (image / uploaded doc / document / link) → node actions
 *  - on a native shape → generic actions (duplicate / duplicate-to / delete)
 *  - on empty canvas → the same "create here" palette as a left click
 *
 * The target is FROZEN at right-click time (captured from the contextmenu
 * event), not read live — otherwise moving the mouse toward a menu item flips
 * the menu's contents and you can't click anything.
 */
export function ShapeContextMenu(props: TLUiContextMenuProps) {
  const editor = useEditor();
  const boardKey = useBoardKey();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Page point captured when a file picker opens, so ingest lands where the
  // user right-clicked even though the picker is async.
  const pendingPoint = useRef<VecLike | null>(null);

  // Freeze the click location when the context menu opens. Reading it live
  // would let the menu's contents change as the pointer moves toward an item.
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const container = editor.getContainer();
    const onCtx = (e: MouseEvent) => {
      const page = editor.screenToPage({ x: e.clientX, y: e.clientY });
      setAnchor(page);
      // Empty canvas → no vertical context menu. The horizontal create palette
      // (FloatingToolbar) is the single create UI, so suppress radix's menu and
      // avoid showing two things at once.
      const hit = editor.getShapeAtPoint(page, {
        hitInside: true,
        margin: editor.options.hitTestMargin / editor.getZoomLevel(),
      });
      if (!hit) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    container.addEventListener("contextmenu", onCtx, true);
    return () => container.removeEventListener("contextmenu", onCtx, true);
  }, [editor]);

  const mode: Mode = (() => {
    if (!anchor) return { kind: "empty" };
    const hit = editor.getShapeAtPoint(anchor, {
      hitInside: true,
      margin: editor.options.hitTestMargin / editor.getZoomLevel(),
    });
    if (!hit) return { kind: "empty" };
    const selected = editor.getSelectedShapeIds();
    if (selected.length >= 2 && selected.includes(hit.id)) {
      return { kind: "multi", ids: selected };
    }
    return { kind: "shape", shape: hit };
  })();

  const point = useCallback(
    () => anchor ?? { ...editor.inputs.getCurrentPagePoint() },
    [editor, anchor],
  );

  const addText = useCallback(() => {
    const pt = point();
    const id = createShapeId();
    editor.markHistoryStoppingPoint("create text");
    editor.createShape({
      id,
      type: "text",
      x: pt.x,
      y: pt.y,
      // Explicit black so text never inherits the note tool's armed color.
      props: { richText: toRichText(""), autoSize: true, color: "black" },
    });
    editor.select(id);
    editor.setEditingShape(id);
  }, [editor, point]);

  const addNote = useCallback(() => {
    const pt = point();
    const id = createShapeId();
    editor.markHistoryStoppingPoint("create note");
    editor.createShape({ id, type: "note", x: pt.x - 100, y: pt.y - 100 });
    editor.select(id);
    editor.setEditingShape(id);
  }, [editor, point]);

  const addDoc = useCallback(() => createBlankDoc(editor, point()), [editor, point]);

  const openImagePicker = useCallback(() => {
    pendingPoint.current = point();
    imageInputRef.current?.click();
  }, [point]);

  const openFilePicker = useCallback(() => {
    pendingPoint.current = point();
    fileInputRef.current?.click();
  }, [point]);

  let content: React.ReactNode;
  if (mode.kind === "shape") {
    content = (
      <NodeActions editor={editor} shape={mode.shape} boardKey={boardKey} />
    );
  } else if (mode.kind === "multi") {
    content = (
      <MultiActions editor={editor} ids={mode.ids} boardKey={boardKey} />
    );
  } else {
    content = (
      <TldrawUiMenuGroup id="create-here">
        <TldrawUiMenuItem id="create-text" label={tk("Text")} onSelect={addText} />
        <TldrawUiMenuItem
          id="create-note"
          label={tk("Sticky note")}
          onSelect={addNote}
        />
        <TldrawUiMenuItem
          id="create-document"
          label={tk("Document")}
          onSelect={addDoc}
        />
        <TldrawUiMenuItem
          id="create-image"
          label={tk("Image")}
          onSelect={openImagePicker}
        />
        <TldrawUiMenuItem
          id="create-upload"
          label={tk("PDF, Word, or markdown")}
          onSelect={openFilePicker}
        />
      </TldrawUiMenuGroup>
    );
  }

  return (
    <>
      <DefaultContextMenu {...props}>{content}</DefaultContextMenu>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          const at = pendingPoint.current ?? undefined;
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
          const at = pendingPoint.current ?? undefined;
          if (files.length > 0) await ingestFiles(editor, files, at);
        }}
      />
    </>
  );
}

function NodeActions({
  editor,
  shape,
  boardKey,
}: {
  editor: Editor;
  shape: TLShape;
  boardKey: string | null;
}) {
  const id = shape.id;
  const type = shape.type;
  const isImage = type === "canvas-ai-image";
  const isAnimatedImage =
    isImage &&
    ((shape as ImageNodeShape).props.mediaType === "image/gif" ||
      (shape as ImageNodeShape).props.mediaType === "image/webp");
  const isLink = type === "canvas-ai-link";
  // Image / uploaded doc / generated document carry copyable + downloadable
  // content. Links and native shapes don't.
  const isContentNode =
    isImage || type === "canvas-ai-upload" || type === "canvas-ai-document";

  const otherBoards = getBoards().filter((b) => b.persistenceKey !== boardKey);

  return (
    <TldrawUiMenuGroup id="freemind-node-actions">
      {isImage && !isAnimatedImage ? (
        <TldrawUiMenuItem
          id="node-read-text"
          label={tk("Read text · uses tokens")}
          onSelect={() => void readImageText(editor, id)}
        />
      ) : null}
      {isLink ? (
        <>
          <TldrawUiMenuItem
            id="node-open-link"
            label={tk("Open in new tab")}
            onSelect={() => {
              openExternalUrl((shape as LinkNodeShape).props.url);
            }}
          />
          <TldrawUiMenuItem
            id="node-copy-link"
            label={tk("Copy link")}
            onSelect={() => {
              void navigator.clipboard
                .writeText((shape as LinkNodeShape).props.url ?? "")
                .then(() => toast("Link copied", "info"))
                .catch(() => toast("Couldn’t copy link", "error"));
            }}
          />
        </>
      ) : null}
      {isContentNode ? (
        <TldrawUiMenuItem
          id="node-copy"
          label={tk("Copy")}
          onSelect={() => void copyShape(editor, shape)}
        />
      ) : null}
      {isContentNode ? (
        <TldrawUiMenuItem
          id="node-download"
          label={tk("Download")}
          onSelect={() => downloadShape(editor, shape)}
        />
      ) : null}
      <TldrawUiMenuItem
        id="node-duplicate"
        label={tk("Duplicate")}
        onSelect={() => duplicateStandalone(editor, [id])}
      />
      <TldrawUiMenuSubmenu
        id="node-duplicate-to"
        label={tk("Duplicate to")}
        disabled={otherBoards.length === 0}
      >
        <TldrawUiMenuGroup id="duplicate-to-boards">
          {otherBoards.length === 0 ? (
            <TldrawUiMenuItem
              id="dup-none"
              label={tk("No other canvases")}
              disabled
              onSelect={() => {}}
            />
          ) : (
            otherBoards.map((b) => (
              <TldrawUiMenuItem
                key={b.id}
                id={`dup-to-${b.id}`}
                label={tk(b.title || "Untitled canvas")}
                onSelect={() => {
                  queueShapeTransfer(b.persistenceKey, {
                    type: shape.type,
                    props: withoutProvenance(shape.type, { ...shape.props }),
                  });
                  toast(
                    `Duplicated to "${b.title || "Untitled canvas"}"`,
                    "info",
                  );
                }}
              />
            ))
          )}
        </TldrawUiMenuGroup>
      </TldrawUiMenuSubmenu>
      <TldrawUiMenuItem
        id="node-delete"
        label={tk("Delete")}
        onSelect={() => {
          editor.deleteShapes([id]);
        }}
      />
    </TldrawUiMenuGroup>
  );
}

function MultiActions({
  editor,
  ids,
  boardKey,
}: {
  editor: Editor;
  ids: TLShapeId[];
  boardKey: string | null;
}) {
  const { copy } = useMenuClipboardEvents();
  const otherBoards = getBoards().filter((b) => b.persistenceKey !== boardKey);
  const links = ids
    .map((id) => editor.getShape(id))
    .filter((s): s is LinkNodeShape => s?.type === "canvas-ai-link");

  return (
    <TldrawUiMenuGroup id="freemind-multi-actions">
      {links.length > 0 ? (
        // Browsers only allow one new tab per click (a popup-blocker limit no
        // page can bypass), so a multi-link selection opens just the first.
        <TldrawUiMenuItem
          id="multi-open-links"
          label={tk("Open link in new tab")}
          onSelect={() => {
            openExternalUrl(links[0]?.props.url);
          }}
        />
      ) : null}
      <TldrawUiMenuItem
        id="multi-copy-all"
        label={tk("Copy all")}
        onSelect={() => {
          // Copy through tldraw's own clipboard so each shape round-trips as
          // itself: text stays separate text, images stay images, docs stay
          // docs, all keeping their relative layout when pasted back onto a
          // canvas. The old path flattened everything into one text block.
          editor.setSelectedShapes(ids);
          copy("context-menu")
            .then(() =>
              toast(
                `Copied ${ids.length} item${ids.length === 1 ? "" : "s"}`,
                "info",
              ),
            )
            .catch(() => toast("Couldn’t copy", "error"));
        }}
      />
      <TldrawUiMenuItem
        id="multi-duplicate"
        label={tk(`Duplicate ${ids.length} items`)}
        onSelect={() => duplicateStandalone(editor, ids)}
      />
      <TldrawUiMenuSubmenu
        id="multi-duplicate-to"
        label={tk("Duplicate to")}
        disabled={otherBoards.length === 0}
      >
        <TldrawUiMenuGroup id="multi-duplicate-to-boards">
          {otherBoards.length === 0 ? (
            <TldrawUiMenuItem
              id="multi-dup-none"
              label={tk("No other canvases")}
              disabled
              onSelect={() => {}}
            />
          ) : (
            otherBoards.map((b) => (
              <TldrawUiMenuItem
                key={b.id}
                id={`multi-dup-to-${b.id}`}
                label={tk(b.title || "Untitled canvas")}
                onSelect={() => {
                  let n = 0;
                  for (const id of ids) {
                    const s = editor.getShape(id);
                    if (!s) continue;
                    queueShapeTransfer(b.persistenceKey, {
                      type: s.type,
                      props: withoutProvenance(s.type, { ...s.props }),
                    });
                    n++;
                  }
                  toast(
                    `Duplicated ${n} item${n === 1 ? "" : "s"} to "${b.title || "Untitled canvas"}"`,
                    "info",
                  );
                }}
              />
            ))
          )}
        </TldrawUiMenuGroup>
      </TldrawUiMenuSubmenu>
      <TldrawUiMenuItem
        id="multi-delete"
        label={tk(`Delete ${ids.length} items`)}
        onSelect={() => {
          editor.deleteShapes(ids);
        }}
      />
    </TldrawUiMenuGroup>
  );
}

// ---- actions -------------------------------------------------------------

/** Duplicate shapes as standalone copies (no provenance line to the source). */
function duplicateStandalone(editor: Editor, ids: TLShapeId[]): void {
  editor.duplicateShapes(ids, { x: 16, y: 16 });
  stripProvenance(editor, editor.getSelectedShapeIds());
}

async function copyShape(editor: Editor, shape: TLShape): Promise<void> {
  try {
    if (shape.type === "canvas-ai-image") {
      await copyImageToClipboard((shape as ImageNodeShape).props.dataUrl);
      toast("Image copied to clipboard", "info");
      return;
    }
    const text =
      shape.type === "canvas-ai-document"
        ? (shape as DocumentNodeShape).props.markdown
        : (shape as UploadNodeShape).props.fullText;
    await navigator.clipboard.writeText(text ?? "");
    toast("Copied to clipboard", "info");
  } catch {
    toast("Couldn’t copy", "error");
  }
}

function downloadShape(editor: Editor, shape: TLShape): void {
  if (shape.type === "canvas-ai-image") {
    const s = shape as ImageNodeShape;
    if (s.props.dataUrl) downloadHref(s.props.dataUrl, s.props.filename || "image");
    return;
  }
  if (shape.type === "canvas-ai-document") {
    const s = shape as DocumentNodeShape;
    downloadText(s.props.markdown ?? "", `${s.props.title || "document"}.md`);
    return;
  }
  // Uploaded doc: PDFs download the original bytes; text-based ones the text.
  const s = shape as UploadNodeShape;
  if (s.props.kind === "pdf" && s.props.pdfData) {
    downloadBase64(s.props.pdfData, "application/pdf", ensureExt(s.props.filename, "pdf"));
    return;
  }
  downloadText(s.props.fullText ?? "", `${baseName(s.props.filename)}.md`);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}

async function copyImageToClipboard(dataUrl: string): Promise<void> {
  if (!dataUrl) throw new Error("no image");
  // Re-encode to PNG — the Clipboard API reliably accepts image/png only.
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 1;
  canvas.height = img.naturalHeight || 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
      "image/png",
    ),
  );
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function downloadHref(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  downloadHref(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadBase64(base64: string, mime: string, filename: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  downloadHref(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename || "document";
}

function ensureExt(filename: string, ext: string): string {
  return filename.toLowerCase().endsWith(`.${ext}`)
    ? filename
    : `${baseName(filename)}.${ext}`;
}
