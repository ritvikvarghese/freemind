import type { Editor } from "@tiptap/core";

/**
 * Markdown is the canonical persisted format. Tiptap is only the editing
 * surface. These wrappers keep the rest of the app from depending on Tiptap's
 * markdown extension API directly — swap implementations here if we ever
 * change the bidirectional layer.
 */

export function serializeTiptapToMarkdown(editor: Editor): string {
  return editor.getMarkdown();
}

export function setMarkdownContent(
  editor: Editor,
  markdown: string,
  opts: { emitUpdate?: boolean } = {},
): void {
  editor.commands.setContent(markdown, {
    contentType: "markdown",
    emitUpdate: opts.emitUpdate ?? false,
  });
}
