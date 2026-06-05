import type { Editor, TLShapeId } from "tldraw";
import type { DocumentNodeShape } from "@/components/canvas/shapes/DocumentNode";
import type { NotesNodeShape } from "@/components/canvas/shapes/NotesNode";

/** A directed provenance link: a document/notes node was built FROM a source. */
export type ProvEdge = { from: TLShapeId; to: TLShapeId };

/**
 * Every provenance edge on the current page. The relationship is stored on the
 * downstream node (a document knows its `sourceIds`; a notes node knows its
 * `sourceId`), so `from` is always the doc/notes node and `to` the source.
 * Only edges whose BOTH endpoints still exist are returned — a deleted source
 * leaves no dangling edge. Callers that want "everything connected to X" should
 * treat edges as UNDIRECTED (match either endpoint), so selecting a source
 * reveals its docs/notes just as selecting a doc reveals its sources.
 */
export function getProvenanceEdges(editor: Editor): ProvEdge[] {
  const present = editor.getCurrentPageShapeIds();
  const out: ProvEdge[] = [];
  for (const s of editor.getCurrentPageShapes()) {
    if (s.type === "canvas-ai-document") {
      for (const src of (s as DocumentNodeShape).props.sourceIds) {
        if (present.has(src as TLShapeId)) out.push({ from: s.id, to: src as TLShapeId });
      }
    } else if (s.type === "canvas-ai-notes") {
      const sid = (s as NotesNodeShape).props.sourceId as TLShapeId;
      if (sid && present.has(sid)) out.push({ from: s.id, to: sid });
    }
  }
  return out;
}
