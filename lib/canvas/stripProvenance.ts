"use client";

import type { Editor, TLShapeId, TLShapePartial } from "tldraw";

// AI artifacts link to their source in props (canvas-ai-document.sourceIds[],
// canvas-ai-notes.sourceId), which the provenance overlay draws as a line. A
// COPY is a standalone artifact, so we clear those refs on copy/paste/duplicate
// so no line is drawn. The original keeps its refs (and its line).

/** A copy of `props` with any provenance refs cleared. */
export function withoutProvenance(
  type: string,
  props: Record<string, unknown>,
): Record<string, unknown> {
  if (type === "canvas-ai-document" && Array.isArray(props.sourceIds)) {
    return { ...props, sourceIds: [] };
  }
  if (type === "canvas-ai-notes" && typeof props.sourceId === "string") {
    return { ...props, sourceId: "" };
  }
  return props;
}

/** Clear provenance refs on already-created shapes (paste / duplicate). */
export function stripProvenance(
  editor: Editor,
  ids: Iterable<TLShapeId>,
): void {
  const patches: TLShapePartial[] = [];
  for (const id of ids) {
    const sh = editor.getShape(id);
    if (!sh) continue;
    if (sh.type === "canvas-ai-document") {
      const refs = (sh.props as { sourceIds?: unknown }).sourceIds;
      if (Array.isArray(refs) && refs.length > 0) {
        patches.push({
          id: sh.id,
          type: "canvas-ai-document",
          props: { sourceIds: [] },
        } as TLShapePartial);
      }
    } else if (sh.type === "canvas-ai-notes") {
      const ref = (sh.props as { sourceId?: unknown }).sourceId;
      if (typeof ref === "string" && ref) {
        patches.push({
          id: sh.id,
          type: "canvas-ai-notes",
          props: { sourceId: "" },
        } as TLShapePartial);
      }
    }
  }
  if (patches.length > 0) {
    editor.run(() => editor.updateShapes(patches), { history: "ignore" });
  }
}
