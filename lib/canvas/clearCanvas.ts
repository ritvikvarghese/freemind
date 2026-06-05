import type { Editor } from "tldraw";

const OUR_TYPES = new Set([
  "canvas-ai-text",
  "canvas-ai-upload",
  "canvas-ai-document",
  "canvas-ai-link", // pasted-link cards
  "canvas-ai-notes", // linked reader-notes nodes
  "bookmark", // pasted-link bookmarks (now usable as sources)
]);

/**
 * Remove every Canvas AI shape from the editor. Does not touch the API key
 * or any other localStorage state. Wrapped in a single history entry so it
 * is undoable as one step.
 */
export function clearCanvas(editor: Editor): number {
  const ids = editor
    .getCurrentPageShapes()
    .filter((s) => OUR_TYPES.has(s.type))
    .map((s) => s.id);
  if (ids.length === 0) return 0;
  editor.run(() => {
    editor.deleteShapes(ids);
  });
  return ids.length;
}
