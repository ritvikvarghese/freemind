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
import {
  DOCUMENT_NODE_DEFAULT_H,
  DOCUMENT_NODE_DEFAULT_W,
  type DocumentNodeShape,
} from "./DocumentNode";
import { ConnectHandle } from "./ConnectHandle";
import { findSlotAroundSource } from "../copyToCanvas";

/**
 * LEGACY. Reader highlights used to be mirrored onto this read-only card; they
 * now collect in an editable notes doc (a `canvas-ai-document` with `notesOf`,
 * see `appendToNotesDoc`). Existing cards still render, and are converted in
 * place into a notes doc when double-clicked or when their source gets a new
 * highlight. Nothing creates new ones.
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
    openFocus(convertNotesNode(this.editor, shape));
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

/** The notes doc collecting `uploadId`'s highlights, if one exists. */
function findNotesDoc(
  editor: Editor,
  uploadId: TLShapeId,
): DocumentNodeShape | undefined {
  return editor
    .getCurrentPageShapes()
    .find(
      (s) =>
        s.type === "canvas-ai-document" &&
        (s as DocumentNodeShape).props.notesOf === uploadId,
    ) as DocumentNodeShape | undefined;
}

function notesDocTitle(editor: Editor, uploadId: TLShapeId): string {
  const source = editor.getShape(uploadId);
  const filename =
    source && source.type === "canvas-ai-upload"
      ? (source as UploadNodeShape).props.filename
      : "";
  return filename ? `Notes from ${filename}` : "Notes";
}

/** A highlighted passage as markdown paragraph(s), with markdown syntax
 *  escaped so the quote reads back verbatim in the document. */
function quoteToMarkdown(quote: string): string {
  return quote
    .trim()
    .split(/\n\s*\n/)
    .map((para) =>
      para
        .replace(/\s+/g, " ")
        .trim()
        .replace(/([\\`*_[\]#<>|$~])/g, "\\$1"),
    )
    .filter(Boolean)
    .join("\n\n");
}

/** Highlights only (comments and manual notes stay on the source), in
 *  document order, as the body of a notes doc. */
function highlightsToMarkdown(notes: Note[]): string {
  return [...notes]
    .filter((n) => n.start >= 0 && n.quote.trim())
    .sort((a, b) => a.start - b.start)
    .map((n) => quoteToMarkdown(n.quote))
    .join("\n\n");
}

function createNotesDoc(
  editor: Editor,
  uploadId: TLShapeId,
  markdown: string,
  box: { x: number; y: number; w: number; h: number },
): TLShapeId {
  const id = createShapeId();
  editor.createShape<DocumentNodeShape>({
    id,
    type: "canvas-ai-document",
    x: box.x,
    y: box.y,
    props: {
      w: box.w,
      h: box.h,
      title: notesDocTitle(editor, uploadId),
      markdown,
      status: "done",
      notesOf: uploadId,
    },
  });
  return id;
}

/**
 * Replace a legacy notes node with an editable notes doc in the same spot,
 * seeded with the highlights in `notes` (the node's own copy by default). If
 * the upload already has a notes doc, the node is just removed and that doc's
 * id returned.
 */
export function convertNotesNode(
  editor: Editor,
  node: NotesNodeShape,
  notes: Note[] = node.props.notes,
): TLShapeId {
  const uploadId = node.props.sourceId as TLShapeId;
  let docId = uploadId ? findNotesDoc(editor, uploadId)?.id : undefined;
  editor.run(() => {
    docId ??= createNotesDoc(editor, uploadId, highlightsToMarkdown(notes), {
      x: node.x,
      y: node.y,
      w: Math.max(node.props.w, DOCUMENT_NODE_DEFAULT_W),
      h: Math.max(node.props.h, DOCUMENT_NODE_DEFAULT_H),
    });
    editor.deleteShape(node.id);
  });
  return docId!;
}

/**
 * Append a new highlight to `uploadId`'s notes doc, creating the doc beside
 * the upload on the first highlight. Text already in the doc is never touched,
 * so the user's own edits survive. A legacy notes node for the upload is
 * converted instead, seeded from `notes` (the upload's notes, this one
 * included). Call inside the same `editor.run` as the upload write for one
 * undo step.
 */
export function appendToNotesDoc(
  editor: Editor,
  uploadId: TLShapeId,
  quote: string,
  notes: Note[],
): void {
  const doc = findNotesDoc(editor, uploadId);
  if (doc) {
    const body = doc.props.markdown.trimEnd();
    const add = quoteToMarkdown(quote);
    editor.updateShape<DocumentNodeShape>({
      id: doc.id,
      type: "canvas-ai-document",
      props: { markdown: body ? `${body}\n\n${add}` : add },
    });
    return;
  }
  const legacy = editor
    .getCurrentPageShapes()
    .find(
      (s) =>
        s.type === "canvas-ai-notes" &&
        (s as NotesNodeShape).props.sourceId === uploadId,
    ) as NotesNodeShape | undefined;
  if (legacy) {
    convertNotesNode(editor, legacy, notes);
    return;
  }
  // Right of the upload when free, otherwise the first clear slot around it.
  const at = findSlotAroundSource(
    editor,
    uploadId,
    DOCUMENT_NODE_DEFAULT_W,
    DOCUMENT_NODE_DEFAULT_H,
  );
  createNotesDoc(editor, uploadId, quoteToMarkdown(quote), {
    ...at,
    w: DOCUMENT_NODE_DEFAULT_W,
    h: DOCUMENT_NODE_DEFAULT_H,
  });
}
