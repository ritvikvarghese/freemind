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
  useEditor,
  useValue,
} from "tldraw";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { ConnectHandle } from "./ConnectHandle";

export type TextNodeShape = TLBaseShape<
  "canvas-ai-text",
  {
    w: number;
    h: number;
    text: string;
  }
>;

const DEFAULT_W = 280;
const DEFAULT_H = 56;
const MIN_W = 160;
const MIN_H = 56;
const MAX_AUTO_H = 1200;
const PADDING_Y = 32; // 16px top + 16px bottom (p-4)
const EMPTY_HEIGHT = 56;

export class TextNodeUtil extends BaseBoxShapeUtil<TextNodeShape> {
  static override type = "canvas-ai-text" as const;

  static override props = {
    w: T.number,
    h: T.number,
    text: T.string,
  };

  static override migrations = createShapePropsMigrationSequence({
    sequence: [],
  });

  override canEdit() {
    return true;
  }

  override canResize() {
    return true;
  }

  override isAspectRatioLocked() {
    return false;
  }

  override getDefaultProps(): TextNodeShape["props"] {
    return { w: DEFAULT_W, h: DEFAULT_H, text: "" };
  }

  override onResize(shape: TextNodeShape, info: TLResizeInfo<TextNodeShape>) {
    return resizeBox(shape, info, { minWidth: MIN_W, minHeight: MIN_H });
  }

  override onDoubleClick(shape: TextNodeShape) {
    this.editor.setEditingShape(shape.id);
  }

  override component(shape: TextNodeShape) {
    return <TextNodeBody shape={shape} />;
  }

  override getIndicatorPath(shape: TextNodeShape): TLIndicatorPath {
    const p = new Path2D();
    p.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return p;
  }
}

function TextNodeBody({ shape }: { shape: TextNodeShape }) {
  const editor = useEditor();
  const isEditing = useValue(
    "is-editing",
    () => editor.getEditingShapeId() === shape.id,
    [editor, shape.id],
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  // Measure rendered text and auto-fit shape height. Width stays user-controlled
  // (resizable), height follows content.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const measured = el.offsetHeight;
    const target = clampHeight(measured + PADDING_Y);
    if (Math.abs(target - shape.props.h) > 1) {
      editor.updateShape<TextNodeShape>({
        id: shape.id as TLShapeId,
        type: "canvas-ai-text",
        props: { h: target },
      });
    }
  }, [editor, shape.id, shape.props.h, shape.props.text, shape.props.w]);

  const updateText = useCallback(
    (text: string) => {
      editor.updateShape<TextNodeShape>({
        id: shape.id as TLShapeId,
        type: "canvas-ai-text",
        props: { text },
      });
    },
    [editor, shape.id],
  );

  // Same font/wrap/padding rules as the textarea / read view, used to measure
  // content height off-screen without affecting layout.
  const measurerStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    visibility: "hidden",
    pointerEvents: "none",
    width: shape.props.w,
    padding: "0 16px",
    boxSizing: "border-box",
    fontSize: 13,
    lineHeight: 1.6,
    fontFamily: "var(--font-sans)",
    letterSpacing: "-0.01em",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h }}
      className="rounded-node bg-elevated text-text-primary border border-hairline overflow-hidden relative"
    >
      <div ref={measureRef} aria-hidden style={measurerStyle}>
        {shape.props.text || " "}
      </div>

      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={shape.props.text}
          onChange={(e) => updateText(e.currentTarget.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") textareaRef.current?.blur();
          }}
          onBlur={() => {
            if (editor.getEditingShapeId() === shape.id) {
              editor.setEditingShape(null);
            }
          }}
          placeholder="Type a note…"
          spellCheck={false}
          className="absolute inset-0 w-full h-full resize-none bg-transparent outline-none py-4 px-4 text-[13px] leading-[1.6] font-sans placeholder:text-text-tertiary overflow-hidden"
          style={{ letterSpacing: "-0.01em", pointerEvents: "auto" }}
        />
      ) : (
        <div
          className="w-full h-full py-4 px-4 text-[13px] leading-[1.6] font-sans whitespace-pre-wrap break-words text-text-primary overflow-hidden"
          style={{ letterSpacing: "-0.01em" }}
        >
          {shape.props.text || (
            <span className="text-text-tertiary">
              Text note (double-click to edit)
            </span>
          )}
        </div>
      )}
      <ConnectHandle shapeId={shape.id as TLShapeId} />
    </HTMLContainer>
  );
}

function clampHeight(h: number): number {
  if (!Number.isFinite(h)) return EMPTY_HEIGHT;
  return Math.min(MAX_AUTO_H, Math.max(MIN_H, Math.round(h)));
}
