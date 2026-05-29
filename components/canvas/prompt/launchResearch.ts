import {
  createShapeId,
  type Editor,
  type TLShapeId,
} from "tldraw";
import type { DocumentNodeShape } from "../shapes/DocumentNode";
import { DOCUMENT_NODE_DEFAULT_W, DOCUMENT_NODE_DEFAULT_H } from "../shapes/DocumentNode";
import { sourceText, type SourceShape } from "@/lib/agent/buildContext";
import { runResearch } from "@/lib/agent/runResearch";
import type { AgentMode } from "@/lib/agent/modes";

const PLACEMENT_GAP = 32;
const PLACEMENT_STEP = 32;
const PLACEMENT_MAX_STEPS = 20;

/**
 * Pick a free spot for a new DocumentNode at PLACEMENT_GAP px right of the
 * source bounds, then spiral outward in 32px steps if it collides with any
 * existing shape.
 */
function placeDocument(
  editor: Editor,
  sourceBounds: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  const docW = DOCUMENT_NODE_DEFAULT_W;
  const docH = DOCUMENT_NODE_DEFAULT_H;
  const baseX = sourceBounds.x + sourceBounds.w + PLACEMENT_GAP;
  const baseY = sourceBounds.y + sourceBounds.h / 2 - docH / 2;

  const others = editor.getCurrentPageShapes();

  const overlaps = (x: number, y: number) =>
    others.some((s) => {
      const b = editor.getShapePageBounds(s.id);
      if (!b) return false;
      return !(
        x + docW < b.minX ||
        x > b.maxX ||
        y + docH < b.minY ||
        y > b.maxY
      );
    });

  // Clockwise spiral: right, down, left, up
  const dirs: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  let x = baseX;
  let y = baseY;
  if (!overlaps(x, y)) return { x, y };

  for (let i = 0; i < PLACEMENT_MAX_STEPS; i++) {
    const [dx, dy] = dirs[i % 4];
    const reps = Math.floor(i / 2) + 1;
    for (let r = 0; r < reps; r++) {
      x += dx * PLACEMENT_STEP;
      y += dy * PLACEMENT_STEP;
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return { x: baseX, y: baseY };
}

export function launchResearch(
  editor: Editor,
  sources: SourceShape[],
  userPrompt: string,
  mode: AgentMode,
): TLShapeId {
  const bounds = editor.getSelectionPageBounds() ?? {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  };
  const placement = placeDocument(editor, {
    x: bounds.x,
    y: bounds.y,
    w: "w" in bounds ? bounds.w : 0,
    h: "h" in bounds ? bounds.h : 0,
  });

  const docShapeId = createShapeId();
  const sourceIds = sources.map((s) => s.id as string);
  const sourceSnapshots = sources.map((s) => {
    const text = sourceText(s);
    return {
      id: s.id as string,
      len: text.length,
      head: text.slice(0, 200),
    };
  });

  editor.createShape<DocumentNodeShape>({
    id: docShapeId,
    type: "canvas-ai-document",
    x: placement.x,
    y: placement.y,
    props: {
      w: DOCUMENT_NODE_DEFAULT_W,
      h: DOCUMENT_NODE_DEFAULT_H,
      title: "",
      markdown: "",
      status: "researching",
      userPrompt,
      sourceIds,
      sourceSnapshots,
      sourcesUsed: [],
      errorMessage: "",
    },
  });

  // Select the new document so the user can see it land and the floating prompt
  // dismisses (selection has switched away from sources).
  editor.select(docShapeId);

  // Fire and forget — runResearch owns the lifecycle.
  void runResearch({ editor, docShapeId, sources, userPrompt, mode });

  return docShapeId;
}

