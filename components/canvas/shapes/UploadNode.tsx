import "./augment";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type TLBaseShape,
  type TLIndicatorPath,
  type TLResizeInfo,
  type TLShapeId,
  createShapePropsMigrationSequence,
  resizeBox,
} from "tldraw";
import {
  FileText,
  FileType,
  AlertTriangle,
  ScanText,
  MonitorPlay,
} from "lucide-react";
import { openFocus } from "@/lib/focus/openFocus";
import { isVisionPdf } from "@/lib/extract/pdf";
import { ConnectHandle } from "./ConnectHandle";

export type UploadNodeShape = TLBaseShape<
  "canvas-ai-upload",
  {
    w: number;
    h: number;
    filename: string;
    /** "pdf" | "markdown" | "youtube" */
    kind: "pdf" | "markdown" | "youtube";
    /** Truncated to first ~400 chars for preview rendering */
    preview: string;
    /** Full extracted text — what the agent will consume */
    fullText: string;
    /** Page count for PDFs, 0 otherwise */
    pageCount: number;
    /** Original file size in bytes (0 for youtube) */
    bytes: number;
    /** True when extraction yielded suspiciously little text */
    lowText: boolean;
    /** True when fullText came from Claude vision OCR (scanned PDF) */
    ocr: boolean;
    /** Origin URL for youtube transcripts ("" otherwise) */
    sourceUrl: string;
    /**
     * For scanned PDFs (no usable text layer): the raw PDF bytes as base64.
     * Sent to Claude as a vision document block in research/chat instead of an
     * extracted transcript — Anthropic's copyright filter blocks verbatim
     * reproduction of published works, but reading/analysis is fine. "" when
     * the PDF has a real text layer (we use fullText) or for non-PDFs.
     */
    pdfData: string;
  }
>;

const DEFAULT_W = 280;
const DEFAULT_H = 200;
const MIN_W = 200;
const MIN_H = 120;

export class UploadNodeUtil extends BaseBoxShapeUtil<UploadNodeShape> {
  static override type = "canvas-ai-upload" as const;

  static override props = {
    w: T.number,
    h: T.number,
    filename: T.string,
    kind: T.literalEnum("pdf", "markdown", "youtube"),
    preview: T.string,
    fullText: T.string,
    pageCount: T.number,
    bytes: T.number,
    lowText: T.boolean,
    ocr: T.boolean,
    sourceUrl: T.string,
    pdfData: T.string,
  };

  static override migrations = createShapePropsMigrationSequence({
    sequence: [
      {
        id: "com.tldraw.shape.canvas-ai-upload/1",
        up: (props) => {
          const p = props as { ocr?: boolean };
          if (typeof p.ocr !== "boolean") p.ocr = false;
        },
        down: "retired",
      },
      {
        id: "com.tldraw.shape.canvas-ai-upload/2",
        up: (props) => {
          const p = props as { sourceUrl?: string };
          if (typeof p.sourceUrl !== "string") p.sourceUrl = "";
        },
        down: "retired",
      },
      {
        id: "com.tldraw.shape.canvas-ai-upload/3",
        up: (props) => {
          const p = props as { pdfData?: string };
          if (typeof p.pdfData !== "string") p.pdfData = "";
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

  override getDefaultProps(): UploadNodeShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      filename: "untitled",
      kind: "markdown",
      preview: "",
      fullText: "",
      pageCount: 0,
      bytes: 0,
      lowText: false,
      ocr: false,
      sourceUrl: "",
      pdfData: "",
    };
  }

  override onResize(
    shape: UploadNodeShape,
    info: TLResizeInfo<UploadNodeShape>,
  ) {
    return resizeBox(shape, info, { minWidth: MIN_W, minHeight: MIN_H });
  }

  override onDoubleClick(shape: UploadNodeShape) {
    openFocus(shape.id);
  }

  override component(shape: UploadNodeShape) {
    return <UploadNodeBody shape={shape} />;
  }

  override getIndicatorPath(shape: UploadNodeShape): TLIndicatorPath {
    const p = new Path2D();
    p.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return p;
  }
}

function UploadNodeBody({ shape }: { shape: UploadNodeShape }) {
  const Icon =
    shape.props.kind === "pdf"
      ? FileText
      : shape.props.kind === "youtube"
        ? MonitorPlay
        : FileType;
  const meta =
    shape.props.kind === "pdf"
      ? `PDF · ${shape.props.pageCount} page${shape.props.pageCount === 1 ? "" : "s"}`
      : shape.props.kind === "youtube"
        ? "YouTube · transcript"
        : `Markdown · ${formatBytes(shape.props.bytes)}`;

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h }}
      className="rounded-node bg-elevated text-text-primary border border-hairline overflow-hidden flex flex-col relative"
    >
      <div className="flex items-start gap-3 px-4 pt-4">
        <Icon
          className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium truncate">
            {shape.props.filename}
          </div>
          <div className="text-[11px] text-text-tertiary mt-0.5">{meta}</div>
        </div>
      </div>

      {isVisionPdf(shape.props) ? (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-button border border-hairline px-2.5 py-1.5 text-[11px] text-text-secondary">
          <ScanText
            className="mt-0.5 h-3 w-3 shrink-0 text-text-tertiary"
            aria-hidden
          />
          <span>Scanned PDF — read as an image by the AI.</span>
        </div>
      ) : shape.props.ocr ? (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-button border border-hairline px-2.5 py-1.5 text-[11px] text-text-secondary">
          <ScanText
            className="mt-0.5 h-3 w-3 shrink-0 text-text-tertiary"
            aria-hidden
          />
          <span>Text recovered via OCR.</span>
        </div>
      ) : shape.props.lowText ? (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-button border border-hairline px-2.5 py-1.5 text-[11px] text-text-secondary">
          <AlertTriangle
            className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-error)]"
            aria-hidden
          />
          <span>Low text extracted — may be a scanned PDF.</span>
        </div>
      ) : null}

      <div className="flex-1 mt-3 px-4 pb-4 overflow-hidden">
        <div className="h-full text-[12px] leading-relaxed text-text-secondary font-mono whitespace-pre-wrap break-words overflow-hidden relative">
          {shape.props.preview || (
            <span className="text-text-tertiary italic">No preview text.</span>
          )}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
            style={{
              background:
                "linear-gradient(to bottom, transparent, var(--color-elevated))",
            }}
          />
        </div>
      </div>
      <ConnectHandle shapeId={shape.id as TLShapeId} />
    </HTMLContainer>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
