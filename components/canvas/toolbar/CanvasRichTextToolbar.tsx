"use client";

import { DefaultRichTextToolbar, useEditor, useValue } from "tldraw";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { EditorToolbarContent } from "@/components/focus/editor/BubbleToolbar";

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
          lists, link. */}
      <EditorToolbarContent
        editor={textEditor as unknown as TiptapEditor}
        showHeadings={false}
      />
    </DefaultRichTextToolbar>
  );
}
