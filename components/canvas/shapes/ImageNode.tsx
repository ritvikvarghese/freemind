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
import { Loader2, ScanText, AlertTriangle } from "lucide-react";
import type { ImageMediaType } from "@/lib/extract/ocr";
import { openFocus } from "@/lib/focus/openFocus";
import { ConnectHandle } from "./ConnectHandle";

export type ImageNodeShape = TLBaseShape<
  "canvas-ai-image",
  {
    w: number;
    h: number;
    filename: string;
    /** Downscaled, base64 data URL — the bytes sent to Claude vision. */
    dataUrl: string;
    mediaType: ImageMediaType;
    /** Natural dimensions of the (downscaled) image, for aspect-ratio resize. */
    naturalW: number;
    naturalH: number;
    bytes: number;
    /** Text transcribed from the image via OCR (empty if none / pending). */
    ocrText: string;
    /** OCR lifecycle: idle (no key) | ocr (running) | done | error */
    status: "idle" | "ocr" | "done" | "error";
  }
>;

export const IMAGE_NODE_DEFAULT_W = 280;
const MIN_W = 120;
const MIN_H = 120;

export class ImageNodeUtil extends BaseBoxShapeUtil<ImageNodeShape> {
  static override type = "canvas-ai-image" as const;

  static override props = {
    w: T.number,
    h: T.number,
    filename: T.string,
    dataUrl: T.string,
    mediaType: T.literalEnum(
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ),
    naturalW: T.number,
    naturalH: T.number,
    bytes: T.number,
    ocrText: T.string,
    status: T.literalEnum("idle", "ocr", "done", "error"),
  };

  static override migrations = createShapePropsMigrationSequence({
    sequence: [],
  });

  override canEdit() {
    return false;
  }

  override canResize() {
    return true;
  }

  override isAspectRatioLocked() {
    return true;
  }

  override getDefaultProps(): ImageNodeShape["props"] {
    return {
      w: IMAGE_NODE_DEFAULT_W,
      h: IMAGE_NODE_DEFAULT_W,
      filename: "image",
      dataUrl: "",
      mediaType: "image/jpeg",
      naturalW: IMAGE_NODE_DEFAULT_W,
      naturalH: IMAGE_NODE_DEFAULT_W,
      bytes: 0,
      ocrText: "",
      status: "idle",
    };
  }

  override onResize(shape: ImageNodeShape, info: TLResizeInfo<ImageNodeShape>) {
    return resizeBox(shape, info, { minWidth: MIN_W, minHeight: MIN_H });
  }

  override onDoubleClick(shape: ImageNodeShape) {
    openFocus(shape.id);
  }

  override component(shape: ImageNodeShape) {
    return <ImageNodeBody shape={shape} />;
  }

  override getIndicatorPath(shape: ImageNodeShape): TLIndicatorPath {
    const p = new Path2D();
    p.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return p;
  }
}

function ImageNodeBody({ shape }: { shape: ImageNodeShape }) {
  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h }}
      className="rounded-node bg-elevated border border-hairline overflow-hidden relative"
    >
      {shape.props.dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shape.props.dataUrl}
          alt={shape.props.filename}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-text-tertiary text-[11px]">
          No image
        </div>
      )}

      <StatusBadge status={shape.props.status} hasText={!!shape.props.ocrText} />
      <ConnectHandle shapeId={shape.id as TLShapeId} />
    </HTMLContainer>
  );
}

function StatusBadge({
  status,
  hasText,
}: {
  status: ImageNodeShape["props"]["status"];
  hasText: boolean;
}) {
  if (status === "ocr") {
    return (
      <Badge>
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Reading text…
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge>
        <AlertTriangle
          className="h-3 w-3 text-[var(--color-error)]"
          aria-hidden
        />
        OCR failed
      </Badge>
    );
  }
  if (status === "done" && hasText) {
    return (
      <Badge>
        <ScanText className="h-3 w-3" aria-hidden />
        Text
      </Badge>
    );
  }
  return null;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute left-2 top-2 flex items-center gap-1 rounded-button bg-elevated/90 border border-hairline px-1.5 py-0.5 text-[10px] text-text-secondary backdrop-blur-sm">
      {children}
    </div>
  );
}
