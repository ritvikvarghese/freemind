import "./augment";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type TLBaseShape,
  type TLIndicatorPath,
  type TLResizeInfo,
  createShapePropsMigrationSequence,
  resizeBox,
} from "tldraw";
import {
  Loader2,
  AlertTriangle,
  Square,
  FileText,
  Globe,
  RefreshCw,
} from "lucide-react";
import { MarkdownView } from "@/components/MarkdownView";
import { useMemo } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { abortRun } from "@/lib/agent/abortRegistry";
import { openFocus } from "@/lib/focus/openFocus";
import { sourceText } from "@/lib/agent/buildContext";
import type { Comment } from "@/lib/storage/commentTypes";
import type { TextNodeShape } from "./TextNode";
import type { UploadNodeShape } from "./UploadNode";
import { ConnectHandle } from "./ConnectHandle";

export type SourceImagePayload = {
  /** Full `data:<mime>;base64,...` URL — re-sent to Claude vision in chat. */
  dataUrl: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
};

export type SourceSnapshot = {
  id: string;
  kind:
    | "text"
    | "upload-pdf"
    | "upload-markdown"
    | "document"
    | "image"
    | "youtube";
  title: string;
  text: string;
  capturedAt: number;
  /** Present only for image sources — the picture itself, for vision. */
  image?: SourceImagePayload;
  /** Present only for scanned-PDF sources — raw PDF bytes (base64), for vision. */
  pdf?: { data: string };
};

export type DocumentNodeShape = TLBaseShape<
  "canvas-ai-document",
  {
    w: number;
    h: number;
    title: string;
    markdown: string;
    status: "researching" | "streaming" | "done" | "stopped" | "error";
    /** The model's streamed chain-of-thought (extended thinking), shown as a
     * collapsible "Thinking" section while the document is generated. Empty for
     * hand-made docs and for runs without thinking enabled. */
    thinking: string;
    userPrompt: string;
    sourceIds: string[];
    sourceSnapshots: { id: string; len: number; head: string }[];
    sources: SourceSnapshot[];
    comments: Comment[];
    sourcesUsed: { query: string; urls: string[] }[];
    errorMessage: string;
    /** External "watch/source" link (e.g. the YouTube video this transcript
     * came from). Empty for hand-made or research documents. */
    sourceUrl: string;
  }
>;

export const DOCUMENT_NODE_DEFAULT_W = 440;
export const DOCUMENT_NODE_DEFAULT_H = 320;
const MIN_W = 320;
const MIN_H = 200;

export class DocumentNodeUtil extends BaseBoxShapeUtil<DocumentNodeShape> {
  static override type = "canvas-ai-document" as const;

  static override props = {
    w: T.number,
    h: T.number,
    title: T.string,
    markdown: T.string,
    status: T.literalEnum(
      "researching",
      "streaming",
      "done",
      "stopped",
      "error",
    ),
    thinking: T.string,
    userPrompt: T.string,
    sourceIds: T.arrayOf(T.string),
    sourceSnapshots: T.arrayOf(
      T.object({
        id: T.string,
        len: T.number,
        head: T.string,
      }),
    ),
    sources: T.arrayOf(
      T.object({
        id: T.string,
        kind: T.literalEnum(
          "text",
          "upload-pdf",
          "upload-markdown",
          "document",
          "image",
          "youtube",
        ),
        title: T.string,
        text: T.string,
        capturedAt: T.number,
        image: T.optional(
          T.object({
            dataUrl: T.string,
            mediaType: T.literalEnum(
              "image/jpeg",
              "image/png",
              "image/gif",
              "image/webp",
            ),
          }),
        ),
        pdf: T.optional(T.object({ data: T.string })),
      }),
    ),
    comments: T.arrayOf(
      T.object({
        id: T.string,
        anchor_before: T.string,
        anchor_text: T.string,
        anchor_after: T.string,
        body: T.string,
        createdAt: T.number,
        resolved: T.boolean,
      }),
    ),
    sourcesUsed: T.arrayOf(
      T.object({
        query: T.string,
        urls: T.arrayOf(T.string),
      }),
    ),
    errorMessage: T.string,
    sourceUrl: T.string,
  };

  static override migrations = createShapePropsMigrationSequence({
    sequence: [
      {
        id: "com.tldraw.shape.canvas-ai-document/1",
        up: (props) => {
          const p = props as { sources?: SourceSnapshot[] };
          if (!Array.isArray(p.sources)) p.sources = [];
        },
        down: "retired",
      },
      {
        id: "com.tldraw.shape.canvas-ai-document/2",
        up: (props) => {
          const p = props as { comments?: Comment[] };
          if (!Array.isArray(p.comments)) p.comments = [];
        },
        down: "retired",
      },
      {
        id: "com.tldraw.shape.canvas-ai-document/3",
        up: (props) => {
          const p = props as { sourceUrl?: string };
          if (typeof p.sourceUrl !== "string") p.sourceUrl = "";
        },
        down: "retired",
      },
      {
        id: "com.tldraw.shape.canvas-ai-document/4",
        up: (props) => {
          const p = props as { thinking?: string };
          if (typeof p.thinking !== "string") p.thinking = "";
        },
        down: "retired",
      },
    ],
  });

  override canEdit() {
    return false;
  }

  override canResize() {
    return true;
  }

  override isAspectRatioLocked() {
    return false;
  }

  override getDefaultProps(): DocumentNodeShape["props"] {
    return {
      w: DOCUMENT_NODE_DEFAULT_W,
      h: DOCUMENT_NODE_DEFAULT_H,
      title: "",
      markdown: "",
      status: "researching",
      thinking: "",
      userPrompt: "",
      sourceIds: [],
      sourceSnapshots: [],
      sources: [],
      comments: [],
      sourcesUsed: [],
      errorMessage: "",
      sourceUrl: "",
    };
  }

  override onResize(
    shape: DocumentNodeShape,
    info: TLResizeInfo<DocumentNodeShape>,
  ) {
    return resizeBox(shape, info, { minWidth: MIN_W, minHeight: MIN_H });
  }

  override onDoubleClick(shape: DocumentNodeShape) {
    openFocus(shape.id);
  }

  override component(shape: DocumentNodeShape) {
    return <DocumentNodeBody shape={shape} />;
  }

  override getIndicatorPath(shape: DocumentNodeShape): TLIndicatorPath {
    const p = new Path2D();
    p.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return p;
  }
}

function DocumentNodeBody({ shape }: { shape: DocumentNodeShape }) {
  const editor = useEditor();
  const { status, title, markdown, thinking, errorMessage, sourcesUsed, sourceSnapshots } =
    shape.props;
  const isInProgress = status === "researching" || status === "streaming";
  const sourceCount = useMemo(
    () => sourcesUsed.reduce((acc, s) => acc + s.urls.length, 0),
    [sourcesUsed],
  );

  // Compare each snapshot against the current source. Marks the doc stale if
  // any feeding source has been edited or deleted since this run was launched.
  const isStale = useValue(
    `canvas-ai-stale-${shape.id}`,
    () => {
      if (isInProgress || sourceSnapshots.length === 0) return false;
      for (const snap of sourceSnapshots) {
        const src = editor.getShape(snap.id as TLShapeId) as
          | TextNodeShape
          | UploadNodeShape
          | DocumentNodeShape
          | undefined;
        if (!src) return true; // source deleted
        const text = sourceText(src);
        if (text.length !== snap.len) return true;
        if (text.slice(0, 200) !== snap.head) return true;
      }
      return false;
    },
    [editor, shape.id, isInProgress, sourceSnapshots],
  );

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h }}
      className="rounded-node bg-elevated text-text-primary border border-hairline overflow-hidden flex flex-col relative"
    >
      <div className="flex items-start gap-3 px-5 pt-5">
        <FileText
          className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <div className="min-w-0 flex-1 text-[14px] font-medium tracking-tight truncate">
              {title || (isInProgress ? "Researching…" : "Untitled document")}
            </div>
            <StatusPill status={status} />
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-text-tertiary">
            {sourceCount > 0 ? (
              <span className="flex items-center gap-1">
                <Globe className="h-3 w-3" aria-hidden />
                <span>
                  {sourceCount} web source{sourceCount === 1 ? "" : "s"}
                </span>
              </span>
            ) : null}
            {isStale ? (
              <span
                className="flex items-center gap-1"
                title="One or more of the sources that fed this document have been edited or deleted."
                style={{ color: "var(--color-error)" }}
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                <span>sources changed</span>
              </span>
            ) : null}
          </div>
        </div>
        {isInProgress ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              abortRun(shape.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title="Cancel"
            aria-label="Cancel"
            style={{ pointerEvents: "auto" }}
            className="shrink-0 h-7 w-7 grid place-items-center rounded-button text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors duration-100"
          >
            <Square className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="relative flex-1 mt-3 px-5 pb-5 overflow-hidden">
        {status === "error" ? (
          <div className="flex items-start gap-2 rounded-button border border-hairline px-3 py-2 text-[12px] text-text-secondary">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              style={{ color: "var(--color-error)" }}
              aria-hidden
            />
            <span>{errorMessage || "Something went wrong."}</span>
          </div>
        ) : (
          <>
            <div className="h-full overflow-hidden text-[13px] leading-relaxed text-text-primary canvas-ai-doc-preview">
              {markdown ? (
                <MarkdownView>{markdown}</MarkdownView>
              ) : thinking ? (
                // Live chain-of-thought before the document text starts.
                <div className="space-y-1.5">
                  <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-tertiary">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Thinking</span>
                  </span>
                  <div className="whitespace-pre-wrap text-[12px] leading-relaxed italic text-text-tertiary">
                    {thinking}
                  </div>
                </div>
              ) : isInProgress ? (
                <span className="inline-flex items-center gap-2 text-text-tertiary">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>thinking…</span>
                </span>
              ) : (
                <span className="text-text-tertiary">No content.</span>
              )}
            </div>
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
              style={{
                background:
                  "linear-gradient(to bottom, transparent, var(--color-elevated))",
              }}
            />
          </>
        )}
      </div>
      <ConnectHandle shapeId={shape.id as TLShapeId} />
    </HTMLContainer>
  );
}

function StatusPill({
  status,
}: {
  status: DocumentNodeShape["props"]["status"];
}) {
  const label = labelFor(status);
  if (!label) return null;
  const color =
    status === "error"
      ? "var(--color-error)"
      : status === "stopped"
        ? "var(--color-text-tertiary)"
        : "var(--color-text-secondary)";
  return (
    <span
      className="shrink-0 text-[10px] uppercase tracking-[0.06em] font-medium"
      style={{ color }}
    >
      {label}
    </span>
  );
}

function labelFor(status: DocumentNodeShape["props"]["status"]): string {
  switch (status) {
    case "researching":
      return "researching";
    case "streaming":
      return "writing";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
    case "done":
      return "";
  }
}
