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
import { Loader2, AlertTriangle, Link as LinkIcon } from "lucide-react";
import { ConnectHandle } from "./ConnectHandle";

export type LinkNodeShape = TLBaseShape<
  "canvas-ai-link",
  {
    w: number;
    h: number;
    url: string;
    title: string;
    description: string;
    /** og:image URL (remote, display-only). */
    image: string;
    /** Hostname / og:site_name shown in the card footer. */
    siteName: string;
    /** Scraped page body text — the AI context. Empty until the fetch lands. */
    text: string;
    status: "loading" | "done" | "error";
  }
>;

export const LINK_NODE_DEFAULT_W = 300;
export const LINK_NODE_DEFAULT_H = 260;
const MIN_W = 220;
const MIN_H = 120;

export class LinkNodeUtil extends BaseBoxShapeUtil<LinkNodeShape> {
  static override type = "canvas-ai-link" as const;

  static override props = {
    w: T.number,
    h: T.number,
    url: T.string,
    title: T.string,
    description: T.string,
    image: T.string,
    siteName: T.string,
    text: T.string,
    status: T.literalEnum("loading", "done", "error"),
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

  override getDefaultProps(): LinkNodeShape["props"] {
    return {
      w: LINK_NODE_DEFAULT_W,
      h: LINK_NODE_DEFAULT_H,
      url: "",
      title: "",
      description: "",
      image: "",
      siteName: "",
      text: "",
      status: "loading",
    };
  }

  override onResize(shape: LinkNodeShape, info: TLResizeInfo<LinkNodeShape>) {
    return resizeBox(shape, info, { minWidth: MIN_W, minHeight: MIN_H });
  }

  // Open the original page in a new tab on double-click.
  override onDoubleClick(shape: LinkNodeShape) {
    if (shape.props.url && typeof window !== "undefined") {
      window.open(shape.props.url, "_blank", "noopener,noreferrer");
    }
  }

  override component(shape: LinkNodeShape) {
    return <LinkNodeBody shape={shape} />;
  }

  override getIndicatorPath(shape: LinkNodeShape): TLIndicatorPath {
    const p = new Path2D();
    p.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return p;
  }
}

function LinkNodeBody({ shape }: { shape: LinkNodeShape }) {
  const { url, title, description, image, siteName, status } = shape.props;
  const host = siteName || hostnameOf(url);

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h }}
      className="rounded-node bg-elevated text-text-primary border border-hairline overflow-hidden flex flex-col relative"
    >
      <div className="relative w-full shrink-0 overflow-hidden bg-surface-hover" style={{ height: "52%" }}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-text-tertiary">
            <LinkIcon className="h-6 w-6" aria-hidden />
          </div>
        )}
        {status === "loading" ? (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-button bg-elevated/90 border border-hairline px-1.5 py-0.5 text-[10px] text-text-secondary backdrop-blur-sm">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Loading…
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2.5">
        <div className="line-clamp-2 text-[13px] font-medium leading-snug tracking-tight">
          {title || url || "Untitled link"}
        </div>
        {description ? (
          <div className="line-clamp-2 text-[11px] leading-snug text-text-secondary">
            {description}
          </div>
        ) : null}
        <div className="mt-auto flex items-center gap-1.5 pt-1 text-[10px] text-text-tertiary">
          {status === "error" ? (
            <>
              <AlertTriangle className="h-3 w-3 text-[var(--color-error)]" aria-hidden />
              <span>Couldn&apos;t read page — link saved</span>
            </>
          ) : (
            <>
              <LinkIcon className="h-3 w-3" aria-hidden />
              <span className="truncate">{host}</span>
            </>
          )}
        </div>
      </div>

      <ConnectHandle shapeId={shape.id as TLShapeId} />
    </HTMLContainer>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
