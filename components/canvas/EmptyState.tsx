"use client";

import { useEditor, useValue } from "tldraw";

const OUR_TYPES = new Set([
  "canvas-ai-text",
  "canvas-ai-upload",
  "canvas-ai-image",
  "canvas-ai-document",
  "canvas-ai-link", // pasted-link card
  "text", // tldraw native text shape (T toolbar button)
  "note", // tldraw native sticky note (toolbar button)
  "image", // tldraw native image shape (legacy / paste fallback)
  "bookmark", // tldraw native bookmark shape (pasted link)
]);

export function EmptyState() {
  const editor = useEditor();
  const hasOurShapes = useValue(
    "canvas-ai-has-shapes",
    () => editor.getCurrentPageShapes().some((s) => OUR_TYPES.has(s.type)),
    [editor],
  );

  if (hasOurShapes) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-10 grid place-items-center">
      <div className="text-text-tertiary text-[13px] tracking-tight text-center px-4">
        Drop a PDF or markdown file, or click{" "}
        <span className="text-text-secondary">T</span> in the toolbar to add a
        text note.
      </div>
    </div>
  );
}
