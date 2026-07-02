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
import { Sparkles } from "lucide-react";

// An agent-rendered design preview: a full HTML document shown in a sandboxed
// iframe on the canvas, so generated layouts/animations render live next to the
// reference material they came from. Created via the local canvas bridge
// (a write with type "canvas-ai-design-preview" and props.html). Display-only,
// not an AI source.
export type DesignPreviewShape = TLBaseShape<
  "canvas-ai-design-preview",
  {
    w: number;
    h: number;
    /** Full HTML document rendered in a sandboxed iframe. */
    html: string;
    /** Label shown in the card header. */
    title: string;
  }
>;

export const DESIGN_PREVIEW_DEFAULT_W = 420;
export const DESIGN_PREVIEW_DEFAULT_H = 320;
const MIN_W = 200;
const MIN_H = 160;

export class DesignPreviewNodeUtil extends BaseBoxShapeUtil<DesignPreviewShape> {
  static override type = "canvas-ai-design-preview" as const;

  static override props = {
    w: T.number,
    h: T.number,
    html: T.string,
    title: T.string,
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
    return false;
  }

  override getDefaultProps(): DesignPreviewShape["props"] {
    return {
      w: DESIGN_PREVIEW_DEFAULT_W,
      h: DESIGN_PREVIEW_DEFAULT_H,
      html: "",
      title: "",
    };
  }

  override onResize(shape: DesignPreviewShape, info: TLResizeInfo<DesignPreviewShape>) {
    return resizeBox(shape, info, { minWidth: MIN_W, minHeight: MIN_H });
  }

  override component(shape: DesignPreviewShape) {
    return <DesignPreviewBody shape={shape} />;
  }

  override getIndicatorPath(shape: DesignPreviewShape): TLIndicatorPath {
    const p = new Path2D();
    p.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return p;
  }
}

function DesignPreviewBody({ shape }: { shape: DesignPreviewShape }) {
  const { w, h, html, title } = shape.props;

  return (
    <HTMLContainer
      style={{ width: w, height: h }}
      className="rounded-node bg-elevated text-text-primary border border-hairline overflow-hidden flex flex-col relative"
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-hairline px-3 py-1.5 text-[10px] text-text-tertiary">
        <Sparkles className="h-3 w-3" aria-hidden />
        <span className="truncate">{title || "Design preview"}</span>
      </div>
      <div className="min-h-0 flex-1 bg-white">
        {html ? (
          // Sandboxed: scripts run (CSS/JS animations play) but cannot reach the
          // parent — no allow-same-origin. pointer-events:none keeps the shape
          // draggable/selectable on the canvas instead of the iframe swallowing
          // clicks.
          <iframe
            srcDoc={html}
            sandbox="allow-scripts"
            title={title || "Design preview"}
            style={{
              width: "100%",
              height: "100%",
              border: 0,
              pointerEvents: "none",
            }}
          />
        ) : (
          <div className="grid h-full place-items-center text-[11px] text-text-tertiary">
            Empty preview
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}
