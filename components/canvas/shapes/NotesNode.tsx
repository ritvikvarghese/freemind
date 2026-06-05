import "./augment";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  createShapeId,
  resizeBox,
  type Editor,
  type TLBaseShape,
  type TLIndicatorPath,
  type TLResizeInfo,
  type TLShapeId,
} from "tldraw";
import { StickyNote } from "lucide-react";
import { openFocus } from "@/lib/focus/openFocus";
import type { Note } from "@/lib/notes/types";
import type { UploadNodeShape } from "./UploadNode";
import { ConnectHandle } from "./ConnectHandle";

/**
 * A canvas node that mirrors the reader notes of one source document. It is a
 * VIEW: the source upload shape owns the notes (single source of truth); this
 * node carries a denormalized copy so it renders, snapshots, and feeds the AI
 * without reaching back to the source (and so it survives the source being
 * deleted). The copy is kept in sync from the one write path in focus mode via
 * `syncNotesNode`. Double-clicking opens the source's focus view to edit.
 */
export type NotesNodeShape = TLBaseShape<
  "canvas-ai-notes",
  {
    w: number;
    h: number;
    /** TLShapeId of the source upload this mirrors. May dangle if it's deleted. */
    sourceId: string;
    title: string;
    notes: Note[];
  }
>;

const DEFAULT_W = 300;
const DEFAULT_H = 260;
const MIN_W = 220;
const MIN_H = 140;

const noteValidator = T.object({
  id: T.string,
  quote: T.string,
  comment: T.string,
  start: T.number,
  end: T.number,
  createdAt: T.number,
});

export class NotesNodeUtil extends BaseBoxShapeUtil<NotesNodeShape> {
  static override type = "canvas-ai-notes" as const;

  static override props = {
    w: T.number,
    h: T.number,
    sourceId: T.string,
    title: T.string,
    notes: T.arrayOf(noteValidator),
  };

  override canEdit() {
    return false;
  }

  override canResize() {
    return true;
  }

  override isAspectRatioLocked() {
    return false;
  }

  override getDefaultProps(): NotesNodeShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      sourceId: "",
      title: "Notes",
      notes: [],
    };
  }

  override onResize(shape: NotesNodeShape, info: TLResizeInfo<NotesNodeShape>) {
    return resizeBox(shape, info, { minWidth: MIN_W, minHeight: MIN_H });
  }

  override onDoubleClick(shape: NotesNodeShape) {
    if (shape.props.sourceId) openFocus(shape.props.sourceId as TLShapeId);
  }

  override component(shape: NotesNodeShape) {
    return <NotesNodeBody shape={shape} />;
  }

  override getIndicatorPath(shape: NotesNodeShape): TLIndicatorPath {
    const p = new Path2D();
    p.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return p;
  }
}

function NotesNodeBody({ shape }: { shape: NotesNodeShape }) {
  const notes = [...shape.props.notes].sort((a, b) => a.start - b.start);
  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h }}
      className="relative flex flex-col overflow-hidden rounded-node border border-hairline bg-elevated text-text-primary"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
        <StickyNote
          className="h-3.5 w-3.5 shrink-0 text-text-secondary"
          aria-hidden
        />
        <div className="min-w-0 flex-1 truncate text-[12px] font-medium">
          {shape.props.title}
        </div>
        <span className="text-[11px] text-text-tertiary">{notes.length}</span>
      </div>
      <div className="relative flex-1 overflow-hidden px-4 py-3">
        <div className="flex flex-col gap-2.5">
          {notes.length === 0 ? (
            <span className="text-[12px] italic text-text-tertiary">
              No notes yet.
            </span>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="text-[12px] leading-relaxed">
                {n.quote.trim() ? (
                  <span className="box-decoration-clone rounded-[2px] bg-[#fde68a] px-0.5 text-[#1a1a1a]">
                    {n.quote}
                  </span>
                ) : null}
                {n.comment.trim() ? (
                  <div className={n.quote.trim() ? "mt-1 text-text-secondary" : "text-text-secondary"}>
                    {n.comment}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6"
          style={{
            background:
              "linear-gradient(to bottom, transparent, var(--color-elevated))",
          }}
        />
      </div>
      <ConnectHandle shapeId={shape.id as TLShapeId} />
    </HTMLContainer>
  );
}

/**
 * Mirror `notes` onto the notes node for `sourceId`, creating it on first note
 * just to the right of the source. Called from the single note-write path in
 * focus mode (wrap with the source update in one `editor.run` for clean undo).
 */
export function syncNotesNode(
  editor: Editor,
  sourceId: TLShapeId,
  notes: Note[],
): void {
  const existing = editor
    .getCurrentPageShapes()
    .find(
      (s) =>
        s.type === "canvas-ai-notes" &&
        (s as NotesNodeShape).props.sourceId === sourceId,
    ) as NotesNodeShape | undefined;

  const source = editor.getShape(sourceId);
  const filename =
    source && source.type === "canvas-ai-upload"
      ? (source as UploadNodeShape).props.filename
      : "";
  const title = filename ? `Notes from ${filename}` : "Notes";

  if (existing) {
    editor.updateShape<NotesNodeShape>({
      id: existing.id,
      type: "canvas-ai-notes",
      props: { notes, title },
    });
    return;
  }
  if (notes.length === 0) return;

  const bounds = editor.getShapePageBounds(sourceId);
  editor.createShape<NotesNodeShape>({
    id: createShapeId(),
    type: "canvas-ai-notes",
    x: bounds ? bounds.maxX + 72 : 0,
    y: bounds ? bounds.y : 0,
    props: { w: DEFAULT_W, h: DEFAULT_H, sourceId, title, notes },
  });
}
